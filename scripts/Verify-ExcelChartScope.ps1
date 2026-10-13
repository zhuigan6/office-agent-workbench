$ErrorActionPreference='Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'packages/native-office/excel-charts.ps1')
$chart=[pscustomobject]@{ChartArea=[pscustomobject]@{Name='Chart Area'}};$object=[pscustomobject]@{Name='Sales chart'}
foreach($name in @('Chart Area','Sales chart')){$null=Assert-ExcelChartSelectionScope ([pscustomobject]@{Name=$name}) $chart $object}
foreach($name in @('Chart Title','Series 1','Value Axis')){
    $rejected=$false
    try{$null=Assert-ExcelChartSelectionScope ([pscustomobject]@{Name=$name}) $chart $object}catch{if($_.Exception.Message -notmatch 'SELECTION_CHART_COMPONENT'){throw};$rejected=$true}
    if(-not $rejected){throw 'Component selection was widened.'}
}
'EXCEL_CHART_SELECTION_SCOPE=PASS'
