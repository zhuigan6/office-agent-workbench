$ErrorActionPreference='Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'packages/native-office/word-tables.ps1')
$xml='<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Keep</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Restore</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document></pkg:xmlData></pkg:part><pkg:part pkg:name="/word/styles.xml"><pkg:xmlData><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="Normal"/></w:styles></pkg:xmlData></pkg:part></pkg:package>'
[xml]$result=Get-WordCellRestorePackage $xml 1 2
$ns=[Xml.XmlNamespaceManager]::new($result.NameTable);$ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main');$ns.AddNamespace('pkg','http://schemas.microsoft.com/office/2006/xmlPackage')
$body=$result.SelectSingleNode('//w:body',$ns)
if($body.SelectNodes('w:p',$ns).Count -ne 1 -or $body.SelectNodes('.//w:tbl',$ns).Count -ne 0 -or $body.InnerText -cne 'Restore' -or $body.SelectNodes('.//w:b',$ns).Count -ne 1){throw 'Restoration package must contain only the selected rich paragraph.'}
if($result.SelectNodes("/pkg:package/pkg:part[@pkg:name='/word/styles.xml']",$ns).Count -ne 1){throw 'Style package part lost.'}
[xml]$nested=$xml
$manager=[Xml.XmlNamespaceManager]::new($nested.NameTable);$manager.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
$first=$nested.SelectSingleNode('//w:tc',$manager);$child=$nested.CreateElement('w','tbl','http://schemas.openxmlformats.org/wordprocessingml/2006/main');$null=$first.AppendChild($child)
$failed=$false;try{$null=Get-WordCellRestorePackage $nested.OuterXml 1 2}catch{$failed=$true};if(-not $failed){throw 'Nested table outside selected cell accepted.'}
foreach($pair in @(@(0,1),@(2,1),@(1,3))){$failed=$false;try{$null=Get-WordCellRestorePackage $xml $pair[0] $pair[1]}catch{$failed=$true};if(-not $failed){throw 'Invalid cell accepted.'}}
$failed=$false;try{$null=Get-WordCellRestorePackage '<!DOCTYPE a [<!ENTITY e "boom">]><a>&e;</a>' 1 1}catch{$failed=$true};if(-not $failed){throw 'DTD accepted.'}
'WORD_CELL_PACKAGE=PASS'
