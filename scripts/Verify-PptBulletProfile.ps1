$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/ppt-lists.ps1')
$baseline=[ordered]@{visible=0;type=0;character=8226;relativeSize=1;start=1;details=[ordered]@{style=3;useTextFont=-1;useTextColor=-1}}
$properties=ConvertFrom-Json '{"type":"character","character":8226,"relativeSize":0.8}'
$wanted=Get-PptBulletMutation $baseline $properties $null
$actual=[ordered]@{};foreach($key in $wanted.Keys){$actual[$key]=$wanted[$key]};$actual.relativeSize=0.800000011920929
if(-not (Test-PptBulletProfile $wanted $actual)){throw 'FLOAT_READBACK_NOT_ACCEPTED'}
$actual.character=9632
if(Test-PptBulletProfile $wanted $actual){throw 'WRONG_CHARACTER_ACCEPTED'}
$number=Get-PptBulletMutation $baseline (ConvertFrom-Json '{"type":"numbered","style":7,"start":4}') $null
if($number.type -ne 2 -or $number.details.style -ne 7 -or $number.start -ne 4 -or $baseline.details.style -ne 3){throw 'NUMBER_PLAN_CHANGED_SOURCE'}
$disabled=Get-PptBulletMutation $number (ConvertFrom-Json '{"type":"none"}') $null
if($disabled.start -ne 1 -or $disabled.type -ne 0 -or $disabled.visible -ne 0){throw 'DISABLED_NUMBERING_START_NOT_NORMALIZED'}
$saved=$baseline|ConvertTo-Json -Depth 8|ConvertFrom-Json
$restore=Get-PptBulletMutation $number (ConvertFrom-Json '{"type":"none"}') $saved
if(-not (Test-PptBulletProfile $baseline $restore)){throw 'JSON_RESTORE_PROFILE_LOST'}
$picture=[ordered]@{};foreach($key in $baseline.Keys){$picture[$key]=$baseline[$key]};$picture.type=3;$refused=$false
try{Get-PptBulletMutation $picture $properties $null|Out-Null}catch{$refused=$_.Exception.Message -eq 'PPT_PARAGRAPH_BULLET_SOURCE_UNSUPPORTED'}
if(-not $refused){throw 'PICTURE_BULLET_PROFILE_OVERWRITTEN'}
. (Join-Path $PSScriptRoot '../packages/native-office/ppt-paragraph.ps1')
Add-Type -TypeDefinition @'
public class WorkbenchBulletIndentState {
 public double LeftIndent {get;set;}
 public double FirstLineIndent {get;set;}
 public double RightIndent {get;set;}
}
public class WorkbenchBulletResetProbe {
 int type;
 public WorkbenchBulletIndentState Indents;
 public int Style {get;set;}
 public int Character {get;set;}
 public int StartValue {get;set;}
 public double RelativeSize {get;set;}
 public int UseTextFont {get;set;}
 public int UseTextColor {get;set;}
 public int Visible {get;set;}
 public int Type {get{return type;}set{type=value;if(value==2){Indents.LeftIndent=45;Indents.FirstLineIndent=-27;}}}
}
'@
$modern=[WorkbenchBulletIndentState]::new();$bullet=[WorkbenchBulletResetProbe]::new();$bullet.Indents=$modern;$bullet.Style=3;$bullet.Character=8226;$bullet.StartValue=1;$bullet.RelativeSize=1;$bullet.UseTextFont=-1;$bullet.UseTextColor=-1
$range=[pscustomobject]@{Format=[pscustomobject]@{Bullet=$bullet}};$range|Add-Member ScriptMethod Paragraphs {param($a,$b) return [pscustomobject]@{ParagraphFormat=$this.Format}}
$modernRange=[pscustomobject]@{Format=$modern};$modernRange|Add-Member ScriptMethod Paragraphs {param($a,$b) return [pscustomobject]@{ParagraphFormat=$this.Format}}
$shape=[pscustomobject]@{TextFrame=[pscustomobject]@{TextRange=$range};TextFrame2=[pscustomobject]@{TextRange=$modernRange}}
$values=[ordered]@{LeftIndent=36;RightIndent=6;FirstLineIndent=-18;bullet=$number}
Set-PptParagraphPlan $shape @{mutations=@(@{index=1;values=$values})}
if($modern.LeftIndent -ne 36 -or $modern.FirstLineIndent -ne -18 -or $modern.RightIndent -ne 6 -or $bullet.Type -ne 2){throw 'NUMBERING_RESET_OVERRIDES_REQUESTED_INDENT'}
@{floatReadback=$true;wrongCharacterRejected=$true;numberPlan=$true;jsonRestore=$true;pictureRefused=$true}|ConvertTo-Json -Compress
