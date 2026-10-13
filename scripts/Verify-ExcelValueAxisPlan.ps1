param()
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/excel-chart-format.ps1')
$before=[ordered]@{scaleType=-4132;minimum=0.0;maximum=200.0;minimumAuto=$false;maximumAuto=$false;majorUnit=50.0;minorUnit=10.0;majorUnitAuto=$false;minorUnitAuto=$false;numberFormat='General';numberFormatLinked=$true}
$properties=[pscustomobject]@{minimum=400.0;maximum=800.0;majorUnit=100.0;minorUnit=20.0;numberFormat='0.00'}
$plan=Get-ExcelChartValueAxisPlan $before $properties
if($plan.minimum -ne 400 -or $plan.maximum -ne 800 -or $plan.majorUnit -ne 100 -or $plan.numberFormatLinked -ne $false){throw 'COMPOUND_AXIS_PLAN'}
if($before.minimum -ne 0 -or $before.numberFormatLinked -ne $true){throw 'AXIS_PLAN_MUTATED_CAPTURE'}
$auto=Get-ExcelChartValueAxisPlan $plan ([pscustomobject]@{minimum=$null;maximum=$null;majorUnit=$null;minorUnit=$null;numberFormatLinked=$true})
foreach($key in @('minimumAuto','maximumAuto','majorUnitAuto','minorUnitAuto')){if(-not $auto[$key]){throw 'AXIS_AUTO_PLAN'}}
$actual=[ordered]@{};foreach($key in $auto.Keys){$actual[$key]=$auto[$key]};$actual.minimum=-10;$actual.maximum=300;$actual.majorUnit=50;$actual.minorUnit=10;$actual.numberFormat='Source format'
if(-not (Test-ExcelChartValueAxis $auto $actual)){throw 'AUTO_RESOLVED_VALUES_ARE_NOT_FIXED_VALUES'}
$actual.minimumAuto=$false;if(Test-ExcelChartValueAxis $auto $actual){throw 'AUTO_FLAG_MUST_MATCH'}
foreach($bad in @(@{minimum=300},@{majorUnit=0},@{minorUnit=-1},@{maximum=[double]::PositiveInfinity},@{minimum=$true},@{numberFormat="bad`nformat"},@{numberFormat='0.00';numberFormatLinked=$true},@{categoryType=1})){
    $denied=$false;try{$null=Get-ExcelChartValueAxisPlan $before ([pscustomobject]$bad)}catch{$denied=$true};if(-not $denied){throw 'AXIS_BAD_INPUT_ACCEPTED'}
}
$log=[ordered]@{};foreach($key in $before.Keys){$log[$key]=$before[$key]};$log.scaleType=-4133
$denied=$false;try{$null=Get-ExcelChartValueAxisPlan $log $properties}catch{$denied=$true};if(-not $denied){throw 'LOG_AXIS_CHANGED_AS_LINEAR'}
. (Join-Path $PSScriptRoot '../packages/native-office/excel-charts.ps1')
$script:chartRead=[ordered]@{reference=@{name='Chart1'};geometry=@{left=20};content=@{title='Fixture'};format=@{type=4};valueAxis=$plan}
function Read-ExcelChartFormat($entry,$ref,[bool]$checkRevision=$true){return $script:chartRead}
function Read-ExcelChart($entry,$ref,[bool]$checkRevision=$true){return $script:chartRead}
function Get-ExcelChartIdentity($object){return 'shape:1'}
function Get-OfficeWindowIdentity($kind,$window){return 'window:1'}
$script:charts=[pscustomobject]@{Count=1};$script:charts|Add-Member ScriptMethod Item {param($index)return [pscustomobject]@{Name='Chart1'}}
$script:sheet=[pscustomobject]@{Name='Sheet1'};$script:sheet|Add-Member ScriptMethod ChartObjects {return $script:charts}
$sheets=[pscustomobject]@{};$sheets|Add-Member ScriptMethod Item {param($name)return $script:sheet}
$windows=[pscustomobject]@{Count=1};$windows|Add-Member ScriptMethod Item {param($index)return [pscustomobject]@{}}
$entry=@{kind='excel';doc=[pscustomobject]@{Worksheets=$sheets;Windows=$windows}}
$data=[pscustomobject]@{sheet='Sheet1';start=0;count=5;includeFormat=$true}
$page=Read-ExcelCharts $entry $data
if($page.items.Count -ne 1 -or (ConvertTo-Json -InputObject $page.items[0].valueAxis -Compress) -cne (ConvertTo-Json -InputObject $plan -Compress)){throw 'AXIS_MISSING_FROM_RICH_CHART_LIST'}
$data.includeFormat=$false;$page=Read-ExcelCharts $entry $data;if($page.items[0].ContainsKey('valueAxis')){throw 'LEGACY_CHART_LIST_EXPANDED'}
'EXCEL_VALUE_AXIS_PLANS=PASS'
