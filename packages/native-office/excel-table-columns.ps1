function Read-ExcelTableColumns($entry,$data){
    $before=Read-ExcelTable $entry $data.reference
    if(-not $before.shape.showHeaders -or $before.shape.showTotals -or $before.shape.rows -lt 2){throw 'EXCEL_COLUMNS_HEADER_TOTALS_UNSUPPORTED'}
    $sheet=$entry.doc.Worksheets.Item([string]$data.reference.sheet);$table=$sheet.ListObjects.Item([string]$data.reference.name);$count=@($data.append).Count;$rows=[int]$table.Range.Rows.Count;$columns=[int]$table.ListColumns.Count
    if($count -lt 1 -or $count -gt 10 -or $columns+$count -gt 20 -or $rows*($columns+$count) -gt 200 -or $table.Range.Column+$columns+$count-1 -gt 16384){throw 'EXCEL_COLUMNS_LIMIT'}
    $headers=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase);for($i=1;$i -le $columns;$i++){$null=$headers.Add([string]$table.ListColumns.Item($i).Name)}
    foreach($col in $data.append){if([string]::IsNullOrWhiteSpace([string]$col.name) -or ([string]$col.name).Length -gt 255 -or [string]$col.name -match '[\x00-\x1f]' -or -not $headers.Add([string]$col.name)){throw 'EXCEL_COLUMNS_UNIQUE_HEADERS_REQUIRED'};if($col.values -and $col.formulas){throw 'EXCEL_COLUMNS_VALUES_OR_FORMULAS'};foreach($key in @('values','formulas')){if($null -ne $col.$key -and @($col.$key).Count -ne $rows-1){throw 'EXCEL_COLUMNS_DATA_SHAPE'}}}
    $expanded=$table.Range.Resize($rows,$columns+$count);$tail=$sheet.Cells.Item($table.Range.Row,$table.Range.Column+$columns).Resize($rows,$count)
    for($i=1;$i -le $sheet.ListObjects.Count;$i++){$other=$sheet.ListObjects.Item($i);if([string]$other.Name -cne [string]$table.Name -and $null -ne $entry.app.Intersect($expanded,$other.Range)){throw 'EXCEL_COLUMNS_TABLE_OVERLAP'}}
    return @{table=$before;source=(Read-ExcelTail $entry $data.reference.sheet $before.reference.range);tail=(Read-ExcelTail $entry $data.reference.sheet ([string]$tail.Address($false,$false)) $true);expandedRange=[string]$expanded.Address($false,$false);count=$count;rows=$rows;columns=$columns;package=(Read-ExcelTablePackage $entry $data.reference);usedRange=[string]$sheet.UsedRange.Address($false,$false)}
}
function Write-ExcelTableColumns($entry,$data){
    $sheet=$entry.doc.Worksheets.Item([string]$data.reference.sheet)
    if($entry.doc.ReadOnly -or $sheet.ProtectContents){return @{verified=$false;notIssued=$true;code='PROTECTED_TABLE'}}
    if($data.restore){
        try{$current=Read-ExcelTable $entry $data.reference;$source=Read-ExcelTail $entry $data.reference.sheet $data.reference.range;$package=Read-ExcelTablePackage $entry $data.reference}catch{if($_.Exception.Message -match 'REVISION_CONFLICT'){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}};throw}
        if($source.hash -cne [string]$data.expectedSourceHash -or $package.formulaHash -cne [string]$data.expectedFormulaHash -or $package.table.hash -cne [string]$data.expectedTableHash){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}}
        $table=$sheet.ListObjects.Item([string]$data.reference.name);$null=$table.Resize($sheet.Range([string]$data.restore.table.reference.range));$tail=$sheet.Range([string]$data.restore.tail.range);$null=$tail.ClearContents()
        Restore-ExcelRangeProfiles $entry $data.reference.sheet $data.restore.tail;Restore-ExcelRangeProfiles $entry $data.reference.sheet $data.restore.source
        $ref=@{};foreach($key in @('sheet','name','objectId','hostSessionId')){$ref[$key]=$data.reference.$key};$ref.range=$data.restore.table.reference.range;$ref.revision=''
        $after=Read-ExcelTable $entry $ref $false;$after.source=Read-ExcelTail $entry $ref.sheet $ref.range;$after.tail=Read-ExcelTail $entry $ref.sheet $data.restore.tail.range;$after.package=Read-ExcelTablePackage $entry $ref
        $verified=$after.reference.revision -ceq [string]$data.restore.table.reference.revision -and $after.source.hash -ceq [string]$data.restore.source.hash -and $after.tail.hash -ceq [string]$data.restore.tail.hash -and $after.package.formulaHash -ceq [string]$data.restore.package.formulaHash
        return @{before=$current;after=$after;verified=$verified;revision=$after.reference.revision;retainedBlankUsedRange=([string]$sheet.UsedRange.Address($false,$false) -cne [string]$data.restore.usedRange);code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
    }
    try{$before=Read-ExcelTableColumns $entry $data}catch{return @{verified=$false;notIssued=$true;code='COLUMN_PREFLIGHT';message=$_.Exception.Message}}
    if($before.tail.hash -cne [string]$data.before.tail.hash -or $before.source.hash -cne [string]$data.before.source.hash -or $before.package.formulaHash -cne [string]$data.before.package.formulaHash){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}}
    $table=$sheet.ListObjects.Item([string]$data.reference.name);$null=$table.Resize($sheet.Range([string]$before.expandedRange));$tail=$sheet.Range([string]$before.tail.range)
    for($c=0;$c -lt $before.count;$c++){
        $col=$data.append[$c];$table.ListColumns.Item($before.columns+$c+1).Name=[string]$col.name
        for($r=0;$r -lt $before.rows-1;$r++){$cell=$tail.Cells.Item($r+2,$c+1);if($null -ne $col.formulas){Set-ExcelScalar $cell $col.formulas[$r] $true}else{Set-ExcelScalar $cell $(if($null -ne $col.values){$col.values[$r]}else{$null})};if($null -ne $col.numberFormat){$cell.NumberFormat=[string]$col.numberFormat}}
    }
    $null=$tail.Calculate();$ref=@{};foreach($key in @('sheet','name','objectId','hostSessionId')){$ref[$key]=$data.reference.$key};$ref.range=$before.expandedRange;$ref.revision=''
    $after=Read-ExcelTable $entry $ref $false;$after.source=Read-ExcelTail $entry $ref.sheet $ref.range;$after.tail=Read-ExcelTail $entry $ref.sheet $before.tail.range;$after.package=Read-ExcelTablePackage $entry $ref @{sheet=$ref.sheet;range=$before.tail.range}
    $old=Read-ExcelTail $entry $ref.sheet $before.table.reference.range;$verified=$old.hash -ceq $before.source.hash -and $after.shape.rows -eq $before.rows -and $after.shape.columns -eq $before.columns+$before.count -and (ConvertTo-Json -InputObject $after.properties -Compress) -ceq (ConvertTo-Json -InputObject $before.table.properties -Compress)
    if($after.package.outsideFormulaHash -cne [string]$before.package.formulaHash){$verified=$false}
    for($c=0;$c -lt $before.count;$c++){
        $col=$data.append[$c];if([string]$after.tail.state.values[0][$c] -cne [string]$col.name){$verified=$false}
        for($r=0;$r -lt $before.rows-1;$r++){
            if($null -ne $col.formulas){$wanted=[string]$col.formulas[$r];if([string]$after.tail.state.formulas[$r+1][$c] -cne $wanted){$verified=$false}}
            else{$wanted=if($null -ne $col.values){$col.values[$r]}else{''};if($null -eq $wanted){$wanted=''};if((ConvertTo-Json -InputObject $after.tail.state.values[$r+1][$c] -Compress) -cne (ConvertTo-Json -InputObject $wanted -Compress)){$verified=$false}}
            if($null -ne $col.numberFormat -and [string]$after.tail.state.numberFormat[$r+1][$c] -cne [string]$col.numberFormat){$verified=$false}
        }
    }
    return @{before=$before;after=$after;verified=$verified;revision=$after.reference.revision;atomic=$false;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
