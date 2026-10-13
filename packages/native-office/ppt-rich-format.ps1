function Test-PptFontProfileRestore($saved,$actual){
    $expected=[ordered]@{};foreach($p in $actual.Keys){$expected[$p]=$saved.$p}
    $emptyAlias=$null -eq $saved.NameOther -and $actual.NameOther -ceq ''
    if($emptyAlias){$expected.NameOther=''}
    return @{equal=((ConvertTo-Json -InputObject $expected -Depth 12 -Compress) -ceq (ConvertTo-Json -InputObject $actual -Depth 12 -Compress));emptyAlias=$emptyAlias}
}
function Write-PptRichFormat($entry,$data){
    if($entry.doc.ReadOnly){return @{notIssued=$true;verified=$false;code='READ_ONLY'}}
    $before=Read-PptReplacement $entry $data.selection
    if($before.contentHash -cne [string]$data.expectedFingerprint){return @{verified=$false;code='REVISION_CONFLICT'}}
    $fields=@($data.fields);$name=[string]$data.font.name;$rgb=0
    $shape=Resolve-PptTextShape $entry $data.selection;$paragraphPlan=$null
    if($data.paragraph){
        try{$paragraphPlan=Get-PptParagraphPlan $shape $before.state $data.paragraph $data.restoreParagraphs ($data.selection.frameProfileVersion -eq 1 -and [int]$shape.TextFrame2.AutoSize -in @(1,2))}
        catch{$code=($_.Exception.Message -split ':')[0];if($code -notmatch '^PPT_(?:PARAGRAPH_[A-Z_]+|COMPLETE_PARAGRAPH_REQUIRED)$'){$code='PPT_PARAGRAPH_PREFLIGHT_FAILED'};return @{notIssued=$true;verified=$false;code=$code;message='Paragraph preflight refused before any font or layout mutation.'}}
    }
    foreach($field in $fields){if($field -notin @('bold','italic','size','name','color')){throw 'PPT_FONT_FIELD'}}
    if($data.restoreProfiles){
        if($data.restoreProfiles.Count -ne $before.state.length){throw 'PPT_RESTORE_SHAPE'}
    }else{
        if('name' -in $fields){
            if($name.Length -lt 1 -or $name.Length -gt 128 -or $name -match '[\x00-\x1f\x7f]'){throw 'PPT_FONT_NAME'}
            Add-Type -AssemblyName System.Drawing
            $fonts=[Drawing.Text.InstalledFontCollection]::new()
            try{if(-not @($fonts.Families|Where-Object {$_.Name -ieq $name}).Count){return @{verified=$false;notIssued=$true;code='PPT_FONT_NOT_INSTALLED'}}}finally{$fonts.Dispose()}
        }
        if('color' -in $fields){$hex=[string]$data.font.color;if($hex -notmatch '^#[0-9a-fA-F]{6}$'){throw 'PPT_COLOR_VALUE'};$rgb=[Convert]::ToInt32($hex.Substring(1,2),16)+([Convert]::ToInt32($hex.Substring(3,2),16)*256)+([Convert]::ToInt32($hex.Substring(5,2),16)*65536)}
        if('size' -in $fields -and ([double]$data.font.size -lt 1 -or [double]$data.font.size -gt 400)){throw 'PPT_FONT_SIZE'}
        foreach($field in @('bold','italic')){if($field -in $fields -and $data.font.$field -isnot [bool]){throw 'PPT_FONT_VALUE'}}
    }
    $shape=Resolve-PptTextShape $entry $data.selection;$start=[int]$before.state.start;$length=[int]$before.state.length
    $beforeEffective=$before;$beforeNominal=$null;$fit=[int]$shape.TextFrame2.AutoSize;$frameBefore=$null
    if($fit -ne 0){
        if($fit -notin @(1,2) -or $data.selection.frameProfileVersion -ne 1){return @{notIssued=$true;verified=$false;code='PPT_FIT_CAPTURE_REQUIRED'}}
        $layoutBefore=Read-PptLayout $entry $data.selection
        if($layoutBefore.contentHash -cne [string]$data.selection.layoutRevision){return @{notIssued=$true;verified=$false;code='REVISION_CONFLICT'}}
        $frameBefore=$layoutBefore.state.textFrame
        $shape.TextFrame2.AutoSize=0;$beforeNominal=Read-PptReplacement $entry $data.selection;$before=$beforeNominal
    }
    for($i=0;$fields.Count -gt 0 -and $i -lt $length;$i++){
        $range=$shape.TextFrame.TextRange.Characters($start+$i,1)
        if($data.restoreProfiles){Set-PptCharacterProfile $range $data.restoreProfiles[$i];continue}
        $font=$range.Font
        foreach($field in $fields){switch($field){
            'name' {$font.Name=$name}
            'color' {$font.Color.RGB=$rgb;$font.Color.TintAndShade=0}
            'bold' {$font.Bold=$(if($data.font.bold){-1}else{0})}
            'italic' {$font.Italic=$(if($data.font.italic){-1}else{0})}
            'size' {$font.Size=[double]$data.font.size}
        }}
    }
    if($fields.Count -gt 0){
        # Formatting the last visible character can also stamp an unselected
        # paragraph mark. Preserve that mark rather than silently widening scope.
        for($i=0;$i -lt $before.state.profiles.Count;$i++){
            if(($i -lt $start-1 -or $i -ge $start-1+$length) -and ([string]$before.state.text)[$i] -eq [char]13){Set-PptCharacterProfile $shape.TextFrame.TextRange.Characters($i+1,1) $before.state.profiles[$i]}
        }
    }
    if($paragraphPlan){Set-PptParagraphPlan $shape $paragraphPlan}
    $after=Read-PptReplacement $entry $data.selection;$verified=$before.state.text -ceq $after.state.text
    if($paragraphPlan){if(-not (Test-PptParagraphPlan $paragraphPlan.expected $after.state.paragraphs)){$verified=$false}}
    elseif((ConvertTo-Json -InputObject $before.state.paragraphs -Depth 12 -Compress) -cne (ConvertTo-Json -InputObject $after.state.paragraphs -Depth 12 -Compress)){$verified=$false}
    if((ConvertTo-Json -InputObject $before.state.geometry -Depth 12 -Compress) -cne (ConvertTo-Json -InputObject $after.state.geometry -Depth 12 -Compress)){$verified=$false}
    $emptyAliases=[Collections.Generic.List[int]]::new()
    for($i=0;$i -lt $before.state.profiles.Count;$i++){
        $inside=$i -ge $start-1 -and $i -lt $start-1+$length;$old=$before.state.profiles[$i];$actual=$after.state.profiles[$i]
        if($inside -and $data.restoreProfiles){$comparison=Test-PptFontProfileRestore $data.restoreProfiles[$i-($start-1)] $actual;if(-not $comparison.equal){$verified=$false}elseif($comparison.emptyAlias){$emptyAliases.Add($i+1)};continue}
        foreach($p in $old.Keys){
            if($inside -and $p -eq 'Color' -and 'color' -in $fields){if($actual.Color.type -ne 1 -or $actual.Color.rgb -ne $rgb -or $actual.Color.tint -ne 0){$verified=$false};continue}
            $wanted=$old[$p]
            if($inside){
                if($p -eq 'Name' -and 'name' -in $fields){$wanted=$name}
                elseif($p -in @('NameAscii','NameFarEast','NameComplexScript','NameOther') -and 'name' -in $fields){
                    # Office resolves aliases by the selected glyph's script. A
                    # Latin-only edit need not rewrite a Far-East fallback.
                    if($actual[$p] -cne $old[$p] -and $actual[$p] -cne $name){$verified=$false};continue
                }
                elseif($p -eq 'Size' -and 'size' -in $fields){$wanted=[double]$data.font.size}
                elseif($p -eq 'Bold' -and 'bold' -in $fields){$wanted=$(if($data.font.bold){-1}else{0})}
                elseif($p -eq 'Italic' -and 'italic' -in $fields){$wanted=$(if($data.font.italic){-1}else{0})}
            }
            if((ConvertTo-Json -InputObject $wanted -Depth 12 -Compress) -cne (ConvertTo-Json -InputObject $actual[$p] -Depth 12 -Compress)){$verified=$false}
        }
    }
    $nominalVerified=$verified;$nominalAfter=$after;$layoutRevision=$null;$next=$null;$minimum=$null
    if($fit -ne 0){
        $nominalAfter=$after;$shape.TextFrame2.AutoSize=$fit;$after=Read-PptReplacement $entry $data.selection
        $frameAfter=Read-PptTextFrame $shape;$layoutCheck=Read-PptParagraphLayoutCheck $shape
        # Bounds report visual quality; overflow alone is not an unknown execution.
        if(-not (Test-PptTextFrameMatch $frameBefore $frameAfter) -or -not (Test-PptFrameText $nominalAfter.state $after.state @{} $frameAfter) -or -not (Test-PptFrameGeometry $beforeEffective.state.geometry $after.state.geometry $frameAfter $false @{available=$false})){$verified=$false}
        $layoutRevision=(Read-PptLayout $entry $data.selection).contentHash
        $next=@{};foreach($p in $data.selection.PSObject.Properties){$next[$p.Name]=$p.Value};$next.contentHash=$after.formatHash;$next.replacementRevision=$after.contentHash;$next.layoutRevision=$layoutRevision
        $minimum=($after.state.profiles|ForEach-Object {[double]$_.Size}|Measure-Object -Minimum).Minimum
    }else{$layoutCheck=if($paragraphPlan){Read-PptParagraphLayoutCheck $shape}else{$null}}
    $richRevision=$after.contentHash;$after.contentHash=$after.formatHash
    $message=if($null -ne $minimum -and $minimum -lt 10){'Fitted text includes small fonts below10pt; inspect readability and consider a larger frame.'}elseif($layoutCheck.mayOverflow){'Native text bounds suggest overflow; inspect the slide and request an explicit layout adjustment.'}else{$null}
    return @{before=$beforeEffective;beforeNominal=$beforeNominal;afterNominal=$nominalAfter;nominalVerified=$nominalVerified;after=$after;verified=$verified;revision=$after.formatHash;replacementRevision=$richRevision;layoutRevision=$layoutRevision;continuationSelection=$next;autoFit=$fit;minimumFontSize=$minimum;retainedEmptyFontAliases=$emptyAliases.ToArray();paragraphIndices=$(if($paragraphPlan){$paragraphPlan.indices}else{@()});layoutCheck=$layoutCheck;message=$message;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
