$script:excelTableIdentities=@{}
$script:excelTableProperties=[ordered]@{style='TableStyle';showFirstColumn='ShowTableStyleFirstColumn';showLastColumn='ShowTableStyleLastColumn';showRowStripes='ShowTableStyleRowStripes';showColumnStripes='ShowTableStyleColumnStripes'}
function Read-ExcelSheets($entry,$data){
    if($entry.kind -ne 'excel'){throw 'HOST_KIND'};$start=[int]$data.start;$count=[int]$data.count
    if($start -lt 0 -or $start -gt 1000 -or $count -lt 1 -or $count -gt 50 -or $entry.doc.Worksheets.Count -gt 1000){throw 'EXCEL_SHEET_PAGE_LIMIT'}
    $items=[Collections.Generic.List[object]]::new()
    for($i=$start+1;$i -le [Math]::Min($entry.doc.Worksheets.Count,$start+$count);$i++){
        $sheet=$entry.doc.Worksheets.Item($i)
        $items.Add(@{name=[string]$sheet.Name;index=[int]$sheet.Index;visibility=[int]$sheet.Visible;protected=[bool]$sheet.ProtectContents;usedRange=[string]$sheet.UsedRange.Address($false,$false);tables=[int]$sheet.ListObjects.Count;embeddedCharts=[int]$sheet.ChartObjects().Count})
    }
    return @{items=$items.ToArray();worksheetCount=[int]$entry.doc.Worksheets.Count;chartSheetCount=[int]$entry.doc.Charts.Count;nextStart=$(if($start+$count -lt $entry.doc.Worksheets.Count){$start+$count}else{$null});instruction='Names belong only to this bound workbook. UsedRange can include empty/formatted cells, not a nonempty-data guarantee. Read bounded ranges/tables next; hidden/protected does not grant write permission. No window or sheet was activated.'}
}
function Get-ExcelTableIdentity($table){
    $pointer=[Runtime.InteropServices.Marshal]::GetIUnknownForObject($table)
    try{$key=$pointer.ToInt64().ToString('X');if(-not $script:excelTableIdentities.ContainsKey($key)){if($script:excelTableIdentities.Count -ge 1000){throw 'EXCEL_TABLE_ID_LIMIT'};$script:excelTableIdentities[$key]=@{id=[Guid]::NewGuid().ToString();reference=$table}};return $script:excelTableIdentities[$key].id}finally{[void][Runtime.InteropServices.Marshal]::Release($pointer)}
}
function Read-ExcelTable($entry,$ref,[bool]$checkRevision=$true){
    if($entry.kind -ne 'excel'){throw 'HOST_KIND'};$null=Assert-SelectionIdentity $entry $ref
    $sheet=$entry.doc.Worksheets.Item([string]$ref.sheet);$table=$sheet.ListObjects.Item([string]$ref.name)
    $address=[string]$table.Range.Address($false,$false)
    if((Get-ExcelTableIdentity $table) -cne [string]$ref.objectId -or $address -cne [string]$ref.range){throw 'EXCEL_TABLE_REVISION_CONFLICT'}
    if([int]$table.SourceType -ne 1){throw 'EXCEL_EXTERNAL_TABLE_UNSUPPORTED'}
    $state=Read-Range $entry @{sheet=$ref.sheet;range=$address};$properties=[ordered]@{}
    foreach($key in $script:excelTableProperties.Keys){$p=$script:excelTableProperties[$key];$value=$table.$p;if($key -eq 'style'){$properties[$key]=$(if($value -is [string]){$value}elseif($null -ne $value){[string]$value.Name}else{''})}else{$properties[$key]=[bool]$value}}
    $shape=[ordered]@{name=[string]$table.Name;range=$address;rows=[int]$table.Range.Rows.Count;columns=[int]$table.ListColumns.Count;showHeaders=[bool]$table.ShowHeaders;showTotals=[bool]$table.ShowTotals;showAutoFilter=[bool]$table.ShowAutoFilter}
    $data=ConvertTo-Json -InputObject $state -Depth 12 -Compress;$hash=Hash-Text (ConvertTo-Json -InputObject ([ordered]@{shape=$shape;state=$state;properties=$properties}) -Depth 14 -Compress)
    if($checkRevision -and $hash -cne [string]$ref.revision){throw 'EXCEL_TABLE_REVISION_CONFLICT'}
    $reference=@{sheet=$ref.sheet;name=$ref.name;objectId=$ref.objectId;range=$address;hostSessionId=$ref.hostSessionId;revision=$hash}
    return @{reference=$reference;rangeState=$state;properties=$properties;shape=$shape;dataHash=(Hash-Text $data);contentHash=$hash}
}
function Read-ExcelTables($entry,$data){
    if($entry.kind -ne 'excel'){throw 'HOST_KIND'};$sheet=$entry.doc.Worksheets.Item([string]$data.sheet);$items=[Collections.Generic.List[object]]::new();$start=[int]$data.start;$count=[int]$data.count
    if($start -lt 0 -or $start -gt 1000 -or $count -lt 1 -or $count -gt 10 -or $sheet.ListObjects.Count -gt 1000){throw 'EXCEL_TABLE_PAGE_LIMIT'}
    $windows=@(for($i=1;$i -le $entry.doc.Windows.Count;$i++){Get-OfficeWindowIdentity 'excel' $entry.doc.Windows.Item($i)})
    for($i=$start+1;$i -le [Math]::Min($sheet.ListObjects.Count,$start+$count);$i++){
        $table=$sheet.ListObjects.Item($i);$address=[string]$table.Range.Address($false,$false);$item=@{name=[string]$table.Name;sheet=[string]$sheet.Name;range=$address;rows=[int]$table.Range.Rows.Count;columns=[int]$table.ListColumns.Count;reference=$null}
        if($windows.Count -eq 1 -and $table.Range.CountLarge -le 1000 -and [int]$table.SourceType -eq 1){
            $ref=@{sheet=[string]$sheet.Name;name=[string]$table.Name;objectId=(Get-ExcelTableIdentity $table);range=$address;hostSessionId=$script:session+':'+$windows[0];revision=''}
            $snapshot=Read-ExcelTable $entry $ref $false;$item.reference=$snapshot.reference;$item.properties=$snapshot.properties
        }else{$item.reason='Choose one window and a local range-source table of at most1000 cells.'}
        $items.Add($item)
    }
    return @{items=$items.ToArray();nextStart=$(if($start+$count -lt $sheet.ListObjects.Count){$start+$count}else{$null});windowIds=$windows}
}
function Write-ExcelTableStyle($entry,$data){
    if($entry.doc.ReadOnly){return @{verified=$false;notIssued=$true;code='READ_ONLY'}}
    $sheet=$entry.doc.Worksheets.Item([string]$data.reference.sheet)
    if($sheet.ProtectContents){return @{verified=$false;notIssued=$true;code='PROTECTED_TABLE'}}
    try{$before=Read-ExcelTable $entry $data.reference}catch{if($_.Exception.Message -match 'REVISION_CONFLICT'){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}};throw}
    $wanted=[ordered]@{};foreach($key in $before.properties.Keys){$wanted[$key]=$before.properties[$key]}
    $fields=if($data.restore){@($data.fields)}else{@($data.properties.PSObject.Properties.Name)}
    if($fields.Count -lt 1 -or $fields.Count -gt 5){throw 'EXCEL_TABLE_PROPERTY_LIMIT'}
    foreach($field in $fields){
        if(-not $script:excelTableProperties.Contains($field)){throw 'EXCEL_TABLE_PROPERTY_UNKNOWN'}
        $value=if($data.restore){$data.restore.properties.$field}else{$data.properties.$field}
        if($field -eq 'style'){
            if(-not $data.restore -and [string]$value -notmatch '^TableStyle(Light([1-9]|1[0-9]|2[01])|Medium([1-9]|1[0-9]|2[0-8])|Dark([1-9]|1[01]))$'){throw 'EXCEL_TABLE_STYLE_UNSUPPORTED'}
            if([string]$value -ne ''){$style=$entry.doc.TableStyles.Item([string]$value);if($null -eq $style){throw 'EXCEL_TABLE_STYLE_MISSING'}}
        }elseif($value -isnot [bool]){throw 'EXCEL_TABLE_FLAG_VALUE'}
        $wanted[$field]=$value
    }
    $table=$sheet.ListObjects.Item([string]$data.reference.name)
    foreach($field in $fields){$p=$script:excelTableProperties[$field];$table.$p=$wanted[$field]}
    $after=Read-ExcelTable $entry $data.reference $false
    $verified=$after.dataHash -ceq $before.dataHash -and (ConvertTo-Json -InputObject $after.shape -Compress) -ceq (ConvertTo-Json -InputObject $before.shape -Compress) -and (ConvertTo-Json -InputObject $wanted -Compress) -ceq (ConvertTo-Json -InputObject $after.properties -Compress)
    return @{before=$before;after=$after;verified=$verified;revision=$after.reference.revision;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
function Add-ExcelTableReference($entry,$selection){
    $sheet=$entry.doc.Worksheets.Item([string]$selection.sheet)
    if($sheet.ListObjects.Count -gt 1000){return $selection}
    for($i=1;$i -le $sheet.ListObjects.Count;$i++){
        $table=$sheet.ListObjects.Item($i)
        if([int]$table.SourceType -eq 1 -and [string]$table.Range.Address($false,$false) -ceq [string]$selection.range){
            $ref=@{sheet=$selection.sheet;name=[string]$table.Name;range=$selection.range;objectId=(Get-ExcelTableIdentity $table);hostSessionId=$selection.hostSessionId;revision=''}
            $selection.table=(Read-ExcelTable $entry $ref $false).reference;break
        }
    };return $selection
}
