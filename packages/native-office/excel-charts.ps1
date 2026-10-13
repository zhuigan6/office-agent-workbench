function Get-ExcelChartIdentity($object){
    # ChartObject lookups return fresh COM proxies even for the same chart. Use
    # Excel's shape ID inside the bound document/sheet/window, never its pointer.
    $id=[int]$object.ShapeRange.Item(1).ID;if($id -lt 1){throw 'EXCEL_CHART_ID_UNAVAILABLE'};return 'shape:'+ $id
}
function Assert-ExcelChartSelectionScope($selection,$chart,$object){
    try{$name=[string]$selection.Name;$area=[string]$chart.ChartArea.Name}catch{throw 'SELECTION_CHART_COMPONENT: Select the whole embedded chart or resolve an explicit chartName.'}
    if($name -cne $area -and $name -cne [string]$object.Name){throw 'SELECTION_CHART_COMPONENT: A title/series/axis selection cannot expand to chart layout.'}
}
function Read-ExcelChart($entry,$ref,[bool]$checkRevision=$true){
    if($entry.kind -ne 'excel'){throw 'HOST_KIND'};$null=Assert-SelectionIdentity $entry $ref
    $object=$entry.doc.Worksheets.Item([string]$ref.sheet).ChartObjects().Item([string]$ref.name)
    if((Get-ExcelChartIdentity $object) -cne [string]$ref.objectId){throw 'EXCEL_CHART_REVISION_CONFLICT'}
    $chart=$object.Chart;$series=[Collections.Generic.List[object]]::new();$collection=$chart.SeriesCollection()
    if($collection.Count -gt 50){throw 'EXCEL_CHART_SERIES_LIMIT'}
    for($i=1;$i -le $collection.Count;$i++){$item=$collection.Item($i);$formula=[string]$item.Formula;if($formula.Length -gt 4000){throw 'EXCEL_CHART_FORMULA_LIMIT'};$series.Add(@{formula=$formula;type=[int]$item.ChartType})}
    $content=[ordered]@{type=[int]$chart.ChartType;hasTitle=[bool]$chart.HasTitle;title='';hasLegend=[bool]$chart.HasLegend;series=$series.ToArray()}
    if($content.hasTitle){$content.title=[string]$chart.ChartTitle.Text;if($content.title.Length -gt 4000){throw 'EXCEL_CHART_TITLE_LIMIT'}}
    $geometry=[ordered]@{left=[double]$object.Left;top=[double]$object.Top;width=[double]$object.Width;height=[double]$object.Height}
    $hash=Hash-Text (ConvertTo-Json -InputObject ([ordered]@{geometry=$geometry;content=$content}) -Depth 12 -Compress)
    if($checkRevision -and $hash -cne [string]$ref.revision){throw 'EXCEL_CHART_REVISION_CONFLICT'}
    $reference=@{sheet=[string]$ref.sheet;name=[string]$ref.name;objectId=$ref.objectId;hostSessionId=$ref.hostSessionId;revision=$hash}
    return @{reference=$reference;geometry=$geometry;content=$content;contentHash=(Hash-Text (ConvertTo-Json -InputObject $content -Depth 10 -Compress))}
}
function Read-ExcelCharts($entry,$data){
    if($entry.kind -ne 'excel'){throw 'HOST_KIND'};$sheet=$entry.doc.Worksheets.Item([string]$data.sheet);$charts=$sheet.ChartObjects();$start=[int]$data.start;$count=[int]$data.count
    if($start -lt 0 -or $start -gt 1000 -or $count -lt 1 -or $count -gt 10 -or $charts.Count -gt 1000){throw 'EXCEL_CHART_PAGE_LIMIT'}
    $windows=@(for($i=1;$i -le $entry.doc.Windows.Count;$i++){Get-OfficeWindowIdentity 'excel' $entry.doc.Windows.Item($i)})
    $items=[Collections.Generic.List[object]]::new()
    for($i=$start+1;$i -le [Math]::Min($charts.Count,$start+$count);$i++){
        $object=$charts.Item($i);$item=@{name=[string]$object.Name;sheet=[string]$sheet.Name;reference=$null}
        if($windows.Count -eq 1){$ref=@{sheet=$sheet.Name;name=$object.Name;objectId=(Get-ExcelChartIdentity $object);hostSessionId=$script:session+':'+$windows[0];revision=''};$snapshot=if($data.includeFormat){Read-ExcelChartFormat $entry $ref $false}else{Read-ExcelChart $entry $ref $false};$item.reference=$snapshot.reference;$item.geometry=$snapshot.geometry;$item.content=$snapshot.content;if($data.includeFormat){$item.format=$snapshot.format;if($snapshot.valueAxis){$item.valueAxis=$snapshot.valueAxis};if($snapshot.valueAxisUnavailable){$item.valueAxisUnavailable=$snapshot.valueAxisUnavailable}}}else{$item.reason='Resolve an explicit chart target with one windowId.'}
        $items.Add($item)
    }
    return @{items=$items.ToArray();nextStart=$(if($start+$count -lt $charts.Count){$start+$count}else{$null});windowIds=$windows}
}
function Get-ExcelChartSelection($entry,[string]$sheet,[string]$name,[string]$session){
    $object=$entry.doc.Worksheets.Item($sheet).ChartObjects().Item($name);$ref=@{sheet=$sheet;name=$name;objectId=(Get-ExcelChartIdentity $object);hostSessionId=$session;revision=''}
    $snapshot=Read-ExcelChart $entry $ref $false
    try{$snapshot=Read-ExcelChartFormat $entry $snapshot.reference}catch{}
    return @{kind='excel-chart';hostSessionId=$session;chart=$snapshot.reference;contentHash=$snapshot.reference.revision;preview=(ConvertTo-Json -InputObject @{name=$name;sheet=$sheet;geometry=$snapshot.geometry;title=$snapshot.content.title} -Compress)}
}
function Write-ExcelChartLayout($entry,$data){
    if($data.properties -or $data.restoreFormat){return Write-ExcelChartFormat $entry $data}
    if($entry.doc.ReadOnly){return @{verified=$false;notIssued=$true;code='READ_ONLY'}}
    $sheet=$entry.doc.Worksheets.Item([string]$data.reference.sheet)
    if($sheet.ProtectContents -or $sheet.ProtectDrawingObjects){return @{verified=$false;notIssued=$true;code='PROTECTED_CHART'}}
    try{$before=if($data.reference.formatRevision){Read-ExcelChartFormat $entry $data.reference}else{Read-ExcelChart $entry $data.reference}}catch{if($_.Exception.Message -match 'REVISION_CONFLICT'){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}};throw}
    $fields=if($data.restore){@($data.fields)}else{@($data.geometry.PSObject.Properties.Name)}
    if($fields.Count -lt 1 -or $fields.Count -gt 4){throw 'EXCEL_CHART_GEOMETRY_LIMIT'}
    $wanted=[ordered]@{};foreach($key in $before.geometry.Keys){$wanted[$key]=$before.geometry[$key]}
    foreach($field in $fields){if(-not $before.geometry.Contains($field)){throw 'EXCEL_CHART_PROPERTY_UNKNOWN'};$value=if($data.restore){[double]$data.restore.geometry.$field}else{[double]$data.geometry.$field};if([double]::IsNaN($value) -or [double]::IsInfinity($value) -or $value -lt 0 -or (-not $data.restore -and (($field -in @('width','height') -and ($value -lt 10 -or $value -gt 4000)) -or ($field -in @('left','top') -and $value -gt 10000)))){throw 'EXCEL_CHART_GEOMETRY_VALUE'};$wanted[$field]=$value}
    $object=$sheet.ChartObjects().Item([string]$data.reference.name)
    if((Get-ExcelChartIdentity $object) -cne [string]$data.reference.objectId){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}}
    if([int]$object.ShapeRange.Count -ne 1 -or [int]$object.ShapeRange.Item(1).Type -eq 6){return @{verified=$false;notIssued=$true;code='GROUPED_CHART_UNSUPPORTED'}}
    foreach($field in $fields){$object.$field=[double]$wanted[$field]}
    $after=if($data.reference.formatRevision){Read-ExcelChartFormat $entry $data.reference $false}else{Read-ExcelChart $entry $data.reference $false};$verified=$after.contentHash -ceq $before.contentHash
    foreach($key in $wanted.Keys){if([Math]::Abs($after.geometry[$key]-$wanted[$key]) -gt 0.02){$verified=$false}}
    return @{before=$before;after=$after;verified=$verified;revision=$after.reference.revision;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
