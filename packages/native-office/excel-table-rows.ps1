function Get-ExcelColorProfile($object){
    $theme=$null;try{$theme=[int]$object.ThemeColor}catch{}
    return [ordered]@{color=$object.Color;colorIndex=$object.ColorIndex;theme=$theme;tint=$object.TintAndShade}
}
function Get-ExcelFormulaConstant($value){
    if($null -eq $value){return ''}
    if($value -is [ValueType] -and $value -isnot [bool]){return $value.ToString([Globalization.CultureInfo]::InvariantCulture)}
    return $value
}
function Get-ExcelEmptyProfile($object,[bool]$style=$false){
    $font=[ordered]@{};foreach($field in @('Name','Size','Bold','Italic','Underline','Strikethrough','Subscript','Superscript','ThemeFont')){$font[$field]=$object.Font.$field};$font.color=Get-ExcelColorProfile $object.Font
    $fill=[ordered]@{pattern=$object.Interior.Pattern;color=(Get-ExcelColorProfile $object.Interior);patternColor=$object.Interior.PatternColor;patternColorIndex=$object.Interior.PatternColorIndex}
    $borders=[Collections.Generic.List[object]]::new();foreach($index in @(5,6,7,8,9,10,11,12)){
        $border=$object.Borders.Item($index);$line=$border.LineStyle;$weight=$border.Weight
        if($style -and ($null -eq $line -or $line -is [DBNull])){$line=-4142}
        if($style -and $line -eq -4142 -and ($null -eq $weight -or $weight -is [DBNull])){$weight=2}
        $borders.Add([ordered]@{index=$index;line=$line;weight=$weight;color=(Get-ExcelColorProfile $border)})
    }
    $properties=[ordered]@{};foreach($field in @('NumberFormat','HorizontalAlignment','VerticalAlignment','WrapText','ShrinkToFit','Orientation','IndentLevel','ReadingOrder','Locked','FormulaHidden')){$properties[$field]=$object.$field}
    if($style -and ($null -eq $properties.IndentLevel -or $properties.IndentLevel -is [DBNull])){$properties.IndentLevel=0}
    $namedStyle=if($style){$object}else{$object.Style}
    $name=if($namedStyle -is [string]){[string]$namedStyle}else{[string]$namedStyle.NameLocal}
    return [ordered]@{style=$name;font=$font;fill=$fill;borders=$borders.ToArray();properties=$properties}
}
function Read-ExcelTail($entry,[string]$sheetName,[string]$address,[bool]$requireBlank=$false){
    $sheet=$entry.doc.Worksheets.Item($sheetName);$range=$sheet.Range($address)
    if($range.CountLarge -gt 200 -or $range.MergeCells -ne $false -or $range.HasArray -ne $false -or $range.EntireRow.Hidden -ne $false -or $range.EntireColumn.Hidden -ne $false){throw 'EXCEL_APPEND_TAIL_UNSUPPORTED'}
    $normal=$entry.doc.Styles.Item('Normal');if(-not $normal.BuiltIn){throw 'EXCEL_NORMAL_STYLE_UNAVAILABLE'}
    $normalHash=Hash-Text (ConvertTo-Json -InputObject (Get-ExcelEmptyProfile $normal $true) -Depth 12 -Compress)
    $profiles=[Collections.Generic.List[object]]::new();$heights=[Collections.Generic.List[double]]::new()
    for($r=1;$r -le $range.Rows.Count;$r++){
        $heights.Add([double]$range.Rows.Item($r).RowHeight)
        for($c=1;$c -le $range.Columns.Count;$c++){
            $cell=$range.Cells.Item($r,$c)
            if($cell.FormatConditions.Count -gt 0 -or $cell.Hyperlinks.Count -gt 0 -or $null -ne $cell.Comment -or $cell.SparklineGroups.Count -gt 0){throw 'EXCEL_APPEND_SPECIAL_CONTENT'}
            $validation=$null;try{$validation=$cell.Validation.Type}catch{}
            if($null -ne $validation){throw 'EXCEL_APPEND_VALIDATION_UNSUPPORTED'}
            $profile=Get-ExcelEmptyProfile $cell
            if($requireBlank -and (($null -ne $cell.Value2 -and [string]$cell.Value2 -ne '') -or [string]$cell.Formula -ne '' -or (Hash-Text (ConvertTo-Json -InputObject $profile -Depth 12 -Compress)) -cne $normalHash)){throw 'EXCEL_APPEND_REQUIRES_EMPTY_NORMAL_CELLS'}
            $profiles.Add($profile)
        }
    }
    $state=Read-Range $entry @{sheet=$sheetName;range=$address};$snapshot=[ordered]@{range=$address;state=$state;profiles=$profiles.ToArray();rowHeights=$heights.ToArray()}
    return @{range=$address;state=$state;profiles=$profiles.ToArray();rowHeights=$heights.ToArray();hash=(Hash-Text (ConvertTo-Json -InputObject $snapshot -Depth 14 -Compress))}
}
function Read-ExcelTableAppend($entry,$data){
    $before=Read-ExcelTable $entry $data.reference
    if(-not $before.shape.showHeaders -or $before.shape.showTotals){throw 'EXCEL_APPEND_HEADER_TOTALS_UNSUPPORTED'}
    $table=$entry.doc.Worksheets.Item([string]$data.reference.sheet).ListObjects.Item([string]$data.reference.name);$count=@($data.append).Count;$columns=[int]$table.Range.Columns.Count;$oldRows=[int]$table.Range.Rows.Count
    if($count -lt 1 -or $count -gt 10 -or $columns -gt 20 -or ($oldRows+$count)*$columns -gt 1000 -or $table.Range.Row+$oldRows+$count-1 -gt 1048576){throw 'EXCEL_APPEND_LIMIT'}
    foreach($row in $data.append){if($row.Count -ne $columns){throw 'EXCEL_APPEND_COLUMNS'}}
    if($data.formulas){if($data.formulas.Count -ne $count){throw 'EXCEL_APPEND_FORMULAS'};foreach($row in $data.formulas){if($row.Count -ne $columns){throw 'EXCEL_APPEND_FORMULAS'}}}
    $sheet=$entry.doc.Worksheets.Item([string]$data.reference.sheet);$expanded=$table.Range.Resize($oldRows+$count,$columns);$tail=$sheet.Cells.Item($table.Range.Row+$oldRows,$table.Range.Column).Resize($count,$columns)
    for($i=1;$i -le $sheet.ListObjects.Count;$i++){$other=$sheet.ListObjects.Item($i);if([string]$other.Name -cne [string]$table.Name){$overlap=$entry.app.Intersect($expanded,$other.Range);if($null -ne $overlap){throw 'EXCEL_APPEND_TABLE_OVERLAP'}}}
    $tailSnapshot=Read-ExcelTail $entry $data.reference.sheet ([string]$tail.Address($false,$false)) $true
    return @{table=$before;tail=$tailSnapshot;expandedRange=[string]$expanded.Address($false,$false);rowsAdded=$count;columns=$columns;usedRange=[string]$sheet.UsedRange.Address($false,$false)}
}
function Write-ExcelTableRows($entry,$data){
    $sheet=$entry.doc.Worksheets.Item([string]$data.reference.sheet)
    if($entry.doc.ReadOnly -or $sheet.ProtectContents){return @{verified=$false;notIssued=$true;code='PROTECTED_TABLE'}}
    if($data.restore){
        try{$current=Read-ExcelTable $entry $data.reference;$tail=Read-ExcelTail $entry $data.reference.sheet $data.restore.tail.range}catch{if($_.Exception.Message -match 'REVISION_CONFLICT'){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}};throw}
        if($tail.hash -cne [string]$data.expectedTailHash -or $current.reference.objectId -cne $data.restore.table.reference.objectId){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}}
        $table=$sheet.ListObjects.Item([string]$data.reference.name);$null=$table.Resize($sheet.Range([string]$data.restore.table.reference.range))
        # Preflight proved these exact tail cells were empty Normal cells. Never
        # delete worksheet rows or clear a broader area to undo an append.
        $range=$sheet.Range([string]$data.restore.tail.range);$null=$range.ClearContents();$null=$range.ClearFormats()
        $ref=@{};foreach($key in @('sheet','name','objectId','hostSessionId')){$ref[$key]=$data.reference.$key};$ref.range=$data.restore.table.reference.range;$ref.revision=''
        $after=Read-ExcelTable $entry $ref $false;$after.tail=Read-ExcelTail $entry $ref.sheet $data.restore.tail.range
        $verified=$after.reference.revision -ceq [string]$data.restore.table.reference.revision -and $after.tail.hash -ceq [string]$data.restore.tail.hash
        return @{before=$current;after=$after;verified=$verified;revision=$after.reference.revision;retainedBlankUsedRange=([string]$sheet.UsedRange.Address($false,$false) -cne [string]$data.restore.usedRange);code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
    }
    try{$before=Read-ExcelTableAppend $entry $data}catch{if($_.Exception.Message -match 'REVISION_CONFLICT'){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}};throw}
    $table=$sheet.ListObjects.Item([string]$data.reference.name);$null=$table.Resize($sheet.Range([string]$before.expandedRange));$tailRange=$sheet.Range([string]$before.tail.range)
    for($r=0;$r -lt $before.rowsAdded;$r++){for($c=0;$c -lt $before.columns;$c++){
        $cell=$tailRange.Cells.Item($r+1,$c+1);$value=$data.append[$r][$c]
        if($value -is [ValueType] -and $value -isnot [bool]){$value=[double]$value}
        Set-ExcelScalar $cell $value
        if($data.formulas -and [string]$data.formulas[$r][$c] -ne ''){$cell.Formula=[string]$data.formulas[$r][$c]}
    }}
    $null=$tailRange.Calculate()
    $ref=@{};foreach($key in @('sheet','name','objectId','hostSessionId')){$ref[$key]=$data.reference.$key};$ref.range=$before.expandedRange;$ref.revision=''
    $after=Read-ExcelTable $entry $ref $false;$after.tail=Read-ExcelTail $entry $ref.sheet $before.tail.range
    $oldState=Read-Range $entry @{sheet=$ref.sheet;range=$before.table.reference.range};$verified=(Hash-Text (ConvertTo-Json -InputObject $oldState -Depth 12 -Compress)) -ceq $before.table.dataHash
    if((ConvertTo-Json -InputObject $after.properties -Compress) -cne (ConvertTo-Json -InputObject $before.table.properties -Compress) -or (ConvertTo-Json -InputObject $after.tail.rowHeights -Compress) -cne (ConvertTo-Json -InputObject $before.tail.rowHeights -Compress)){$verified=$false}
    foreach($key in @('name','columns','showHeaders','showTotals','showAutoFilter')){if($after.shape.$key -cne $before.table.shape.$key){$verified=$false}}
    if($after.shape.rows -ne $before.table.shape.rows+$before.rowsAdded){$verified=$false}
    for($r=0;$r -lt $before.rowsAdded;$r++){for($c=0;$c -lt $before.columns;$c++){
        if($data.formulas -and [string]$data.formulas[$r][$c] -ne ''){if($after.tail.state.formulas[$r][$c] -cne [string]$data.formulas[$r][$c]){$verified=$false}}
        else{
            $wanted=$data.append[$r][$c];if($null -eq $wanted){$wanted=''}
            # -cne alone coerces numeric strings; preserve explicit value types.
            if((ConvertTo-Json -InputObject $after.tail.state.values[$r][$c] -Compress) -cne (ConvertTo-Json -InputObject $wanted -Compress) -or (ConvertTo-Json -InputObject (Get-ExcelFormulaConstant $after.tail.state.formulas[$r][$c]) -Compress) -cne (ConvertTo-Json -InputObject (Get-ExcelFormulaConstant $wanted) -Compress)){$verified=$false}
        }
    }}
    return @{before=$before;after=$after;verified=$verified;revision=$after.reference.revision;atomic=$false;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
