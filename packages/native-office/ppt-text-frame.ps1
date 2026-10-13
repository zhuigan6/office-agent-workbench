$script:pptFrameFit=@{none=0;shape=1;text=2}
$script:pptFrameAnchor=@{top=1;middle=3;bottom=4}
$script:pptFrameMargins=@{marginLeft='MarginLeft';marginRight='MarginRight';marginTop='MarginTop';marginBottom='MarginBottom'}
function Read-PptTextFrame($shape){
    if($shape.Type -notin @(1,14,17) -or $shape.HasTextFrame -eq 0){throw 'PPT_ORDINARY_TEXT_FRAME_REQUIRED'}
    $frame=$shape.TextFrame2
    $state=[ordered]@{AutoSize=[int]$frame.AutoSize;LegacyAutoSize=[int]$shape.TextFrame.AutoSize;VerticalAnchor=[int]$frame.VerticalAnchor;HorizontalAnchor=[int]$frame.HorizontalAnchor;WordWrap=[int]$frame.WordWrap;Orientation=[int]$frame.Orientation}
    if($state.AutoSize -notin @(0,1,2) -or $state.WordWrap -notin @(0,-1)){throw 'PPT_FRAME_MIXED_PROPERTIES'}
    foreach($key in @('MarginLeft','MarginRight','MarginTop','MarginBottom')){$v=[double]$frame.$key;if([double]::IsNaN($v) -or [double]::IsInfinity($v) -or $v -lt 0 -or $v -gt 1000){throw 'PPT_FRAME_MARGIN_UNSUPPORTED'};$state[$key]=$v}
    return $state
}
function Get-PptTextFramePlan($before,$data){
    $wanted=[ordered]@{};foreach($key in $before.Keys){$wanted[$key]=$(if($data.restoreTextFrame){$data.restoreTextFrame.$key}else{$before[$key]})}
    if(-not $data.restoreTextFrame){
        foreach($key in @($data.textFrame.PSObject.Properties.Name)){
            $v=$data.textFrame.$key
            if($key -eq 'autoFit'){if(-not $script:pptFrameFit.ContainsKey([string]$v)){throw 'PPT_FRAME_AUTOFIT_VALUE'};$wanted.AutoSize=$script:pptFrameFit[[string]$v];$wanted.LegacyAutoSize=$(switch($wanted.AutoSize){1{1};2{-2};default{0}})}
            elseif($key -eq 'verticalAnchor'){if(-not $script:pptFrameAnchor.ContainsKey([string]$v)){throw 'PPT_FRAME_ANCHOR_VALUE'};$wanted.VerticalAnchor=$script:pptFrameAnchor[[string]$v]}
            elseif($key -eq 'wordWrap'){if($v -isnot [bool]){throw 'PPT_FRAME_WRAP_VALUE'};$wanted.WordWrap=$(if($v){-1}else{0})}
            elseif($script:pptFrameMargins.ContainsKey([string]$key)){if($v -isnot [ValueType] -or $v -is [bool] -or [double]$v -lt 0 -or [double]$v -gt 1000){throw 'PPT_FRAME_MARGIN_VALUE'};$wanted[$script:pptFrameMargins[$key]]=[double]$v}
            else{throw 'PPT_FRAME_FIELD'}
        }
    }
    if($wanted.AutoSize -notin @(0,1,2) -or $wanted.WordWrap -notin @(0,-1)){throw 'PPT_FRAME_RESTORE_PROFILE'}
    if($wanted.AutoSize -eq 1 -and ($wanted.VerticalAnchor -notin @(1,3,4) -or $wanted.HorizontalAnchor -notin @(1,2))){throw 'PPT_FRAME_AUTOMATIC_ANCHOR_UNSUPPORTED'}
    return $wanted
}
function Test-PptTextFrameMatch($expected,$actual){
    foreach($key in $expected.Keys){
        if($key.StartsWith('Margin')){if([Math]::Abs([double]$expected[$key]-[double]$actual[$key]) -gt 0.02){return $false}}
        elseif($expected[$key] -ne $actual[$key]){return $false}
    };return $true
}
function Test-PptFrameText($before,$after,$data,$frame){
    if($before.text -cne $after.text -or $before.profiles.Count -ne $after.profiles.Count -or $before.paragraphs.Count -ne $after.paragraphs.Count){return $false}
    $scaleLower=0.0;$scaleUpper=1.0
    for($i=0;$i -lt $before.profiles.Count;$i++){
        $old=$before.profiles[$i];$actual=$after.profiles[$i]
        foreach($key in $old.Keys){
            if($key -eq 'Size'){
                $expected=if($data.restoreTextProfiles){[double]$data.restoreTextProfiles[$i].Size}elseif($data.nominalProfiles){[double]$data.nominalProfiles[$i].Size}else{[double]$old.Size}
                if($frame.AutoSize -eq 2 -and -not $data.restoreTextFrame){
                    if($actual.Size -lt 1 -or [double]$actual.Size -gt $expected+0.001){return $false}
                    # Effective size getters round each nominal size independently.
                    $lower=if([double]$actual.Size -le 1){0.0}else{([double]$actual.Size-0.5)/$expected}
                    $upper=([double]$actual.Size+0.5)/$expected
                    $scaleLower=[Math]::Max($scaleLower,$lower);$scaleUpper=[Math]::Min($scaleUpper,$upper)
                    if($scaleLower -gt $scaleUpper+0.000001){return $false}
                }elseif([Math]::Abs([double]$actual.Size-$expected) -gt 0.001){return $false}
                continue
            }
            if((ConvertTo-Json -InputObject $old[$key] -Depth 10 -Compress) -cne (ConvertTo-Json -InputObject $actual.$key -Depth 10 -Compress)){return $false}
        }
    }
    for($i=0;$i -lt $before.paragraphs.Count;$i++){foreach($key in $before.paragraphs[$i].Keys){
        if($key -eq 'WordWrap' -and ($null -ne $data.textFrame.wordWrap -or $data.restoreTextFrame)){
            if($after.paragraphs[$i].$key -notin @($before.paragraphs[$i][$key],$frame.WordWrap)){return $false};continue
        }
        if((ConvertTo-Json -InputObject $before.paragraphs[$i][$key] -Depth 10 -Compress) -cne (ConvertTo-Json -InputObject $after.paragraphs[$i].$key -Depth 10 -Compress)){return $false}
    }};return $true
}
function Test-PptFrameGeometry($initial,$actual,$frame,[bool]$restoring,$layout){
    $automatic=$frame.AutoSize -eq 1 -and -not $restoring
    foreach($key in @('width','height','left','top','rotation')){
        if([double]::IsNaN([double]$actual[$key]) -or [double]::IsInfinity([double]$actual[$key])){return $false}
        if($automatic -and ($key -eq 'height' -or ($key -eq 'width' -and $frame.WordWrap -eq 0))){if($actual[$key] -lt 1 -or $actual[$key] -gt 10000){return $false};continue}
        $expected=[double]$initial[$key]
        if($automatic -and $key -eq 'left' -and $frame.HorizontalAnchor -eq 2){$expected+=([double]$initial.width-[double]$actual.width)/2}
        if($automatic -and $key -eq 'top'){$factor=@{1=0;3=0.5;4=1}[[int]$frame.VerticalAnchor];$expected+=([double]$initial.height-[double]$actual.height)*[double]$factor}
        $difference=[Math]::Abs([double]$actual[$key]-$expected);if($key -eq 'rotation'){$difference=[Math]::Min($difference,[Math]::Abs(360-$difference))};if($difference -gt 0.02){return $false}
    }
    if($automatic -and $layout.available -and $layout.mayOverflow){return $false}
    return $true
}
function Write-PptTextFrameLayout($entry,$data){
    if($entry.doc.ReadOnly){return @{notIssued=$true;verified=$false;code='READ_ONLY'}}
    if($data.selection.frameProfileVersion -ne 1){return @{notIssued=$true;verified=$false;code='PPT_FRAME_CAPTURE_REQUIRED'}}
    $before=Read-PptLayout $entry $data.selection
    if($before.contentHash -cne [string]$data.expectedFingerprint){return @{notIssued=$true;verified=$false;code='REVISION_CONFLICT'}}
    $beforeRich=Read-PptReplacement $entry $data.selection
    if($beforeRich.contentHash -cne [string]$data.expectedRichFingerprint){return @{notIssued=$true;verified=$false;code='REVISION_CONFLICT'}}
    if($beforeRich.state.start -ne 1 -or $beforeRich.state.length -ne $beforeRich.state.text.Length){return @{notIssued=$true;verified=$false;code='PPT_COMPLETE_TEXT_FRAME_REQUIRED'}}
    $shape=Resolve-PptTextShape $entry $data.selection;$wanted=Get-PptTextFramePlan $before.state.textFrame $data
    $nominalHash=if($before.state.nominalContentHash){$before.state.nominalContentHash}else{Read-PptFrameContentHash $entry $data.selection}
    if($data.expectedNominalHash -and $nominalHash -cne [string]$data.expectedNominalHash){return @{notIssued=$true;verified=$false;code='REVISION_CONFLICT'}}
    if($data.restoreTextProfiles){if($data.restoreTextProfiles.Count -ne $beforeRich.state.profiles.Count){throw 'PPT_FRAME_RESTORE_TEXT_SHAPE'};foreach($profile in $data.restoreTextProfiles){if([double]$profile.Size -lt 1 -or [double]$profile.Size -gt 400){throw 'PPT_FRAME_RESTORE_FONT_SIZE'}}}
    $initial=[ordered]@{};foreach($key in $before.state.geometry.Keys){$initial[$key]=$(if($null -ne $data.geometry.$key){[double]$data.geometry.$key}else{$before.state.geometry[$key]})}
    if($before.state.lockAspectRatio -ne 0){
        if($null -ne $data.geometry.width -and $null -eq $data.geometry.height){$initial.height=$initial.width*$before.state.geometry.height/$before.state.geometry.width}
        elseif($null -ne $data.geometry.height -and $null -eq $data.geometry.width){$initial.width=$initial.height*$before.state.geometry.width/$before.state.geometry.height}
    }
    if($initial.width -le $wanted.MarginLeft+$wanted.MarginRight -or $initial.height -le $wanted.MarginTop+$wanted.MarginBottom){return @{notIssued=$true;verified=$false;code='PPT_FRAME_MARGINS_EXCEED_SIZE'}}
    if($before.state.lockAspectRatio -ne 0 -and ($wanted.AutoSize -eq 1 -or [Math]::Abs([double]$initial.height-[double]$initial.width*$before.state.geometry.height/$before.state.geometry.width) -gt 0.02)){return @{notIssued=$true;verified=$false;code='ASPECT_RATIO_LOCKED'}}
    $frame=$shape.TextFrame2
    if($frame.AutoSize -ne 0){$frame.AutoSize=0}
    $nominal=Read-PptReplacement $entry $data.selection
    $proofData=@{textFrame=$data.textFrame;restoreTextFrame=$data.restoreTextFrame;restoreTextProfiles=$data.restoreTextProfiles;nominalProfiles=$nominal.state.profiles}
    foreach($key in @('width','height','left','top','rotation')){if([Math]::Abs([double]$shape.$key-[double]$initial[$key]) -gt 0.001){$shape.$key=[double]$initial[$key]}}
    foreach($key in @('MarginLeft','MarginRight','MarginTop','MarginBottom')){if([Math]::Abs([double]$frame.$key-[double]$wanted[$key]) -gt 0.001){$frame.$key=[double]$wanted[$key]}}
    foreach($key in @('VerticalAnchor','WordWrap')){if($frame.$key -ne $wanted[$key]){$frame.$key=[int]$wanted[$key]}}
    if($frame.AutoSize -ne $wanted.AutoSize){$frame.AutoSize=[int]$wanted.AutoSize}
    $after=Read-PptLayout $entry $data.selection;$afterRich=Read-PptReplacement $entry $data.selection;$layout=Read-PptParagraphLayoutCheck $shape
    $afterNominalHash=if($after.state.nominalContentHash){$after.state.nominalContentHash}else{Read-PptFrameContentHash $entry $data.selection}
    $verified=(Test-PptTextFrameMatch $wanted $after.state.textFrame) -and (Test-PptFrameText $beforeRich.state $afterRich.state $proofData $wanted) -and (Test-PptFrameGeometry $initial $after.state.geometry $wanted ([bool]$data.restoreTextFrame) $layout) -and $after.state.lockAspectRatio -eq $before.state.lockAspectRatio -and $after.state.type -eq $before.state.type -and $nominalHash -ceq $afterNominalHash
    $next=@{};foreach($p in $data.selection.PSObject.Properties){$next[$p.Name]=$p.Value};$next.layoutRevision=$after.contentHash;$next.contentHash=$afterRich.formatHash;$next.replacementRevision=$afterRich.contentHash
    $sizes=@($afterRich.state.profiles|ForEach-Object {[double]$_.Size});$minimum=($sizes|Measure-Object -Minimum).Minimum
    return @{before=$before;after=$after;beforeRich=$beforeRich;afterRich=$afterRich;nominalContentHash=$nominalHash;afterNominalContentHash=$afterNominalHash;beforeText=@{contentHash=$beforeRich.formatHash};afterText=@{contentHash=$afterRich.formatHash};continuationSelection=$next;verified=$verified;revision=$after.contentHash;automaticGeometry=($wanted.AutoSize -eq 1);layoutCheck=$layout;minimumFontSize=$minimum;message=$(if($minimum -lt 10){'Fitted text includes small fonts below10pt; inspect readability and consider a larger frame.'}elseif($layout.mayOverflow){'Native bounds suggest overflow; inspect the slide before treating the task as finished.'}else{$null});code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
