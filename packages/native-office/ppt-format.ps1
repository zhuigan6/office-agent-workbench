function Resolve-PptTextShape($entry,$selection){
    if($entry.kind -ne 'powerpoint' -or $selection.shapeIds.Count -ne 1){throw 'PPT_SINGLE_TEXT_SHAPE_REQUIRED'}
    $null=Assert-SelectionIdentity $entry $selection
    $slide=$entry.doc.Slides.FindBySlideID([int]$selection.slideId)
    for($i=1;$i -le $slide.Shapes.Count;$i++){
        $shape=$slide.Shapes.Item($i)
        if([string]$shape.Id -ceq [string]$selection.shapeIds[0]){
            if($shape.HasTextFrame -eq 0 -or $shape.Type -eq 6){throw 'PPT_TEXT_REQUIRED'}
            return $shape
        }
    }
    throw 'PPT_SHAPE_NOT_FOUND'
}
function Read-PptFormat($entry,$selection){
    $shape=Resolve-PptTextShape $entry $selection;$all=$shape.TextFrame.TextRange
    $total=[int]$all.Length
    if($total -lt 1 -or $total -gt 2000){throw 'PPT_TEXT_LIMIT'}
    $start=if($null -ne $selection.textStart){[int]$selection.textStart}else{1}
    $length=if($null -ne $selection.textLength){[int]$selection.textLength}else{$total}
    if($start -lt 1 -or $length -lt 1 -or $start+$length-1 -gt $total){throw 'PPT_TEXT_RANGE'}
    $fonts=[Collections.Generic.List[object]]::new()
    if(Get-Command Read-PptBasicFontArray -ErrorAction SilentlyContinue){foreach($profile in @(Read-PptBasicFontArray $all)){$fonts.Add($profile)}}else{for($i=1;$i -le $total;$i++){
        $font=$all.Characters($i,1).Font
        $fonts.Add([ordered]@{bold=[int]$font.Bold;italic=[int]$font.Italic;size=[double]$font.Size;name=[string]$font.Name})
    }}
    $state=[ordered]@{slideId=[string]$selection.slideId;shapeId=[string]$shape.Id;text=[string]$all.Text;left=[double]$shape.Left;top=[double]$shape.Top;width=[double]$shape.Width;height=[double]$shape.Height;rotation=[double]$shape.Rotation;start=$start;length=$length;fonts=$fonts.ToArray()}
    $hash=Hash-Text (ConvertTo-Json -InputObject $state -Depth 8 -Compress)
    return @{selection=$selection;state=$state;contentHash=$hash}
}
function Write-PptFormat($entry,$data){
    if($entry.doc.ReadOnly){return @{notIssued=$true;verified=$false;code='READ_ONLY'}}
    $before=Read-PptFormat $entry $data.selection
    if($before.contentHash -cne [string]$data.expectedFingerprint){return @{verified=$false;code='REVISION_CONFLICT'}}
    $shape=Resolve-PptTextShape $entry $data.selection
    if([int]$shape.TextFrame2.AutoSize -ne 0){return @{notIssued=$true;verified=$false;code='PPT_FIT_CAPTURE_REQUIRED'}}
    $range=$shape.TextFrame.TextRange.Characters([int]$before.state.start,[int]$before.state.length)
    if($data.restore){
        if($data.restore.Count -ne $before.state.length){throw 'PPT_RESTORE_SHAPE'}
        foreach($font in $data.restore){foreach($field in $data.fields){
            if($field -in @('bold','italic') -and $font.$field -notin @(-1,0)){throw 'PPT_RESTORE_FONT'}
            if($field -eq 'size' -and ($font.size -lt 1 -or $font.size -gt 400)){throw 'PPT_RESTORE_FONT'}
        }}
        for($i=1;$i -le $range.Length;$i++){$font=$range.Characters($i,1).Font;$old=$data.restore[$i-1]
            foreach($field in $data.fields){switch($field){'bold'{$font.Bold=[int]$old.bold};'italic'{$font.Italic=[int]$old.italic};'size'{$font.Size=[double]$old.size};default{throw 'PPT_FONT_FIELD'}}}
        }
    }else{
        foreach($field in $data.fields){switch($field){'bold'{$range.Font.Bold=$(if($data.font.bold){-1}else{0})};'italic'{$range.Font.Italic=$(if($data.font.italic){-1}else{0})};'size'{$range.Font.Size=[double]$data.font.size};default{throw 'PPT_FONT_FIELD'}}}
    }
    $after=Read-PptFormat $entry $data.selection;$verified=$true
    foreach($field in @('text','left','top','width','height','rotation')){if($before.state[$field] -cne $after.state[$field]){$verified=$false}}
    for($i=0;$i -lt $before.state.fonts.Count;$i++){
        $inside=$i -ge $before.state.start-1 -and $i -lt $before.state.start-1+$before.state.length
        foreach($field in @('bold','italic','size','name')){
            $expected=$before.state.fonts[$i][$field]
            if($inside -and $field -in $data.fields){$expected=if($data.restore){$data.restore[$i-($before.state.start-1)].$field}elseif($field -eq 'size'){$data.font.size}elseif($data.font.$field){-1}else{0}}
            if($after.state.fonts[$i][$field] -cne $expected){$verified=$false}
        }
    }
    $replacementRevision=$null
    if($data.selection.replacementRevision){try{$replacementRevision=(Read-PptReplacement $entry $data.selection).contentHash}catch{}}
    return @{before=$before;after=$after;verified=$verified;revision=$after.contentHash;replacementRevision=$replacementRevision;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
