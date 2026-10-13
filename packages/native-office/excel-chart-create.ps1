$script:excelChartTypes=@{column=51;bar=57;line=4;pie=5}
function Compare-ExcelChartSource($current,$before){
    foreach($key in @('values','formulas','numberFormat')){if((ConvertTo-Json -InputObject $current.$key -Depth 12 -Compress) -cne (ConvertTo-Json -InputObject $before.$key -Depth 12 -Compress)){return $false}}
    return $true
}
function Read-ExcelChartCreate($entry,$data,[bool]$skipPackageProbe=$false){
    if($entry.kind -ne 'excel'){throw 'HOST_KIND'};$null=Assert-SelectionIdentity $entry $data.source
    if([int]$entry.doc.FileFormat -ne 51){throw 'EXCEL_CHART_XLSX_REQUIRED'}
    $sheet=$entry.doc.Worksheets.Item([string]$data.source.sheet);$range=$sheet.Range([string]$data.source.range)
    if($entry.doc.ReadOnly -or $sheet.ProtectContents -or $sheet.ProtectDrawingObjects){throw 'EXCEL_CHART_READ_ONLY_OR_PROTECTED'}
    if($range.CountLarge -gt 1000 -or $range.Rows.Count -lt 2 -or $range.Rows.Count -gt 200 -or $range.Columns.Count -lt 2 -or $range.Columns.Count -gt 20 -or $range.MergeCells -ne $false -or $range.EntireRow.Hidden -ne $false -or $range.EntireColumn.Hidden -ne $false){throw 'EXCEL_CHART_SOURCE_SCOPE'}
    if(-not $script:excelChartTypes.ContainsKey([string]$data.type) -or ([string]$data.type -eq 'pie' -and $range.Columns.Count -ne 2)){throw 'EXCEL_CHART_TYPE'}
    $state=Read-Range $entry @{sheet=$data.source.sheet;range=$data.source.range};$numeric=0
    if((ConvertTo-Json -InputObject $state -Depth 12 -Compress).Length -gt 512000){throw 'EXCEL_CHART_SOURCE_TEXT_LIMIT'}
    for($c=0;$c -lt $range.Columns.Count;$c++){if($state.values[0][$c] -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$state.values[0][$c])){throw 'EXCEL_CHART_HEADERS_REQUIRED'}}
    for($r=1;$r -lt $range.Rows.Count;$r++){
        if($null -eq $state.values[$r][0] -or [string]$state.values[$r][0] -eq '' -or $state.values[$r][0] -is [bool]){throw 'EXCEL_CHART_CATEGORIES_REQUIRED'}
        for($c=1;$c -lt $range.Columns.Count;$c++){$value=$state.values[$r][$c];if($null -eq $value -or ($value -is [string] -and $value -ceq '')){continue};if($value -isnot [ValueType] -or $value -is [bool] -or $value -is [int] -or [double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value)){throw 'EXCEL_CHART_NUMERIC_SERIES_REQUIRED'};$numeric++}
    }
    if($numeric -eq 0){throw 'EXCEL_CHART_NUMERIC_SERIES_REQUIRED'}
    $charts=$sheet.ChartObjects();if($charts.Count -ge 1000){throw 'EXCEL_CHART_COUNT_LIMIT'};$ids=[Collections.Generic.List[string]]::new()
    for($i=1;$i -le $sheet.Shapes.Count;$i++){if([string]$sheet.Shapes.Item($i).Name -ieq [string]$data.name){throw 'EXCEL_CHART_NAME_EXISTS'}}
    for($i=1;$i -le $charts.Count;$i++){$chart=$charts.Item($i);if([string]$chart.Name -ceq [string]$data.name){throw 'EXCEL_CHART_NAME_EXISTS'};$ids.Add((Get-ExcelChartIdentity $chart))}
    if(-not $skipPackageProbe){$null=Test-ExcelChartPackage $entry}
    return @{source=$data.source;sourceState=$state;chartIds=$ids.ToArray()}
}
function Write-ExcelChartCreate($entry,$data){
    try{$before=Read-ExcelChartCreate $entry $data $true}catch{return @{verified=$false;notIssued=$true;code='CHART_CREATE_PREFLIGHT';message=$_.Exception.Message}}
    if(-not (Compare-ExcelChartSource $before.sourceState $data.before.sourceState) -or (ConvertTo-Json -InputObject $before.chartIds -Compress) -cne (ConvertTo-Json -InputObject $data.before.chartIds -Compress)){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}}
    $sheet=$entry.doc.Worksheets.Item([string]$data.source.sheet);$range=$sheet.Range([string]$data.source.range);$object=$null;$ref=$null
    try{
        $object=$sheet.ChartObjects().Add([double]$data.geometry.left,[double]$data.geometry.top,[double]$data.geometry.width,[double]$data.geometry.height);$object.Name=[string]$data.name
        $chart=$object.Chart;$chart.ChartType=[int]$script:excelChartTypes[[string]$data.type];$null=$chart.SetSourceData($range,2);$chart.HasTitle=[bool]([string]$data.title -ne '');if($chart.HasTitle){$chart.ChartTitle.Text=[string]$data.title};$chart.HasLegend=[bool]$data.legend;if($null -ne $data.style){$chart.ChartStyle=[int]$data.style}
        $selection=Get-ExcelChartSelection $entry ([string]$data.source.sheet) ([string]$data.name) ([string]$data.source.hostSessionId);$ref=$selection.chart;$guard=Read-ExcelChartPackageGuard $entry $ref;$after=Read-ExcelChart $entry $ref;$after.sourceState=Read-Range $entry @{sheet=$data.source.sheet;range=$data.source.range};$after.packageGuard=$guard
        $verified=(Compare-ExcelChartSource $after.sourceState $before.sourceState) -and $after.content.type -eq [int]$script:excelChartTypes[[string]$data.type] -and $after.content.title -ceq [string]$data.title -and $after.content.hasLegend -eq [bool]$data.legend -and $sheet.ChartObjects().Count -eq $before.chartIds.Count+1
        foreach($field in @('left','top','width','height')){if([Math]::Abs($after.geometry[$field]-[double]$data.geometry.$field) -gt 0.02){$verified=$false}}
        if($null -ne $data.style -and [int]$chart.ChartStyle -ne [int]$data.style){$verified=$false};$series=$chart.SeriesCollection();if($series.Count -ne $range.Columns.Count-1){$verified=$false}
        for($c=1;$c -le $series.Count;$c++){
            $item=$series.Item($c);$values=@($item.Values);$categories=@($item.XValues)
            if($values.Count -ne $range.Rows.Count-1 -or $categories.Count -ne $range.Rows.Count-1){$verified=$false;continue}
            for($r=1;$r -lt $range.Rows.Count;$r++){if([string]$categories[$r-1] -cne [string]$before.sourceState.values[$r][0]){$verified=$false};$expected=$before.sourceState.values[$r][$c];if($null -ne $expected -and -not ($expected -is [string] -and $expected -ceq '') -and [double]$values[$r-1] -ne [double]$expected){$verified=$false}}
        }
        return @{before=$before;after=$after;verified=$verified;revision=$after.reference.revision;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
    }catch{return @{before=$before;verified=$false;code='CHART_CREATE_PARTIAL';createdReference=$ref;message=$_.Exception.Message;instruction='Inspect the new chart and retained journal; do not replay or auto-delete an uncertain creation.'}}
}
function Remove-ExcelCreatedChart($entry,$data){
    $sheet=$entry.doc.Worksheets.Item([string]$data.reference.sheet)
    if($entry.doc.ReadOnly -or $sheet.ProtectContents -or $sheet.ProtectDrawingObjects){return @{verified=$false;notIssued=$true;code='READ_ONLY_OR_PROTECTED'}}
    try{$before=Read-ExcelChart $entry $data.reference}catch{if($_.Exception.Message -match 'REVISION_CONFLICT'){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}};throw}
    $source=Read-Range $entry @{sheet=$data.source.sheet;range=$data.source.range}
    if(-not (Compare-ExcelChartSource $source $data.sourceState) -or (Read-ExcelChartPackageGuard $entry $data.reference).hash -cne [string]$data.expectedGuard){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}}
    $objects=$sheet.ChartObjects();$ids=[Collections.Generic.List[string]]::new();for($i=1;$i -le $objects.Count;$i++){$id=Get-ExcelChartIdentity $objects.Item($i);if($id -cne [string]$data.reference.objectId){$ids.Add($id)}}
    $object=$objects.Item([string]$data.reference.name);if((Get-ExcelChartIdentity $object) -cne [string]$data.reference.objectId){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}};$null=$object.Delete()
    $remaining=[Collections.Generic.List[string]]::new();for($i=1;$i -le $sheet.ChartObjects().Count;$i++){$remaining.Add((Get-ExcelChartIdentity $sheet.ChartObjects().Item($i)))}
    $verified=(ConvertTo-Json -InputObject $remaining.ToArray() -Compress) -ceq (ConvertTo-Json -InputObject $ids.ToArray() -Compress) -and (Compare-ExcelChartSource (Read-Range $entry @{sheet=$data.source.sheet;range=$data.source.range}) $source)
    return @{before=$before;verified=$verified;removed=$true;revision=(Hash-Text (ConvertTo-Json -InputObject $remaining.ToArray() -Compress));code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
