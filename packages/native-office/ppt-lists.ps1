function Read-PptBulletDetails($bullet){
    $result=[ordered]@{style=[int]$bullet.Style;useTextFont=[int]$bullet.UseTextFont;useTextColor=[int]$bullet.UseTextColor}
    if($result.useTextFont -eq 0){$result.font=[string]$bullet.Font.Name}
    if($result.useTextColor -eq 0){$color=$bullet.Font.Color;$result.color=[ordered]@{type=[int]$color.Type;rgb=[int]$color.RGB;theme=[int]$color.ObjectThemeColor;scheme=[int]$color.SchemeColor;tint=[double]$color.TintAndShade}}
    return $result
}
function Get-PptBulletMutation($current,$properties,$old){
    if([int]$current.type -notin @(0,1,2) -or [int]$current.visible -notin @(0,-1)){throw 'PPT_PARAGRAPH_BULLET_SOURCE_UNSUPPORTED'}
    if($null -eq $current.details -or $current.details.useTextFont -notin @(0,-1) -or $current.details.useTextColor -notin @(0,-1)){throw 'PPT_PARAGRAPH_BULLET_PROFILE_REQUIRED'}
    $wanted=[ordered]@{};foreach($key in $current.Keys){$wanted[$key]=$current[$key]}
    if($old){foreach($key in $current.Keys){$wanted[$key]=$old.$key};return $wanted}
    switch([string]$properties.type){
        'none' {$wanted.type=0;$wanted.visible=0;$wanted.start=1}
        'character' {
            if($properties.character -isnot [ValueType] -or $properties.character -is [bool] -or [int]$properties.character -ne [double]$properties.character -or [int]$properties.character -lt 32 -or [int]$properties.character -gt 65535 -or [int]$properties.character -in 55296..57343){throw 'PPT_PARAGRAPH_BULLET_CHARACTER'}
            $wanted.type=1;$wanted.visible=-1;$wanted.character=[int]$properties.character
        }
        'numbered' {
            if($properties.style -isnot [ValueType] -or [int]$properties.style -ne [double]$properties.style -or [int]$properties.style -lt 0 -or [int]$properties.style -gt 40 -or $properties.start -isnot [ValueType] -or [int]$properties.start -ne [double]$properties.start -or [int]$properties.start -lt 1 -or [int]$properties.start -gt 32767){throw 'PPT_PARAGRAPH_BULLET_NUMBER'}
            $wanted.type=2;$wanted.visible=-1;$wanted.start=[int]$properties.start
            $details=[ordered]@{};foreach($key in $current.details.Keys){$details[$key]=$current.details[$key]};$details.style=[int]$properties.style;$wanted.details=$details
        }
        default {throw 'PPT_PARAGRAPH_BULLET_TYPE'}
    }
    if($null -ne $properties.relativeSize){if($properties.relativeSize -isnot [ValueType] -or $properties.relativeSize -is [bool] -or [double]$properties.relativeSize -lt 0.25 -or [double]$properties.relativeSize -gt 4){throw 'PPT_PARAGRAPH_BULLET_SIZE'};$wanted.relativeSize=[double]$properties.relativeSize}
    return $wanted
}
function Set-PptBulletProfile($bullet,$profile){
    # Some bullet setters activate numbering; reapply the requested type last.
    if([int]$bullet.Style -ne [int]$profile.details.style){$bullet.Style=[int]$profile.details.style}
    if([int]$bullet.Character -ne [int]$profile.character){$bullet.Character=[int]$profile.character}
    if([int]$bullet.StartValue -ne [int]$profile.start){$bullet.StartValue=[int]$profile.start}
    if([Math]::Abs([double]$bullet.RelativeSize-[double]$profile.relativeSize) -gt 0.001){$bullet.RelativeSize=[double]$profile.relativeSize}
    $details=$profile.details
    if($details.useTextFont -eq -1){if($bullet.UseTextFont -ne -1){$bullet.UseTextFont=-1}}
    elseif([string]$bullet.Font.Name -cne [string]$details.font){$bullet.Font.Name=[string]$details.font}
    if($details.useTextColor -eq -1){if($bullet.UseTextColor -ne -1){$bullet.UseTextColor=-1}}
    else{
        $color=$bullet.Font.Color;$saved=$details.color
        if($color.Type -ne $saved.type -or $color.RGB -ne $saved.rgb -or $color.ObjectThemeColor -ne $saved.theme -or $color.TintAndShade -ne $saved.tint){
            if($saved.type -eq 1){$color.RGB=[int]$saved.rgb}elseif($saved.theme -gt 0){$color.ObjectThemeColor=[int]$saved.theme}else{$color.SchemeColor=[int]$saved.scheme};$color.TintAndShade=[double]$saved.tint
        }
    }
    if($bullet.Type -ne $profile.type){$bullet.Type=[int]$profile.type}
    if($bullet.Visible -ne $profile.visible){$bullet.Visible=[int]$profile.visible}
}
function Test-PptBulletProfile($expected,$actual){
    if($expected.Keys.Count -ne $actual.Keys.Count){return $false}
    foreach($key in $expected.Keys){
        if($key -eq 'relativeSize'){if([Math]::Abs([double]$expected[$key]-[double]$actual[$key]) -gt 0.0001){return $false}}
        elseif((ConvertTo-Json -InputObject $expected[$key] -Depth 10 -Compress) -cne (ConvertTo-Json -InputObject $actual[$key] -Depth 10 -Compress)){return $false}
    }
    return $true
}
