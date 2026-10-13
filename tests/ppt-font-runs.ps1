$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/ppt-font-runs.ps1')
function Assert-True($value,[string]$message){if(-not $value){throw $message}}
function New-TestRange([int]$start,[int]$length,[int[]]$lengths){
    $range=[pscustomobject]@{Start=$start;Length=$length;Text=('x'*$length);Segments=@();CharactersCalled=0}
    $position=$start;$range.Segments=@(foreach($size in $lengths){$r=[pscustomobject]@{Start=$position;Length=$size};$position+=$size;$r})
    $range | Add-Member ScriptMethod Runs {param($index,$count) if($null -eq $index){return [pscustomobject]@{Count=$this.Segments.Count}};return $this.Segments[$index-1]}
    $range | Add-Member ScriptMethod Characters {param($index,$count) $this.CharactersCalled++;$size=if($script:mixed -and $count -gt 1){0}else{18};return [pscustomobject]@{Font=[pscustomobject]@{Bold=0;Italic=-1;Size=$size;Name='Test'};Index=$index;Length=$count}}
    return $range
}
$prior=$env:WORKBENCH_PPT_SLOW_PROFILE_READS
try{
    $env:WORKBENCH_PPT_SLOW_PROFILE_READS='0';$script:mixed=$false
    $legacy=New-TestRange 7 6 @(2,4);$modern=New-TestRange 7 6 @(3,3)
    $slices=@(Get-PptRunSlices $legacy $modern)
    Assert-True (($slices|ConvertTo-Json -Compress) -ceq '[{"start":1,"length":2},{"start":3,"length":1},{"start":4,"length":3}]') 'UNION_BOUNDARIES'
    $fast=@(Read-PptBasicFontArray $legacy);Assert-True ($fast.Count -eq 6 -and $legacy.CharactersCalled -eq 2) 'BASIC_EXPANSION'
    $env:WORKBENCH_PPT_SLOW_PROFILE_READS='1';$slow=@(Read-PptBasicFontArray $legacy)
    Assert-True (($fast|ConvertTo-Json -Compress) -ceq ($slow|ConvertTo-Json -Compress)) 'BASIC_EQUALITY'
    Assert-True ($null -eq (Get-PptRunSlices $legacy $modern)) 'DISABLED_FALLBACK'
    $env:WORKBENCH_PPT_SLOW_PROFILE_READS='0';$script:mixed=$true;$legacy.CharactersCalled=0
    $mixed=@(Read-PptBasicFontArray $legacy);Assert-True ($mixed.Count -eq 6 -and $legacy.CharactersCalled -eq 7) 'MIXED_FALLBACK'
    $script:mixed=$false
    function Get-PptCharacterProfile($a,$b){if($script:richMixed -and $a.Length -gt 1){$bold=-2}else{$bold=0};return [ordered]@{Bold=$bold;Italic=0;Underline=0;AutoRotateNumbers=0;Subscript=0;Superscript=0;Size=18;Name='Test';Color=@{rgb=123;theme=0}}}
    $script:richMixed=$false;$fastRich=@(Read-PptRichFontArray $legacy $modern)
    $env:WORKBENCH_PPT_SLOW_PROFILE_READS='1';$slowRich=@(Read-PptRichFontArray $legacy $modern)
    Assert-True ($fastRich.Count -eq 6 -and ($fastRich|ConvertTo-Json -Depth 5 -Compress) -ceq ($slowRich|ConvertTo-Json -Depth 5 -Compress)) 'RICH_EQUALITY'
    $env:WORKBENCH_PPT_SLOW_PROFILE_READS='0';$script:richMixed=$true;$legacy.CharactersCalled=0
    $mixedRich=@(Read-PptRichFontArray $legacy $modern);Assert-True ($mixedRich.Count -eq 6 -and $legacy.CharactersCalled -eq 7) 'RICH_MIXED_FALLBACK'
    $modern.Text='wrong';Assert-True ($null -eq (Get-PptRunSlices $legacy $modern)) 'TEXT_MISMATCH'
    $modern.Text=$legacy.Text;$modern.Segments[1].Start++;Assert-True ($null -eq (Get-PptRunSlices $legacy $modern)) 'GAP_REFUSED'
    $modern.Segments[1].Start-=2;Assert-True ($null -eq (Get-PptRunSlices $legacy $modern)) 'OVERLAP_REFUSED'
    $empty=New-TestRange 1 0 @();Assert-True ($null -eq (Get-PptRunSlices $empty)) 'EMPTY_FALLBACK'
    'PPT_FONT_RUNS=PASS'
}finally{$env:WORKBENCH_PPT_SLOW_PROFILE_READS=$prior}
