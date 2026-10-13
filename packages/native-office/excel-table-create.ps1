function Test-ExcelNewTableName([string]$name){return $name.Length -ge 1 -and $name.Length -le 255 -and $name -match '^[\p{L}_][\p{L}\p{N}_.]*$' -and $name -notmatch '^([rc]|r\d+c\d+|[a-z]{1,3}\d+)$'}
function Read-ExcelTableCreate($entry,$data,[bool]$skipPackage=$false){
    if($entry.kind -ne 'excel' -or [int]$entry.doc.FileFormat -ne 51){throw 'EXCEL_TABLE_XLSX_REQUIRED'};$null=Assert-SelectionIdentity $entry $data.source
    $sheet=$entry.doc.Worksheets.Item([string]$data.source.sheet);$range=$sheet.Range([string]$data.source.range)
    if($entry.doc.ReadOnly -or $sheet.ProtectContents){throw 'EXCEL_TABLE_READ_ONLY_OR_PROTECTED'}
    if($range.Rows.Count -lt 2 -or $range.Columns.Count -gt 20 -or $range.CountLarge -gt 200 -or -not (Test-ExcelNewTableName ([string]$data.name))){throw 'EXCEL_TABLE_CREATE_SCOPE'}
    $headers=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    for($c=1;$c -le $range.Columns.Count;$c++){
        $cell=$range.Cells.Item(1,$c);$value=$cell.Value2
        if($value -isnot [string] -or [string]::IsNullOrWhiteSpace($value) -or $value.Length -gt 255 -or $value -match '[\x00-\x1f]' -or $cell.HasFormula -or [string]$cell.Text -cne $value -or -not $headers.Add($value)){throw 'EXCEL_TABLE_PLAIN_UNIQUE_HEADERS_REQUIRED'}
    }
    for($i=1;$i -le $entry.doc.Worksheets.Count;$i++){$other=$entry.doc.Worksheets.Item($i);for($j=1;$j -le $other.ListObjects.Count;$j++){if([string]$other.ListObjects.Item($j).Name -ieq [string]$data.name){throw 'EXCEL_TABLE_NAME_EXISTS'}}}
    for($i=1;$i -le $entry.doc.Names.Count;$i++){if(([string]$entry.doc.Names.Item($i).Name -split '!')[-1] -ieq [string]$data.name){throw 'EXCEL_TABLE_NAME_EXISTS'}}
    $ids=[Collections.Generic.List[string]]::new();for($i=1;$i -le $sheet.ListObjects.Count;$i++){$table=$sheet.ListObjects.Item($i);if($null -ne $entry.app.Intersect($range,$table.Range)){throw 'EXCEL_TABLE_CREATE_OVERLAP'};$ids.Add((Get-ExcelTableIdentity $table))}
    foreach($key in $data.properties.PSObject.Properties.Name){
        if(-not $script:excelTableProperties.Contains($key)){throw 'EXCEL_TABLE_PROPERTY_UNKNOWN'}
        if($key -eq 'style'){if([string]$data.properties.style -notmatch '^TableStyle(Light([1-9]|1[0-9]|2[01])|Medium([1-9]|1[0-9]|2[0-8])|Dark([1-9]|1[01]))$' -or -not $entry.doc.TableStyles.Item([string]$data.properties.style).BuiltIn){throw 'EXCEL_TABLE_STYLE_UNSUPPORTED'}}elseif($data.properties.$key -isnot [bool]){throw 'EXCEL_TABLE_FLAG_VALUE'}
    }
    $source=Read-ExcelTail $entry ([string]$data.source.sheet) ([string]$data.source.range)
    if((ConvertTo-Json -InputObject $source -Depth 20 -Compress).Length -gt 512000){throw 'EXCEL_TABLE_CREATE_SNAPSHOT_LIMIT'}
    foreach($profile in $source.profiles){if($profile.fill.pattern -notin @(-4142,1)){throw 'EXCEL_TABLE_CREATE_PATTERN_UNSUPPORTED'};foreach($key in @('Name','Size','Bold','Italic','Underline','Strikethrough','Subscript','Superscript','ThemeFont')){if($null -eq $profile.font[$key] -or $profile.font[$key] -is [DBNull]){throw 'EXCEL_TABLE_CREATE_MIXED_FONT'}}}
    $spill=$false;try{$spill=$range.HasSpill}catch{};if($spill -ne $false){throw 'EXCEL_TABLE_CREATE_SPILL_UNSUPPORTED'}
    return @{source=$data.source;sourceSnapshot=$source;tableIds=$ids.ToArray();package=$(if($skipPackage){$null}else{Read-ExcelTablePackage $entry $null})}
}
function Write-ExcelTableCreate($entry,$data){
    try{$before=Read-ExcelTableCreate $entry $data}catch{return @{verified=$false;notIssued=$true;code='TABLE_CREATE_PREFLIGHT';message=$_.Exception.Message}}
    if($before.sourceSnapshot.hash -cne [string]$data.before.sourceSnapshot.hash -or $before.package.formulaHash -cne [string]$data.before.package.formulaHash -or (ConvertTo-Json -InputObject $before.tableIds -Compress) -cne (ConvertTo-Json -InputObject $data.before.tableIds -Compress)){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}}
    $table=$null;$ref=$null;$sheet=$entry.doc.Worksheets.Item([string]$data.source.sheet)
    try{
        $style=if($data.properties.style){[string]$data.properties.style}else{'TableStyleMedium2'}
        $table=$sheet.ListObjects.Add(1,$sheet.Range([string]$data.source.range),[Type]::Missing,1,[Type]::Missing,$style);$table.Name=[string]$data.name
        foreach($key in $data.properties.PSObject.Properties.Name){$property=$script:excelTableProperties[$key];$table.$property=$data.properties.$key}
        # Add can return a different automation proxy than subsequent collection
        # reads. Freeze the collection object used by all later table operations.
        $table=$sheet.ListObjects.Item([string]$data.name)
        $ref=@{sheet=$data.source.sheet;name=$data.name;objectId=(Get-ExcelTableIdentity $table);range=$data.source.range;hostSessionId=$data.source.hostSessionId;revision=''}
        $after=Read-ExcelTable $entry $ref $false;$ref=$after.reference;$after.sourceSnapshot=Read-ExcelTail $entry ([string]$data.source.sheet) ([string]$data.source.range);$after.package=Read-ExcelTablePackage $entry $ref
        $verified=(Compare-ExcelChartSource $after.rangeState $before.sourceSnapshot.state) -and $after.shape.range -ceq [string]$data.source.range -and $after.shape.showHeaders -and -not $after.shape.showTotals -and $after.package.formulaHash -ceq $before.package.formulaHash -and $sheet.ListObjects.Count -eq $before.tableIds.Count+1
        if((ConvertTo-Json -InputObject $before.sourceSnapshot.rowHeights -Compress) -cne (ConvertTo-Json -InputObject $after.sourceSnapshot.rowHeights -Compress)){$verified=$false}
        foreach($key in $data.properties.PSObject.Properties.Name){if($after.properties[$key] -cne $data.properties.$key){$verified=$false}}
        return @{before=$before;after=$after;verified=$verified;revision=$after.reference.revision;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
    }catch{return @{before=$before;verified=$false;code='TABLE_CREATE_PARTIAL';createdReference=$ref;message=$_.Exception.Message;instruction='Inspect the new table and journal; no automatic retry or deletion.'}}
}
function Remove-ExcelCreatedTable($entry,$data){
    $sheet=$entry.doc.Worksheets.Item([string]$data.reference.sheet)
    if($entry.doc.ReadOnly -or $sheet.ProtectContents){return @{verified=$false;notIssued=$true;code='READ_ONLY_OR_PROTECTED'}}
    try{$before=Read-ExcelTable $entry $data.reference;$source=Read-ExcelTail $entry ([string]$data.reference.sheet) ([string]$data.reference.range);$package=Read-ExcelTablePackage $entry $data.reference}catch{if($_.Exception.Message -match 'REVISION_CONFLICT'){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}};throw}
    if($source.hash -cne [string]$data.expectedSourceHash -or $package.table.hash -cne [string]$data.expectedTableHash -or $package.formulaHash -cne [string]$data.expectedFormulaHash){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}}
    $table=$sheet.ListObjects.Item([string]$data.reference.name);$null=$table.Unlist();Restore-ExcelRangeProfiles $entry ([string]$data.reference.sheet) $data.restore.sourceSnapshot
    $afterSource=Read-ExcelTail $entry ([string]$data.reference.sheet) ([string]$data.reference.range);$afterPackage=Read-ExcelTablePackage $entry $null
    $ids=[Collections.Generic.List[string]]::new();for($i=1;$i -le $sheet.ListObjects.Count;$i++){$ids.Add((Get-ExcelTableIdentity $sheet.ListObjects.Item($i)))}
    $verified=$afterSource.hash -ceq [string]$data.restore.sourceSnapshot.hash -and $afterPackage.formulaHash -ceq [string]$data.restore.package.formulaHash -and (ConvertTo-Json -InputObject $ids.ToArray() -Compress) -ceq (ConvertTo-Json -InputObject $data.restore.tableIds -Compress)
    return @{before=$before;after=@{sourceSnapshot=$afterSource;package=$afterPackage};removed=$true;verified=$verified;revision=$afterSource.hash;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
