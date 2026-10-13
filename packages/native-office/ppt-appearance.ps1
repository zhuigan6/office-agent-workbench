function Read-PptAppearanceColor($color){
    $state=[ordered]@{type=[int]$color.Type;rgb=[int]$color.RGB;scheme=[int]$color.SchemeColor;theme=[int]$color.ObjectThemeColor;tint=[double]$color.TintAndShade}
    if($state.type -notin @(1,2)){throw 'PPT_APPEARANCE_COLOR_UNSUPPORTED'}
    return $state
}
function Read-PptAppearance($shape){
    if($shape.Type -notin @(1,14,17)){throw 'PPT_APPEARANCE_SOLID_SHAPE_REQUIRED'}
    $fill=$shape.Fill;$line=$shape.Line
    if($fill.Visible -notin @(0,-1) -or $line.Visible -notin @(0,-1) -or ($fill.Visible -ne 0 -and $fill.Type -ne 1) -or ($line.Visible -ne 0 -and $line.Style -ne 1)){throw 'PPT_APPEARANCE_STYLE_UNSUPPORTED'}
    $surface=[ordered]@{visible=[int]$fill.Visible};$stroke=[ordered]@{visible=[int]$line.Visible}
    # Invisible formatting has mixed/undefined getters; record rendered absence,
    # rather than inventing dormant colors or claiming inheritance XML restoration.
    if($fill.Visible -ne 0){$surface.type=[int]$fill.Type;$surface.color=Read-PptAppearanceColor $fill.ForeColor;$surface.transparency=[double]$fill.Transparency}
    if($line.Visible -ne 0){
        $stroke.color=Read-PptAppearanceColor $line.ForeColor;$stroke.transparency=[double]$line.Transparency;$stroke.weight=[double]$line.Weight
        foreach($key in @('Style','DashStyle','BeginArrowheadStyle','BeginArrowheadLength','BeginArrowheadWidth','EndArrowheadStyle','EndArrowheadLength','EndArrowheadWidth','InsetPen','Pattern')){$stroke[$key]=[int]$line.$key}
    }
    return [ordered]@{fill=$surface;outline=$stroke}
}
function Set-PptAppearanceColor($color,$saved){
    $current=Read-PptAppearanceColor $color
    if((ConvertTo-Json $current -Compress) -ceq (ConvertTo-Json $saved -Compress)){return}
    if($saved.type -eq 1){$color.RGB=[int]$saved.rgb}elseif($saved.theme -gt 0){$color.ObjectThemeColor=[int]$saved.theme}else{$color.SchemeColor=[int]$saved.scheme}
    $color.TintAndShade=[double]$saved.tint
}
function Get-PptAppearanceColorPlan([string]$hex){
    if($hex -notmatch '^#[0-9a-fA-F]{6}$'){throw 'PPT_APPEARANCE_COLOR_VALUE'}
    return [ordered]@{type=1;rgb=([Convert]::ToInt32($hex.Substring(1,2),16)+[Convert]::ToInt32($hex.Substring(3,2),16)*256+[Convert]::ToInt32($hex.Substring(5,2),16)*65536);scheme=0;theme=0;tint=0.0}
}
function Test-PptAppearanceMatch($wanted,$actual){
    foreach($part in @('fill','outline')){
        foreach($key in $wanted[$part].Keys){
            $a=$actual[$part][$key];$w=$wanted.$part.$key
            if($key -in @('color','backColor')){
                if($a.type -ne $w.type -or $a.rgb -ne $w.rgb -or [Math]::Abs($a.tint-$w.tint) -gt 0.00001){return $false}
                if($a.type -eq 2 -and (($w.theme -gt 0 -and $a.theme -ne $w.theme) -or ($w.theme -le 0 -and $a.scheme -ne $w.scheme))){return $false}
            }elseif($key -in @('weight','transparency')){if([Math]::Abs([double]$a-[double]$w) -gt 0.001){return $false}}
            elseif($a -ne $w){return $false}
        }
    }
    return $true
}
function Write-PptAppearanceLayout($entry,$data){
    if($entry.doc.ReadOnly){return @{notIssued=$true;verified=$false;code='READ_ONLY'}}
    if($data.selection.appearanceProfileVersion -ne 1 -or $null -ne $data.selection.textStart){return @{notIssued=$true;verified=$false;code='PPT_COMPLETE_APPEARANCE_CAPTURE_REQUIRED'}}
    $before=Read-PptLayout $entry $data.selection
    if($before.contentHash -cne [string]$data.expectedFingerprint){return @{notIssued=$true;verified=$false;code='REVISION_CONFLICT'}}
    $wanted=@{fill=@{};outline=@{}}
    foreach($part in @('fill','outline')){foreach($key in $before.state.appearance[$part].Keys){$wanted[$part][$key]=$before.state.appearance[$part][$key]}}
    if($data.restoreAppearance){
        foreach($part in @('fill','outline')){$wanted[$part]=@{};foreach($p in $data.restoreAppearance.$part.PSObject.Properties){$wanted[$part][$p.Name]=$p.Value}}
    }else{
        foreach($part in @('fill','outline')){
            $edit=$data.appearance.$part;if(-not $edit){continue}
            if($edit.mode -notin @('none','solid')){throw 'PPT_APPEARANCE_MODE'}
            if($edit.mode -eq 'none'){$wanted[$part]=@{visible=0};continue}
            $wanted.$part.visible=-1
            if($edit.mode -eq 'solid'){
                $wanted.$part.color=Get-PptAppearanceColorPlan ([string]$edit.color)
                if($null -eq $wanted.$part.transparency){$wanted.$part.transparency=0.0}
                if($part -eq 'fill'){$wanted.fill.type=1}
                elseif($null -eq $wanted.outline.weight){$wanted.outline.weight=1.0}
                if($null -ne $edit.transparency){if($edit.transparency -lt 0 -or $edit.transparency -gt 1){throw 'PPT_APPEARANCE_TRANSPARENCY'};$wanted.$part.transparency=[double]$edit.transparency}
                if($part -eq 'outline' -and $null -ne $edit.width){if($edit.width -lt 0.25 -or $edit.width -gt 100){throw 'PPT_APPEARANCE_WIDTH'};$wanted.outline.weight=[double]$edit.width}
            }
        }
    }
    # Preserve the existing geometry/fit verification before changing appearance.
    $result=Write-PptLayoutCore $entry $data
    if(-not $result.verified){return $result}
    $coreAfter=$result.after.state
    $shape=Resolve-PptShape $entry $data.selection
    foreach($part in @('fill','outline')){
        $object=if($part -eq 'fill'){$shape.Fill}else{$shape.Line}
        $target=$wanted.$part
        if($target.visible -ne 0){
            if($part -eq 'fill' -and $object.Type -ne 1){$object.Solid()}
            if($object.Visible -ne -1){$object.Visible=-1}
            Set-PptAppearanceColor $object.ForeColor $target.color
            if([Math]::Abs([double]$object.Transparency-[double]$target.transparency) -gt 0.00001){$object.Transparency=[double]$target.transparency}
            if($part -eq 'outline' -and [Math]::Abs([double]$object.Weight-[double]$target.weight) -gt 0.00001){$object.Weight=[double]$target.weight}
        }
        if($object.Visible -ne $target.visible){$object.Visible=[int]$target.visible}
    }
    $after=Read-PptLayout $entry $data.selection
    $verified=(Test-PptAppearanceMatch $wanted $after.state.appearance) -and $before.state.appearanceContentHash -ceq $after.state.appearanceContentHash
    foreach($key in @('left','top','width','height','rotation')){if([Math]::Abs([double]$coreAfter.geometry[$key]-[double]$after.state.geometry[$key]) -gt 0.02){$verified=$false}}
    if($coreAfter.type -ne $after.state.type -or $coreAfter.lockAspectRatio -ne $after.state.lockAspectRatio){$verified=$false}
    if($coreAfter.textFrame -and -not (Test-PptTextFrameMatch $coreAfter.textFrame $after.state.textFrame)){$verified=$false}
    $rich=$null
    if($result.afterRich -or $result.continuationSelection.replacementRevision){
        $rich=Read-PptReplacement $entry $data.selection
        if($result.afterRich -and $rich.contentHash -cne $result.afterRich.contentHash){$verified=$false}
        elseif($result.afterText -and $rich.formatHash -cne $result.afterText.contentHash){$verified=$false}
    }elseif($result.afterText){$text=Read-PptFormat $entry $data.selection;if($text.contentHash -cne $result.afterText.contentHash){$verified=$false}}
    $result.before=$before;$result.after=$after;$result.revision=$after.contentHash
    $result.verified=$verified;$result.code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})
    $result.appearanceRecovery='Native resolved colors/theme links, visibility and stroke properties; not byte-identical inheritance XML.'
    $next=$result.continuationSelection;$next.layoutRevision=$after.contentHash
    # Reuse this final post-mutation readback for continuation; do not traverse
    # every character again without an intervening operation.
    if($next.replacementRevision){$next.replacementRevision=$rich.contentHash;$next.contentHash=$rich.formatHash;if($result.afterRich){$result.afterRich=$rich}}
    elseif($result.afterText){$next.contentHash=$result.afterText.contentHash}else{$next.contentHash=$after.contentHash}
    if($result.afterNominalContentHash){$result.afterNominalContentHash=Read-PptFrameContentHash $entry $next}
    return $result
}
