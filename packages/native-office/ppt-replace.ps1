function Get-PptCharacterProfile($range,$modern){
    $font=$range.Font;$color=$font.Color;$effect=$modern.Font
    if($effect.Fill.Type -ne 1 -or $effect.Fill.Transparency -ne 0 -or $effect.Line.Visible -ne 0 -or $effect.Glow.Radius -ne 0 -or $effect.Reflection.Type -ne 0 -or $font.Shadow -ne 0 -or $font.Emboss -ne 0){throw 'PPT_COMPLEX_TEXT_EFFECT_UNSUPPORTED'}
    foreach($event in @(1,2)){if($range.ActionSettings.Item($event).Action -ne 0){throw 'PPT_TEXT_ACTION_UNSUPPORTED'}}
    if($color.Type -notin @(1,2)){throw 'PPT_COLOR_UNSUPPORTED'}
    $values=[ordered]@{}
    foreach($field in @('Bold','Italic','Underline','Size','Name','NameAscii','NameFarEast','NameComplexScript','NameOther','BaselineOffset','AutoRotateNumbers','Subscript','Superscript')){$values[$field]=$font.$field}
    $values.Color=[ordered]@{type=[int]$color.Type;rgb=[int]$color.RGB;scheme=[int]$color.SchemeColor;theme=[int]$color.ObjectThemeColor;tint=[double]$color.TintAndShade}
    return $values
}
function Read-PptReplacement($entry,$selection){
    $base=Read-PptFormat $entry $selection;$shape=Resolve-PptTextShape $entry $selection
    if($shape.Type -notin @(1,14,17)){throw 'PPT_TEXT_SHAPE_UNSUPPORTED'}
    $profiles=[Collections.Generic.List[object]]::new()
    if(Get-Command Read-PptRichFontArray -ErrorAction SilentlyContinue){foreach($profile in @(Read-PptRichFontArray $shape.TextFrame.TextRange $shape.TextFrame2.TextRange)){$profiles.Add($profile)}}else{for($i=1;$i -le $base.state.fonts.Count;$i++){$profiles.Add((Get-PptCharacterProfile $shape.TextFrame.TextRange.Characters($i,1) $shape.TextFrame2.TextRange.Characters($i,1)))}}
    $paragraphs=[Collections.Generic.List[object]]::new()
    $count=([string]$base.state.text).Split([char]13).Length
    for($i=1;$i -le $count;$i++){
        $range=$shape.TextFrame.TextRange.Paragraphs($i,1);$p=$range.ParagraphFormat;$values=[ordered]@{indent=[int]$range.IndentLevel}
        foreach($field in @('Alignment','BaseLineAlignment','FarEastLineBreakControl','HangingPunctuation','LineRuleAfter','LineRuleBefore','LineRuleWithin','SpaceAfter','SpaceBefore','SpaceWithin','TextDirection','WordWrap')){$values[$field]=$p.$field}
        $bullet=$p.Bullet;$values.bullet=[ordered]@{visible=[int]$bullet.Visible;type=[int]$bullet.Type;character=[int]$bullet.Character;relativeSize=[double]$bullet.RelativeSize;start=[int]$bullet.StartValue}
        # Old captures/journals retain their original fingerprint representation.
        if($selection.paragraphProfileVersion -eq 1){
            $modern=$shape.TextFrame2.TextRange.Paragraphs($i,1).ParagraphFormat
            foreach($field in @('LeftIndent','RightIndent','FirstLineIndent')){$values[$field]=[double]$modern.$field}
            $values.bullet.details=Read-PptBulletDetails $bullet
        }
        $paragraphs.Add($values)
    }
    $state=[ordered]@{text=$base.state.text;start=$base.state.start;length=$base.state.length;profiles=$profiles.ToArray();paragraphs=$paragraphs.ToArray();geometry=@{left=$base.state.left;top=$base.state.top;width=$base.state.width;height=$base.state.height;rotation=$base.state.rotation}}
    return @{selection=$selection;state=$state;formatHash=$base.contentHash;contentHash=(Hash-Text (ConvertTo-Json -InputObject $state -Depth 12 -Compress))}
}
function Set-PptCharacterProfile($range,$profile){
    # Do not rewrite already-correct properties: native replacement often retains inheritance.
    $font=$range.Font
    foreach($field in @('Name','NameAscii','NameFarEast','NameComplexScript','NameOther','Bold','Italic','Underline','Size','BaselineOffset','AutoRotateNumbers')){if($font.$field -cne $profile.$field){
        $value=if($field.StartsWith('Name')){[string]$profile.$field}elseif($field -in @('Size','BaselineOffset')){[double]$profile.$field}else{[int]$profile.$field}
        $font.$field=$value
    }}
    $color=$font.Color;$old=$profile.Color
    if($color.Type -ne $old.type -or $color.RGB -ne $old.rgb -or $color.ObjectThemeColor -ne $old.theme -or $color.TintAndShade -ne $old.tint){
        if($old.type -eq 1){$color.RGB=[int]$old.rgb}elseif($old.theme -gt 0){$color.ObjectThemeColor=[int]$old.theme}else{$color.SchemeColor=[int]$old.scheme}
        $color.TintAndShade=[double]$old.tint
    }
}
function Write-PptReplacement($entry,$data){
    if($entry.doc.ReadOnly){return @{notIssued=$true;verified=$false;code='READ_ONLY'}}
    $before=Read-PptReplacement $entry $data.selection
    if($before.contentHash -cne [string]$data.expectedFingerprint){return @{verified=$false;code='REVISION_CONFLICT'}}
    $shape=Resolve-PptTextShape $entry $data.selection;$base=[int]$before.state.start-1;$end=$base+[int]$before.state.length
    $text=[string]$data.text
    if($text.Length -lt 1 -or $text.Length -gt 2000 -or $text -match '[\x00-\x1f\u2028\u2029]'){throw 'PPT_TEXT_LIMIT'}
    $planned=([string]$before.state.text).Substring($base,[int]$before.state.length);$previous=$planned.Length
    foreach($edit in $data.splices){
        $a=[int]$edit.start;$b=[int]$edit.end
        if($a -lt 0 -or $b -lt $a -or $b -gt $previous){throw 'PPT_SPLICE_ORDER'}
        $planned=$planned.Substring(0,$a)+[string]$edit.text+$planned.Substring($b);$previous=$a
    }
    if($planned -cne $text -or $data.expectedProfiles.Count -ne ([string]$data.expectedText).Length){throw 'PPT_SPLICE_RESULT'}
    $fit=[int]$shape.TextFrame2.AutoSize;$beforeNominal=$null;$frameBefore=$null;$expectedProfiles=$data.expectedProfiles
    if($fit -ne 0){
        if($fit -notin @(1,2) -or $data.selection.frameProfileVersion -ne 1){return @{notIssued=$true;verified=$false;code='PPT_FIT_CAPTURE_REQUIRED'}}
        $layoutBefore=Read-PptLayout $entry $data.selection
        if($layoutBefore.contentHash -cne [string]$data.selection.layoutRevision){return @{notIssued=$true;verified=$false;code='REVISION_CONFLICT'}}
        $frameBefore=$layoutBefore.state.textFrame
        if($data.expectedProfileOrigins.Count -ne ([string]$data.expectedText).Length -or @($data.expectedProfileOrigins|Where-Object {$_ -isnot [ValueType] -or $_ -is [bool] -or [int]$_ -ne [double]$_ -or [int]$_ -lt 0 -or [int]$_ -ge $before.state.profiles.Count}).Count){throw 'PPT_NOMINAL_ORIGIN_MAP'}
        if($data.restoreNominalProfiles -and $data.restoreNominalProfiles.Count -ne ([string]$data.expectedText).Length){throw 'PPT_NOMINAL_RESTORE_SHAPE'}
        $shape.TextFrame2.AutoSize=0;$beforeNominal=Read-PptReplacement $entry $data.selection
        $expectedProfiles=if($data.restoreNominalProfiles){$data.restoreNominalProfiles}else{@(foreach($origin in $data.expectedProfileOrigins){$beforeNominal.state.profiles[[int]$origin]})}
    }
    foreach($edit in $data.splices){
        $a=$base+[int]$edit.start;$length=[int]$edit.end-[int]$edit.start
        if($length -gt 0){$shape.TextFrame.TextRange.Characters($a+1,$length).Text=[string]$edit.text}
        elseif(([string]$edit.text).Length -gt 0){
            if($a -eq 0){$null=$shape.TextFrame.TextRange.InsertBefore([string]$edit.text)}else{$null=$shape.TextFrame.TextRange.Characters($a,1).InsertAfter([string]$edit.text)}
        }
    }
    for($i=$base;$i -lt $base+$text.Length;$i++){Set-PptCharacterProfile $shape.TextFrame.TextRange.Characters($i+1,1) $expectedProfiles[$i]}
    $next=@{};foreach($property in $data.selection.PSObject.Properties){$next[$property.Name]=$property.Value}
    $next.textStart=$base+1;$next.textLength=$text.Length;$next.preview=$text
    $nominalAfter=Read-PptReplacement $entry $next
    $verified=$nominalAfter.state.text -ceq [string]$data.expectedText -and (ConvertTo-Json -InputObject $nominalAfter.state.profiles -Depth 12 -Compress) -ceq (ConvertTo-Json -InputObject $expectedProfiles -Depth 12 -Compress)
    if($fit -ne 0){$shape.TextFrame2.AutoSize=$fit}
    $after=if($fit -ne 0){Read-PptReplacement $entry $next}else{$nominalAfter};$next.contentHash=$after.formatHash;$next.replacementRevision=$after.contentHash
    $layoutCheck=$null;$layoutRevision=$null
    if($fit -ne 0){
        $frameAfter=Read-PptTextFrame $shape;$layoutCheck=Read-PptParagraphLayoutCheck $shape
        # A verified text splice can still need a separate visual layout adjustment.
        if(-not (Test-PptTextFrameMatch $frameBefore $frameAfter) -or -not (Test-PptFrameText $nominalAfter.state $after.state @{} $frameAfter) -or -not (Test-PptFrameGeometry $before.state.geometry $after.state.geometry $frameAfter $false @{available=$false})){$verified=$false}
        $layoutRevision=(Read-PptLayout $entry $next).contentHash;$next.layoutRevision=$layoutRevision
    }elseif((ConvertTo-Json -InputObject $before.state.geometry -Compress) -cne (ConvertTo-Json -InputObject $after.state.geometry -Compress)){$verified=$false}
    if((ConvertTo-Json -InputObject $before.state.paragraphs -Depth 12 -Compress) -cne (ConvertTo-Json -InputObject $after.state.paragraphs -Depth 12 -Compress)){$verified=$false}
    $minimum=if($fit -ne 0){($after.state.profiles|ForEach-Object {[double]$_.Size}|Measure-Object -Minimum).Minimum}else{$null}
    $message=if($null -ne $minimum -and $minimum -lt 10){'Fitted text includes small fonts below10pt; inspect readability and consider a larger frame.'}elseif($layoutCheck.mayOverflow){'Native bounds suggest overflow; inspect the slide before treating the task as finished.'}else{$null}
    return @{before=$before;beforeNominal=$beforeNominal;after=$after;continuationSelection=$next;verified=$verified;revision=$after.contentHash;layoutRevision=$layoutRevision;autoFit=$fit;layoutCheck=$layoutCheck;minimumFontSize=$minimum;message=$message;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
