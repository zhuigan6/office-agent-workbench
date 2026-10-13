$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/word-readonly.ps1')
function New-Doc([string]$caption,[bool]$readonly=$false,[int]$protection=-1){$windows=[pscustomobject]@{Count=1;Caption=$caption};$windows|Add-Member ScriptMethod Item {param($i) return [pscustomobject]@{Caption=$this.Caption}};return [pscustomobject]@{Name='test.docx';ReadOnly=$readonly;ProtectionType=$protection;Windows=$windows}}
$doc=New-Doc 'test.docx';if(Get-WordWriteRestriction $doc){throw 'ORDINARY_WORD_DENIED'}
if((Get-WordWriteRestriction (New-Doc 'test.docx' $true)) -cne 'native-readonly'){throw 'NATIVE_READONLY_LOST'}
if((Get-WordWriteRestriction (New-Doc 'test.docx' $false 3)) -cne 'document-protection'){throw 'PROTECTION_LOST'}
foreach($caption in @('test.docx - Read-Only','test.docx [Read Only]',('test.docx  -  '+[char]0x53ea+[char]0x8bfb),'test.docx:2 - Read-Only')){if((Get-WordWriteRestriction (New-Doc $caption)) -cne 'window-readonly-marker'){throw 'READONLY_WINDOW_MISSED'}}
$doc=New-Doc 'test - Read-Only.docx';$doc.Name=$doc.Windows.Caption;if(Get-WordWriteRestriction $doc){throw 'FILENAME_FALSE_POSITIVE'}
$doc=New-Doc 'test.docx';$doc.Windows.Count=0;if((Get-WordWriteRestriction $doc) -cne 'window-status-unavailable'){throw 'NO_WINDOW_PERMITTED'}
# A cached writable binding must still observe a later window restriction.
$doc=New-Doc 'test.docx';if(Get-WordWriteRestriction $doc){throw 'STARTED_RESTRICTED'};$doc.Windows.Caption='test.docx - Read-Only';if(-not(Get-WordWriteRestriction $doc)){throw 'LATE_READONLY_IGNORED'}
'WORD_READONLY_GUARDS=PASS'
