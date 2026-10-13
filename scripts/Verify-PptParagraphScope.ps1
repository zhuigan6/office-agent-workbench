$ErrorActionPreference='Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'packages/native-office/ppt-paragraph.ps1')
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'packages/native-office/ppt-lists.ps1')
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'packages/native-office/ppt-replace.ps1')
$ranges=@(@{index=1;start=1;length=6;text="first`r"},@{index=2;start=7;length=7;text="second`r"},@{index=3;start=14;length=5;text='third'})
foreach($case in @(@{start=7;length=6;expected=@(2)},@{start=1;length=13;expected=@(1,2)},@{start=1;length=18;expected=@(1,2,3)})){
    $actual=@(Get-PptParagraphCoverage $ranges $case.start $case.length)
    if(($actual -join ',') -cne ($case.expected -join ',')){throw 'Paragraph boundary mismatch.'}
}
foreach($case in @(@{start=8;length=5},@{start=7;length=3},@{start=5;length=9},@{start=1;length=0})){
    $refused=$false;try{$null=Get-PptParagraphCoverage $ranges $case.start $case.length}catch{if($_.Exception.Message -notmatch 'PPT_.*PARAGRAPH|PPT_PARAGRAPH'){throw};$refused=$true};if(-not $refused){throw 'Partial paragraph was expanded.'}
}
$alias=@($ranges)+@(@{index=4;start=14;length=5;text='third'})
if((@(Get-PptParagraphCoverage $alias 14 5) -join ',') -cne '3,4'){throw 'Clamped native paragraph alias lost.'}
$fitRange=[pscustomobject]@{}
$fitRange|Add-Member -MemberType ScriptMethod -Name Paragraphs -Value {param($start,$length) return [pscustomobject]@{Start=1;Length=5;Text='first'}}
$fitShape=[pscustomobject]@{TextFrame=[pscustomobject]@{AutoSize=-2;TextRange=$fitRange};TextFrame2=[pscustomobject]@{AutoSize=2}}
$fitState=@{start=1;length=5;paragraphs=@([ordered]@{Alignment=1})};$properties='{"alignment":"center"}'|ConvertFrom-Json
$refused=$false;try{$null=Get-PptParagraphPlan $fitShape $fitState $properties $null}catch{if($_.Exception.Message -notmatch '^PPT_PARAGRAPH_AUTOFIT_UNSUPPORTED'){throw};$refused=$true}
if(-not $refused){throw 'LEGACY_FITTED_PARAGRAPH_SCOPE_EXPANDED'}
$fitPlan=Get-PptParagraphPlan $fitShape $fitState $properties $null $true
if($fitPlan.expected[0].Alignment -ne 2){throw 'VERSIONED_FIT_PLAN_FAILED'}
$fitShape.TextFrame2.AutoSize=4;$refused=$false
try{$null=Get-PptParagraphPlan $fitShape $fitState $properties $null $true}catch{if($_.Exception.Message -notmatch '^PPT_PARAGRAPH_AUTOFIT_UNSUPPORTED'){throw};$refused=$true}
if(-not $refused){throw 'UNKNOWN_FIT_MODE_ACCEPTED'}
Add-Type -TypeDefinition @'
using System;
public class WorkbenchParagraphVariantProbe {
    double before, after, within;
    public int Alignment { get; set; }
    public int LineRuleBefore { get; set; }
    public int LineRuleAfter { get; set; }
    public int LineRuleWithin { get; set; }
    public object SpaceBefore { get { return before; } set { if (!(value is double)) throw new InvalidCastException(); before=(double)value; } }
    public object SpaceAfter { get { return after; } set { if (!(value is double)) throw new InvalidCastException(); after=(double)value; } }
    public object SpaceWithin { get { return within; } set { if (!(value is double)) throw new InvalidCastException(); within=(double)value; } }
}
public class WorkbenchFontVariantProbe {
    double size=24;
    public object Size { get { return size; } set { if (!(value is double)) throw new InvalidCastException(); size=(double)value; } }
    public string NameOther { get; set; }
    public object Color { get; set; }
    public WorkbenchFontVariantProbe() { NameOther=""; }
}
'@
$format=[WorkbenchParagraphVariantProbe]::new();$range=[pscustomobject]@{Format=$format}
$range|Add-Member -MemberType ScriptMethod -Name Paragraphs -Value {param($start,$length) return [pscustomobject]@{ParagraphFormat=$this.Format}}
$shape=[pscustomobject]@{TextFrame=[pscustomobject]@{TextRange=$range}}
$values=('{"Alignment":2,"LineRuleBefore":0,"SpaceBefore":12,"LineRuleAfter":0,"SpaceAfter":8,"LineRuleWithin":0,"SpaceWithin":24}'|ConvertFrom-Json)
$edit=[ordered]@{};foreach($p in $values.PSObject.Properties){$edit[$p.Name]=$p.Value}
$null=Set-PptParagraphPlan $shape @{mutations=@(@{index=1;values=$edit})}
if($format.SpaceBefore -ne 12 -or $format.SpaceAfter -ne 8 -or $format.SpaceWithin -ne 24 -or $format.Alignment -ne 2){throw 'Explicit spacing variant conversion failed.'}
$font=[WorkbenchFontVariantProbe]::new();$font.Color=[pscustomobject]@{Type=1;RGB=0;ObjectThemeColor=0;TintAndShade=0}
$profile=[pscustomobject]@{Size=18;NameOther=$null;Color=[pscustomobject]@{type=1;rgb=0;theme=0;tint=0}}
$null=Set-PptCharacterProfile ([pscustomobject]@{Font=$font}) $profile
if($font.Size -ne 18 -or $font.NameOther -cne ''){throw 'Explicit font restore variant conversion failed.'}
'PPT_PARAGRAPH_SCOPE=PASS'
