param([string]$BeforePackage,[string]$RestoredPackage)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/ppt-frame-package.ps1')
[xml]$source='<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1800" lang="en-US"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:rPr><a:t>text</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>'
$original=Get-PptFrameContentXml $source.DocumentElement
$copy=$source.CloneNode($true)
foreach($n in @($copy.SelectNodes('//*[local-name()="rPr" or local-name()="endParaRPr"]'))){$n.SetAttribute('dirty','0')}
if((Get-PptFrameContentXml $copy.DocumentElement) -cne $original){throw 'PROOFING_NORMALIZATION_FAILED'}
$copy=$source.CloneNode($true);$run=$copy.SelectSingleNode('//*[local-name()="r"]');$second=$run.CloneNode($true);$run.SelectSingleNode('./*[local-name()="t"]').InnerText='te';$second.SelectSingleNode('./*[local-name()="t"]').InnerText='xt';$null=$run.ParentNode.InsertAfter($second,$run)
if((Get-PptFrameContentXml $copy.DocumentElement) -cne $original){throw 'IDENTICAL_RUN_SPLIT_FAILED'}
$second.SelectSingleNode('./*[local-name()="rPr"]').SetAttribute('sz','1900')
if((Get-PptFrameContentXml $copy.DocumentElement) -ceq $original){throw 'RUN_STYLE_BOUNDARY_MASKED'}
foreach($kind in @('font','text','color','language')){
    $copy=$source.CloneNode($true)
    switch($kind){
        font {$copy.SelectSingleNode('//*[local-name()="rPr"]').SetAttribute('sz','1900')}
        text {$copy.SelectSingleNode('//*[local-name()="t"]').InnerText='changed'}
        color {$copy.SelectSingleNode('//*[local-name()="srgbClr"]').SetAttribute('val','445566')}
        language {$copy.SelectSingleNode('//*[local-name()="rPr"]').SetAttribute('lang','zh-CN')}
    }
    if((Get-PptFrameContentXml $copy.DocumentElement) -ceq $original){throw "REAL_CHANGE_MASKED_$kind"}
}
$packagesMatch=$null
if($BeforePackage -or $RestoredPackage){
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $values=@(foreach($file in @($BeforePackage,$RestoredPackage)){
        $allowed=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.local/verification')).TrimEnd('\')+'\'
        $path=[IO.Path]::GetFullPath($file)
        if(-not $path.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'PRIVATE_PACKAGE_REQUIRED'}
        $zip=[IO.Compression.ZipFile]::OpenRead($path)
        try{$reader=[IO.StreamReader]::new($zip.GetEntry('ppt/slides/slide1.xml').Open());[xml]$xml=$reader.ReadToEnd();$reader.Dispose();$shape=$xml.SelectSingleNode('//*[local-name()="sp"][*[local-name()="nvSpPr"]/*[local-name()="cNvPr"][@name="WorkbenchParagraphProbe"]]');if(-not $shape){throw 'EXACT_PROBE_REQUIRED'};Get-PptFrameContentXml $shape}finally{$zip.Dispose()}
    })
    $packagesMatch=$values[0] -ceq $values[1]
    if(-not $packagesMatch){throw 'NATIVE_PACKAGE_CONTENT_CHANGED'}
}
@{proofingIgnored=$true;identicalRunsMerged=$true;runStyleGuard=$true;fontGuard=$true;textGuard=$true;colorGuard=$true;languageGuard=$true;nativePackagesMatch=$packagesMatch}|ConvertTo-Json -Compress
