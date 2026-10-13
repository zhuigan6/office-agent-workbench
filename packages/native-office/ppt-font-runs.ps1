function Get-PptRunSlices($legacy,$modern=$null){
    if($env:WORKBENCH_PPT_SLOW_PROFILE_READS -eq '1'){return $null}
    try{
        $total=[int]$legacy.Length;if($total -lt 1 -or $total -gt 2000){return $null}
        $boundaries=[Collections.Generic.SortedSet[int]]::new();$null=$boundaries.Add(1);$null=$boundaries.Add($total+1)
        foreach($range in @($legacy,$modern)){
            if($null -eq $range){continue}
            if([int]$range.Length -ne $total -or [string]$range.Text -cne [string]$legacy.Text){return $null}
            $runs=$range.Runs();if($runs.Count -lt 1 -or $runs.Count -gt $total){return $null};$next=1
            for($i=1;$i -le $runs.Count;$i++){
                $run=$range.Runs($i,1);$start=[int]$run.Start-[int]$range.Start+1;$length=[int]$run.Length
                if($start -ne $next -or $length -lt 1 -or $start+$length -gt $total+1){return $null}
                $null=$boundaries.Add($start);$next=$start+$length;$null=$boundaries.Add($next)
            }
            if($next -ne $total+1){return $null}
        }
        $points=@($boundaries);$slices=[Collections.Generic.List[object]]::new()
        for($i=0;$i -lt $points.Count-1;$i++){$slices.Add(@{start=$points[$i];length=$points[$i+1]-$points[$i]})}
        return $slices.ToArray()
    }catch{return $null}
}
function Read-PptBasicFontArray($range){
    $slices=Get-PptRunSlices $range;$fonts=[Collections.Generic.List[object]]::new();$usable=$null -ne $slices
    if($usable){
        foreach($slice in $slices){
            $font=$range.Characters($slice.start,$slice.length).Font
            $values=[ordered]@{bold=[int]$font.Bold;italic=[int]$font.Italic;size=[double]$font.Size;name=[string]$font.Name}
            if($values.bold -notin @(0,-1) -or $values.italic -notin @(0,-1) -or $values.size -lt 1 -or $values.name.Length -eq 0){$usable=$false;break}
            for($i=0;$i -lt $slice.length;$i++){$fonts.Add($values)}
        }
    }
    if(-not $usable){
        $fonts.Clear()
        for($i=1;$i -le $range.Length;$i++){$font=$range.Characters($i,1).Font;$fonts.Add([ordered]@{bold=[int]$font.Bold;italic=[int]$font.Italic;size=[double]$font.Size;name=[string]$font.Name})}
    }
    return $fonts.ToArray()
}
function Read-PptRichFontArray($legacy,$modern){
    $slices=Get-PptRunSlices $legacy $modern;$profiles=[Collections.Generic.List[object]]::new();$usable=$null -ne $slices
    if($usable){
        foreach($slice in $slices){
            try{
                $profile=Get-PptCharacterProfile $legacy.Characters($slice.start,$slice.length) $modern.Characters($slice.start,$slice.length)
                foreach($key in @('Bold','Italic','Underline','AutoRotateNumbers','Subscript','Superscript')){if($profile[$key] -notin @(0,-1)){throw 'MIXED_FONT_PROFILE'}}
                if($profile.Size -lt 1 -or [string]::IsNullOrEmpty($profile.Name) -or $profile.Color.rgb -lt 0 -or $profile.Color.rgb -gt 16777215 -or $profile.Color.theme -lt 0){throw 'MIXED_FONT_PROFILE'}
                for($i=0;$i -lt $slice.length;$i++){$profiles.Add($profile)}
            }catch{$usable=$false;break}
        }
    }
    if(-not $usable){
        $profiles.Clear()
        for($i=1;$i -le $legacy.Length;$i++){$profiles.Add((Get-PptCharacterProfile $legacy.Characters($i,1) $modern.Characters($i,1)))}
    }
    return $profiles.ToArray()
}
