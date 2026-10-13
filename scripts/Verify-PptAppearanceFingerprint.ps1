$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/ppt-frame-package.ps1')
[xml]$plain='<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><p:spPr><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1800"/><a:t>Keep text</a:t></a:r></a:p></p:txBody></p:sp>'
$expected=Get-PptFrameContentXml $plain.DocumentElement $true
$hidden=$plain.CloneNode($true)
$fragment=$hidden.CreateDocumentFragment();$fragment.InnerXml='<a:extLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><a:ext uri="{909E8E84-426E-40DD-AFC4-6F175D3DCCD1}"><a14:hiddenFill><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a14:hiddenFill></a:ext><a:ext uri="{91240B29-F687-4F45-9708-019B960494DF}"><a14:hiddenLine/></a:ext></a:extLst>'
$null=$hidden.SelectSingleNode('//*[local-name()="spPr"]').AppendChild($fragment)
if((Get-PptFrameContentXml $hidden.DocumentElement $true) -cne $expected){throw 'HIDDEN_APPEARANCE_MASK_FAILED'}
if((Get-PptFrameContentXml $hidden.DocumentElement) -ceq (Get-PptFrameContentXml $plain.DocumentElement)){throw 'LEGACY_HASH_CHANGED'}
foreach($change in @('text','font','extension','namespace','extraChild','extraAttribute','foreignFill')){
    $copy=$hidden.CloneNode($true)
    switch($change){
        text {$copy.SelectSingleNode('//*[local-name()="t"]').InnerText='Different text'}
        font {$copy.SelectSingleNode('//*[local-name()="rPr"]').SetAttribute('sz','2400')}
        extension {$copy.SelectSingleNode('//*[local-name()="ext"]').SetAttribute('uri','unknown-extension')}
        namespace {$n=$copy.SelectSingleNode('//*[local-name()="hiddenFill"]');$new=$copy.CreateElement('foreign','hiddenFill','urn:foreign');$null=$n.ParentNode.ReplaceChild($new,$n)}
        extraChild {$n=$copy.SelectSingleNode('//*[local-name()="ext"]');$null=$n.AppendChild($copy.CreateElement('extra'))}
        extraAttribute {$copy.SelectSingleNode('//*[local-name()="ext"]').SetAttribute('unknown','keep')}
        foreignFill {$null=$copy.SelectSingleNode('//*[local-name()="spPr"]').AppendChild($copy.CreateElement('foreign','solidFill','urn:foreign'))}
    }
    if((Get-PptFrameContentXml $copy.DocumentElement $true) -ceq $expected){throw "REAL_CHANGE_MASKED_$change"}
}
@{hiddenAppearanceMask=$true;legacyHashUnchanged=$true;textAndFontGuard=$true;unknownExtensionGuard=$true;exactNamespaceAndChildren=$true}|ConvertTo-Json -Compress
