$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/fingerprint.ps1')
. (Join-Path $PSScriptRoot '../packages/native-office/word-table-layout.ps1')
. (Join-Path $PSScriptRoot '../packages/native-office/word-table-widths.ps1')
$before='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/><w:shd w:fill="FFFFFF"/></w:tcPr><w:p><w:r><w:t>Keep</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
$after=$before.Replace('9000','7200').Replace('4500','3600').Replace('<w:tblW','<w:tblLayout w:type="fixed"/><w:tblW')
if((Get-WordLayoutContent $before) -ceq (Get-WordLayoutContent $after)){throw 'LEGACY_PROOF_LOST_WIDTH_GUARD'}
$expected=Get-WordLayoutContent $before $true
if((Get-WordLayoutContent $after $true) -cne $expected){throw 'REQUESTED_WIDTH_NORMALIZATION_FAILED'}
$declared=Get-WordDeclaredTableWidth $after;if($declared.preferredType -ne 3 -or $declared.preferred -ne 360){throw 'DECLARED_POINT_WIDTH_FAILED'}
$percent=Get-WordDeclaredTableWidth ($before.Replace('9000','3750').Replace('w:type="dxa"','w:type="pct"'));if($percent.preferredType -ne 2 -or $percent.preferred -ne 75){throw 'DECLARED_PERCENT_WIDTH_FAILED'}
foreach($mutation in @($after.Replace('Keep','Changed'),$after.Replace('single','double'),$after.Replace('FFFFFF','FF0000'),$after.Replace('<w:tcPr>','<w:tcPr><w:vAlign w:val="center"/>'),$after.Replace('<w:tr>','<w:tr><w:trPr><w:trHeight w:val="400"/></w:trPr>'))){if((Get-WordLayoutContent $mutation $true) -ceq $expected){throw 'UNSUPPORTED_CHANGE_IGNORED'}}
@{requestedWidthsOnly=$true;legacyWidthGuard=$true;unrelatedChangesRejected=5}|ConvertTo-Json -Compress
