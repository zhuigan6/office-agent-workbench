$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/fingerprint.ps1')
. (Join-Path $PSScriptRoot '../packages/native-office/word-table-layout.ps1')
$before='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tblPr><w:tblW w:w="9000"/><w:tblCellMar><w:left w:w="10"/></w:tblCellMar><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tblPrEx><w:tblCellMar><w:top w:w="0"/></w:tblCellMar></w:tblPrEx><w:tc><w:tcPr/><w:p><w:r><w:t>Keep</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
$after='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tblPr><w:tblW w:w="9000"/><w:jc w:val="center"/><w:tblCellMar><w:left w:w="120"/><w:top w:w="80"/></w:tblCellMar><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/><w:jc w:val="center"/></w:trPr><w:tc><w:tcPr/><w:p><w:r><w:t>Keep</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
$expected=Get-WordLayoutContent $before
if((Get-WordLayoutContent $after) -cne $expected){throw 'SUPPORTED_LAYOUT_NORMALIZATION_FAILED'}
$mutations=@(
    ($after.Replace('9000','9001')),
    ($after.Replace('4500','4600')),
    ($after.Replace('single','double')),
    ($after.Replace('Keep','Changed')),
    ($after.Replace('<w:tcPr/>','<w:tcPr><w:shd w:fill="FF0000"/></w:tcPr>')),
    ($after.Replace('<w:trPr>','<w:trPr><w:trHeight w:val="400"/>')),
    ($after.Replace('<w:trPr>','<w:tblPrEx><w:tblW w:w="7777"/></w:tblPrEx><w:trPr>'))
)
foreach($xml in $mutations){if((Get-WordLayoutContent $xml) -ceq $expected){throw 'UNRELATED_CHANGE_IGNORED'}}
@{normalization=$true;unrelatedChangesRejected=$mutations.Count}|ConvertTo-Json -Compress
