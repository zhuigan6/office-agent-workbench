$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/ppt-rich-format.ps1')
$saved=[ordered]@{Name='Calibri Light';NameOther=$null;Size=20;Color=[ordered]@{type=2;rgb=0;theme=13;tint=0}}
$current=[ordered]@{Name='Calibri Light';NameOther='';Size=20;Color=[ordered]@{type=2;rgb=0;theme=13;tint=0}}
$result=Test-PptFontProfileRestore $saved $current
if(-not $result.equal -or -not $result.emptyAlias){throw 'NULL_EMPTY_ALIAS_COMPARISON_FAILED'}
$current.NameOther='Arial';if((Test-PptFontProfileRestore $saved $current).equal){throw 'NONEMPTY_ALIAS_IGNORED'}
$current.NameOther='';$current.Size=21;if((Test-PptFontProfileRestore $saved $current).equal){throw 'FONT_SIZE_CHANGE_IGNORED'}
$current.Size=20;$current.Color.theme=4;if((Test-PptFontProfileRestore $saved $current).equal){throw 'THEME_CHANGE_IGNORED'}
'PPT_ALIAS_RESTORE_BOUNDARY=PASS'
