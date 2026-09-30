$ErrorActionPreference='Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'packages\native-office\fingerprint.ps1')
$base='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p w:rsidR="123"><w:r><w:rPr><w:b/></w:rPr><w:t>text</w:t></w:r></w:p><w:rsids><w:rsid w:val="123"/></w:rsids><w:ins w:author="User"><w:r><w:t>revision</w:t></w:r></w:ins></w:document>'
$a=Get-WordSemanticXml $base
$b=Get-WordSemanticXml ($base.Replace('123','456'))
if($a -ne $b){throw 'Volatile rsid identifiers caused a false conflict'}
if($a -eq (Get-WordSemanticXml ($base.Replace('text','changed')))){throw 'Text mutation was ignored'}
if($a -eq (Get-WordSemanticXml ($base.Replace('<w:b/>','<w:i/>')))){throw 'Formatting mutation was ignored'}
if($a -eq (Get-WordSemanticXml ($base.Replace('revision','different revision')))){throw 'Tracked content was ignored'}
'NATIVE_FINGERPRINT_TESTS=PASS'
