$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/fingerprint.ps1')
. (Join-Path $PSScriptRoot '../packages/native-office/word-style-restoration.ps1')
function Package([string]$styles,[string]$body='<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>keep</w:t></w:r></w:p>'){
    return '<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><pkg:part pkg:name="/word/styles.xml"><pkg:xmlData><w:styles>'+$styles+'</w:styles></pkg:xmlData></pkg:part><pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document><w:body>'+$body+'</w:body></w:document></pkg:xmlData></pkg:part></pkg:package>'
}
$normal='<w:style w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'
$unused='<w:style w:styleId="Heading1"><w:link w:val="Heading1Char"/></w:style><w:style w:styleId="Heading1Char"><w:link w:val="Heading1"/></w:style>'
$original=Package $normal
$allowed=Test-WordStyleRestoration $original (Package ($normal+$unused))
if(-not $allowed.equivalent -or $allowed.added.Count -ne 2){throw 'Unused style declaration additions should be accepted.'}
$forbidden=@(
    (Package ($normal.Replace('val="Normal"','val="Changed"')+$unused)),
    (Package ($normal+'<w:style w:styleId="OtherDefault" w:default="1"/>')),
    (Package ($normal+$unused) '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p>'),
    (Package ($normal+$unused) '<w:p><w:r><w:t>changed</w:t></w:r></w:p>'),
    (Package ($normal+'<w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault></w:docDefaults>'))
)
foreach($xml in $forbidden){if((Test-WordStyleRestoration $original $xml).equivalent){throw 'Changed content, defaults or referenced styles were accepted.'}}
$linked='<w:style w:styleId="Normal" w:default="1"><w:link w:val="NewChar"/></w:style>'
if((Test-WordStyleRestoration (Package $linked) (Package ($linked+'<w:style w:styleId="NewChar"/>'))).equivalent){throw 'New definition referenced by an existing style was accepted.'}
'WORD_STYLE_EQUIVALENCE=PASS'
