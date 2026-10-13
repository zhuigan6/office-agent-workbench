$script:pptParagraphAlignment=[ordered]@{left=1;center=2;right=3;justify=4}
function Get-PptParagraphCoverage($ranges,[int]$start,[int]$length){
    if($start -lt 1 -or $length -lt 1){throw 'PPT_PARAGRAPH_RANGE'}
    $end=$start+$length;$indices=[Collections.Generic.List[int]]::new();$unique=@{}
    foreach($r in $ranges){
        $a=[int]$r.start;$b=$a+[int]$r.length
        if($r.length -le 0 -or [Math]::Max($a,$start) -ge [Math]::Min($b,$end)){continue}
        $contentEnd=$b;if(([string]$r.text).EndsWith("`r")){$contentEnd--}
        if($start -gt $a -or $end -lt $contentEnd){throw 'PPT_COMPLETE_PARAGRAPH_REQUIRED: A partial text selection cannot expand to paragraph formatting.'}
        $indices.Add([int]$r.index);$unique[$a.ToString()+':'+$b.ToString()]=$true
    }
    if($unique.Count -lt 1 -or $unique.Count -gt 20){throw 'PPT_PARAGRAPH_LIMIT'}
    return $indices.ToArray()
}
function Get-PptParagraphPlan($shape,$state,$properties,$restore,[bool]$fitAware=$false){
    $fields=@($properties.PSObject.Properties.Name)
    if($fields.Count -lt 1 -or @($fields|Where-Object {$_ -notin @('alignment','spaceBefore','spaceAfter','lineSpacing','leftIndent','rightIndent','firstLineIndent','bullet')}).Count){throw 'PPT_PARAGRAPH_FIELD'}
    if($null -ne $properties.alignment -and -not $script:pptParagraphAlignment.Contains([string]$properties.alignment)){throw 'PPT_PARAGRAPH_ALIGNMENT'}
    foreach($key in @('spaceBefore','spaceAfter')){if($null -ne $properties.$key -and ($properties.$key -isnot [ValueType] -or $properties.$key -is [bool] -or [double]$properties.$key -lt 0 -or [double]$properties.$key -gt 1584)){throw 'PPT_PARAGRAPH_SPACING'}}
    foreach($key in @('leftIndent','rightIndent','firstLineIndent')){if($null -ne $properties.$key -and ($properties.$key -isnot [ValueType] -or $properties.$key -is [bool] -or [double]$properties.$key -lt $(if($key -eq 'firstLineIndent'){-1584}else{0}) -or [double]$properties.$key -gt 1584)){throw 'PPT_PARAGRAPH_INDENT'}}
    if($properties.lineSpacing){$spacing=$properties.lineSpacing;if([string]$spacing.unit -notin @('points','lines') -or $spacing.value -isnot [ValueType] -or $spacing.value -is [bool] -or [double]$spacing.value -le 0 -or [double]$spacing.value -gt $(if($spacing.unit -eq 'lines'){10}else{1584})){throw 'PPT_PARAGRAPH_SPACING'}}
    if(($shape.TextFrame.AutoSize -ne 0 -or $shape.TextFrame2.AutoSize -ne 0) -and (-not $fitAware -or [int]$shape.TextFrame2.AutoSize -notin @(1,2))){throw 'PPT_PARAGRAPH_AUTOFIT_UNSUPPORTED: Automatic shape/font resizing needs a versioned fitting-aware workflow.'}
    $ranges=@(for($i=1;$i -le $state.paragraphs.Count;$i++){$r=$shape.TextFrame.TextRange.Paragraphs($i,1);@{index=$i;start=[int]$r.Start;length=[int]$r.Length;text=[string]$r.Text}})
    $indices=@(Get-PptParagraphCoverage $ranges ([int]$state.start) ([int]$state.length))
    if($restore -and $restore.Count -ne $state.paragraphs.Count){throw 'PPT_PARAGRAPH_RESTORE_SHAPE'}
    $expected=[Collections.Generic.List[object]]::new();$mutations=[Collections.Generic.List[object]]::new();$seen=@{}
    for($i=0;$i -lt $state.paragraphs.Count;$i++){
        $wanted=[ordered]@{};foreach($p in $state.paragraphs[$i].Keys){$wanted[$p]=$state.paragraphs[$i][$p]}
        if(($i+1) -in $indices){
            $old=if($restore){$restore[$i]}else{$null};$values=[ordered]@{}
            if($null -ne $properties.alignment){$values.Alignment=$(if($old){$old.Alignment}else{$script:pptParagraphAlignment[[string]$properties.alignment]})}
            foreach($key in @('Before','After')){if($null -ne $properties.('space'+$key)){$values['LineRule'+$key]=$(if($old){$old.('LineRule'+$key)}else{0});$values['Space'+$key]=$(if($old){$old.('Space'+$key)}else{[double]$properties.('space'+$key)})}}
            if($properties.lineSpacing){$values.LineRuleWithin=$(if($old){$old.LineRuleWithin}elseif($properties.lineSpacing.unit -eq 'lines'){-1}else{0});$values.SpaceWithin=$(if($old){$old.SpaceWithin}else{[double]$properties.lineSpacing.value})}
            foreach($key in @('LeftIndent','RightIndent','FirstLineIndent')){$field=$key.Substring(0,1).ToLowerInvariant()+$key.Substring(1);if($null -ne $properties.$field){$values[$key]=$(if($old){$old.$key}else{[double]$properties.$field})}}
            if($properties.bullet){
                $values.bullet=Get-PptBulletMutation $state.paragraphs[$i].bullet $properties.bullet $(if($old){$old.bullet}else{$null})
                # Activating numbering can reset indents; preserve every unrequested indent.
                foreach($key in @('LeftIndent','RightIndent','FirstLineIndent')){if(-not $values.Contains($key)){$values[$key]=$state.paragraphs[$i][$key]}}
            }
            foreach($key in $values.Keys){$wanted[$key]=$values[$key]}
            $signature=[string]$ranges[$i].start+':'+[string]$ranges[$i].length
            if(-not $seen.ContainsKey($signature)){$mutations.Add(@{index=$i+1;values=$values});$seen[$signature]=$true}
        }
        $expected.Add($wanted)
    }
    return @{expected=$expected.ToArray();mutations=$mutations.ToArray();indices=$indices}
}
function Set-PptParagraphPlan($shape,$plan){
    foreach($edit in $plan.mutations){$p=$shape.TextFrame.TextRange.Paragraphs([int]$edit.index,1).ParagraphFormat
    if($edit.values.Contains('bullet')){Set-PptBulletProfile $p.Bullet $edit.values.bullet}
    foreach($key in $edit.values.Keys){
        if($key -eq 'bullet'){continue}
        if($key -in @('LeftIndent','RightIndent','FirstLineIndent')){$modern=$shape.TextFrame2.TextRange.Paragraphs([int]$edit.index,1).ParagraphFormat;$value=[double]$edit.values[$key];if([Math]::Abs([double]$modern.$key-$value) -gt 0.001){$modern.$key=$value};continue}
        # JSON restores an integral point value as an integer; Office's cached
        # COM setter requires a floating-point variant for spacing properties.
        $value=if($key -in @('SpaceBefore','SpaceAfter','SpaceWithin')){[double]$edit.values[$key]}else{[int]$edit.values[$key]}
        if($p.$key -cne $value){$p.$key=$value}
    }}
}
function Test-PptParagraphPlan($expected,$actual){
    if($expected.Count -ne $actual.Count){return $false}
    for($i=0;$i -lt $expected.Count;$i++){foreach($key in $expected[$i].Keys){
        if($key -eq 'bullet'){if(-not (Test-PptBulletProfile $expected[$i][$key] $actual[$i].$key)){return $false};continue}
        if($key -in @('SpaceBefore','SpaceAfter','SpaceWithin','LeftIndent','RightIndent','FirstLineIndent')){if([Math]::Abs([double]$actual[$i].$key-[double]$expected[$i][$key]) -gt 0.001){return $false}}
        elseif((ConvertTo-Json -InputObject $actual[$i].$key -Depth 10 -Compress) -cne (ConvertTo-Json -InputObject $expected[$i][$key] -Depth 10 -Compress)){return $false}
    }};return $true
}
function Read-PptParagraphLayoutCheck($shape){
    try{
        if([Math]::Abs([double]$shape.Rotation) -gt 0.001){return @{available=$false;reason='Rotated text needs visual layout inspection.'}}
        $frame=$shape.TextFrame2;$height=[Math]::Max(0,[double]$shape.Height-[double]$frame.MarginTop-[double]$frame.MarginBottom);$width=[Math]::Max(0,[double]$shape.Width-[double]$frame.MarginLeft-[double]$frame.MarginRight)
        $boundHeight=[double]$frame.TextRange.BoundHeight;$boundWidth=[double]$frame.TextRange.BoundWidth
        return @{available=$true;method='native-text-bounds';height=$boundHeight;width=$boundWidth;availableHeight=$height;availableWidth=$width;mayOverflow=($boundHeight -gt $height+0.5 -or $boundWidth -gt $width+0.5);instruction='Native bounds are a layout signal, not a screenshot/render guarantee. Preserve geometry unless an explicit layout change is requested.'}
    }catch{return @{available=$false;reason='Native text bounds could not be read; inspect the actual slide.'}}
}
