$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/ppt-text-frame.ps1')
. (Join-Path $PSScriptRoot '../packages/native-office/ppt-frame-package.ps1')
$xml=[xml]'<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spPr><a:xfrm><a:off x="10" y="20"/></a:xfrm></p:spPr><p:txBody><a:bodyPr lIns="10" anchor="t"><a:noAutofit/></a:bodyPr><a:p><a:r><a:rPr sz="1800" b="1"/><a:t>Keep</a:t></a:r></a:p></p:txBody></p:sp>'
$modified=[xml]($xml.OuterXml.Replace('lIns="10"','lIns="120"').Replace('anchor="t"','anchor="ctr"').Replace('<a:noAutofit />','<a:normAutofit fontScale="38889" />').Replace('x="10"','x="50"'))
if((Get-PptFrameContentXml $xml.DocumentElement) -cne (Get-PptFrameContentXml $modified.DocumentElement)){throw 'CONTROLLED_FRAME_XML_NOT_NORMALIZED'}
foreach($change in @($modified.OuterXml.Replace('sz="1800"','sz="2400"'),$modified.OuterXml.Replace('Keep','Changed'),$modified.OuterXml.Replace('b="1"','b="0"'))){$bad=[xml]$change;if((Get-PptFrameContentXml $xml.DocumentElement) -ceq (Get-PptFrameContentXml $bad.DocumentElement)){throw 'INTRINSIC_FONT_OR_TEXT_CHANGE_IGNORED'}}
$font=[ordered]@{Size=18;Bold=0;Color=@{rgb=0}}
$second=[ordered]@{Size=24;Bold=0;Color=@{rgb=0}}
$before=@{text='ab';profiles=@($font,$second);paragraphs=@([ordered]@{WordWrap=-1;Alignment=1})}
$after=@{text='ab';profiles=@([ordered]@{Size=9;Bold=0;Color=@{rgb=0}},[ordered]@{Size=12;Bold=0;Color=@{rgb=0}});paragraphs=@([ordered]@{WordWrap=-1;Alignment=1})}
$frame=@{AutoSize=2;WordWrap=-1}
if(-not (Test-PptFrameText $before $after @{} $frame)){throw 'CONTROLLED_SCALE_REJECTED'}
$rounded=@{text='ab';profiles=@([ordered]@{Size=5;Bold=0;Color=@{rgb=0}},[ordered]@{Size=6;Bold=0;Color=@{rgb=0}});paragraphs=$after.paragraphs}
if(-not (Test-PptFrameText $before $rounded @{} $frame)){throw 'INDEPENDENT_ROUNDING_REJECTED'}
$rounded.profiles[1].Size=9
if(Test-PptFrameText $before $rounded @{} $frame){throw 'INCOMPATIBLE_ROUNDED_SCALE_IGNORED'}
$after.profiles[1].Size=4
if(Test-PptFrameText $before $after @{} $frame){throw 'FONT_HIERARCHY_IGNORED'}
$after.profiles[1].Size=12;$after.profiles[0].Color.rgb=255
if(Test-PptFrameText $before $after @{} $frame){throw 'UNREQUESTED_COLOR_IGNORED'}
$after.profiles[0].Color.rgb=0
if(-not (Test-PptFrameText $before $after @{restoreTextFrame=@{AutoSize=0};restoreTextProfiles=$after.profiles} @{AutoSize=0;WordWrap=-1})){throw 'SIZE_RESTORE_REJECTED'}
$initial=@{width=300;height=60;left=40;top=100;rotation=0};$actual=@{width=300;height=120;left=40;top=100;rotation=0};$auto=@{AutoSize=1;WordWrap=-1;VerticalAnchor=1;HorizontalAnchor=1}
if(-not (Test-PptFrameGeometry $initial $actual $auto $false @{available=$true;mayOverflow=$false})){throw 'AUTOMATIC_HEIGHT_REJECTED'}
$actual.left=100
if(Test-PptFrameGeometry $initial $actual $auto $false @{available=$true;mayOverflow=$false}){throw 'UNREQUESTED_POSITION_IGNORED'}
@{scale=$true;hierarchyGuard=$true;colorGuard=$true;sizeRestore=$true;automaticGeometry=$true;positionGuard=$true}|ConvertTo-Json -Compress
