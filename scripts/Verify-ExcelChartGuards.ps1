param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/excel-chart-format.ps1')
. (Join-Path $PSScriptRoot '../packages/native-office/excel-chart-package.ps1')
$env:WORKBENCH_NATIVE_SNAPSHOTS=$Directory
$file=Join-Path $Directory '00000000-0000-0000-0000-000000000001.crtx'
if(-not (Test-Path -LiteralPath $Directory -PathType Container) -or (Test-Path -LiteralPath $file)){throw 'NEW_TEST_ASSET_REQUIRED'}
[IO.File]::WriteAllBytes($file,[byte[]]@(1,2,3))
function Get-FileHash {throw 'OPTIONAL_CMDLET_MUST_NOT_BE_REQUIRED'}
$hash=Get-ExcelChartTemplateHash $file
if($hash -cne '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'){throw 'HASH_MISMATCH'}
$asset=[pscustomobject]@{file=[IO.Path]::GetFileName($file);sha256=$hash}
if((Resolve-ExcelChartTemplateAsset $asset) -ine $file){throw 'VALID_ASSET_REFUSED'}
foreach($bad in @([pscustomobject]@{file=$asset.file;sha256=('a'*64)},[pscustomobject]@{file='../outside.crtx';sha256=$hash})){
    $refused=$false;try{$null=Resolve-ExcelChartTemplateAsset $bad}catch{if($_.Exception.Message -cne 'EXCEL_CHART_TEMPLATE_ASSET'){throw};$refused=$true}
    if(-not $refused){throw 'INVALID_ASSET_ACCEPTED'}
}
[IO.File]::WriteAllBytes($file,[byte[]]@(1,2,4))
$refused=$false;try{$null=Resolve-ExcelChartTemplateAsset $asset}catch{if($_.Exception.Message -cne 'EXCEL_CHART_TEMPLATE_ASSET'){throw};$refused=$true}
if(-not $refused){throw 'TAMPER_ACCEPTED'}
$attributes='bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"'
foreach($mode in @('default','nonidentity','unknown','child')){
    $attrs=$attributes;$body=''
    if($mode -eq 'nonidentity'){$attrs=$attrs.Replace('accent1="accent1"','accent1="accent2"')}
    if($mode -eq 'unknown'){$attrs+=' unknown="keep"'}
    if($mode -eq 'child'){$body='<c:ext/>'}
    [xml]$xml='<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:clrMapOvr '+$attrs+'>'+$body+'</c:clrMapOvr></c:chartSpace>'
    $before=$xml.OuterXml;Remove-ExcelChartDefaultColorMap $xml
    if($mode -eq 'default'){if($xml.DocumentElement.ChildNodes.Count -ne 0){throw 'DEFAULT_MAP_NOT_NORMALIZED'}}elseif($xml.OuterXml -cne $before){throw 'MEANINGFUL_MAP_LOST'}
}
foreach($mode in @('no-relations','dangling-relation')){
    $file=Join-Path $Directory ($mode+'.crtx');$zip=[IO.Compression.ZipFile]::Open($file,[IO.Compression.ZipArchiveMode]::Create)
    try{
        $stream=$zip.CreateEntry('chart/chart.xml').Open();$writer=[IO.StreamWriter]::new($stream,[Text.UTF8Encoding]::new($false))
        try{$writer.Write('<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+$(if($mode -eq 'dangling-relation'){'<c:externalData r:id="rId1"/>'}else{'<c:chart/>'})+'</c:chartSpace>')}finally{$writer.Dispose()}
    }finally{$zip.Dispose()}
    $before=Get-ExcelChartTemplateHash $file;$refused=$false
    try{Remove-ExcelChartTemplateThemeOverride $file}catch{if($_.Exception.Message -cne 'EXCEL_CHART_TEMPLATE_RELATIONSHIP'){throw};$refused=$true}
    if($mode -eq 'no-relations' -and ($refused -or (Get-ExcelChartTemplateHash $file) -cne $before)){throw 'VALID_TEMPLATE_WITHOUT_RELS_CHANGED'}
    if($mode -eq 'dangling-relation' -and -not $refused){throw 'DANGLING_TEMPLATE_RELATION_ACCEPTED'}
}
'EXCEL_CHART_ASSET_AND_COLOR_GUARDS=PASS'
