function Resolve-PptShape($entry,$selection){
    if($entry.kind -ne 'powerpoint' -or $selection.shapeIds.Count -ne 1){throw 'PPT_SINGLE_SHAPE_REQUIRED'}
    $null=Assert-SelectionIdentity $entry $selection
    $slide=$entry.doc.Slides.FindBySlideID([int]$selection.slideId)
    for($i=1;$i -le $slide.Shapes.Count;$i++){$shape=$slide.Shapes.Item($i);if([string]$shape.Id -ceq [string]$selection.shapeIds[0]){return $shape}}
    throw 'PPT_SHAPE_NOT_FOUND'
}
function Read-PptLayout($entry,$selection){
    $shape=Resolve-PptShape $entry $selection
    if($shape.Type -eq 6){throw 'PPT_GROUP_LAYOUT_REQUIRES_CHILD_SNAPSHOT'}
    $geometry=[ordered]@{left=[double]$shape.Left;top=[double]$shape.Top;width=[double]$shape.Width;height=[double]$shape.Height;rotation=[double]$shape.Rotation}
    $state=[ordered]@{slideId=[string]$selection.slideId;shapeId=[string]$shape.Id;type=[int]$shape.Type;geometry=$geometry;lockAspectRatio=[int]$shape.LockAspectRatio}
    return @{selection=$selection;state=$state;contentHash=(Hash-Text (ConvertTo-Json -InputObject $state -Depth 6 -Compress))}
}
function Write-PptLayout($entry,$data){
    if($entry.doc.ReadOnly){return @{notIssued=$true;verified=$false;code='READ_ONLY'}}
    $before=Read-PptLayout $entry $data.selection
    if($before.contentHash -cne [string]$data.expectedFingerprint){return @{verified=$false;code='REVISION_CONFLICT'}}
    $shape=Resolve-PptShape $entry $data.selection
    $beforeText=$null
    if($shape.HasTextFrame -ne 0 -and $shape.TextFrame.TextRange.Length -gt 0 -and $shape.TextFrame.TextRange.Length -le 2000){
        $beforeText=Read-PptFormat $entry $data.selection
        if($data.expectedTextFingerprint -and $beforeText.contentHash -cne [string]$data.expectedTextFingerprint){return @{verified=$false;code='REVISION_CONFLICT'}}
    }
    if($before.state.lockAspectRatio -ne 0 -and $null -ne $data.geometry.width -and $null -ne $data.geometry.height){
        if($before.state.geometry.width -le 0 -or [Math]::Abs([double]$data.geometry.height-([double]$data.geometry.width*$before.state.geometry.height/$before.state.geometry.width)) -gt 0.02){return @{notIssued=$true;verified=$false;code='ASPECT_RATIO_LOCKED'}}
    }
    # Do not toggle aspect-ratio locking; honor the document's existing behavior.
    # A width/height edit may therefore change both dimensions; readback records it.
    foreach($field in @('left','top','width','height','rotation')){if($null -ne $data.geometry.$field){$shape.$field=[double]$data.geometry.$field}}
    $after=Read-PptLayout $entry $data.selection;$verified=$before.state.type -eq $after.state.type
    foreach($field in @('left','top','width','height','rotation')){
        $expected=if($null -ne $data.geometry.$field){[double]$data.geometry.$field}else{[double]$before.state.geometry[$field]}
        # With locked aspect ratio, an unspecified counterpart dimension follows
        # the requested dimension rather than being incorrectly called corruption.
        $coupled=$before.state.lockAspectRatio -ne 0 -and (($field -eq 'height' -and $null -ne $data.geometry.width -and $null -eq $data.geometry.height) -or ($field -eq 'width' -and $null -ne $data.geometry.height -and $null -eq $data.geometry.width))
        if($coupled){$counter=if($field -eq 'height'){'width'}else{'height'};if($before.state.geometry[$counter] -le 0){$verified=$false}else{$expected=$before.state.geometry[$field]*[double]$data.geometry.$counter/$before.state.geometry[$counter]}}
        $difference=[Math]::Abs([double]$after.state.geometry[$field]-$expected)
        if($field -eq 'rotation'){$difference=[Math]::Min($difference,[Math]::Abs(360-$difference))}
        if($difference -gt 0.02){$verified=$false}
    }
    if($after.state.lockAspectRatio -ne $before.state.lockAspectRatio){$verified=$false}
    $afterText=$null
    if($beforeText){
        $afterText=Read-PptFormat $entry $data.selection
        if($beforeText.state.text -cne $afterText.state.text -or (ConvertTo-Json -InputObject $beforeText.state.fonts -Depth 5 -Compress) -cne (ConvertTo-Json -InputObject $afterText.state.fonts -Depth 5 -Compress)){$verified=$false}
    }
    $next=@{};foreach($property in $data.selection.PSObject.Properties){$next[$property.Name]=$property.Value}
    $next.layoutRevision=$after.contentHash;$next.contentHash=if($afterText){$afterText.contentHash}else{$after.contentHash}
    return @{before=$before;after=$after;beforeText=$beforeText;afterText=$afterText;continuationSelection=$next;verified=$verified;revision=$after.contentHash;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
function Read-PptShapes($entry,$data){
    if($entry.kind -ne 'powerpoint'){throw 'HOST_KIND'}
    $start=[int]$data.start;$count=if($data.count){[int]$data.count}else{20}
    if($start -lt 0 -or $count -lt 1 -or $count -gt 50){throw 'PAGE_LIMIT'}
    $slide=$entry.doc.Slides.FindBySlideID([int]$data.slideId);$items=[Collections.Generic.List[object]]::new()
    for($i=$start+1;$i -le [Math]::Min($slide.Shapes.Count,$start+$count);$i++){
        $shape=$slide.Shapes.Item($i);$text=''
        if($shape.HasTextFrame -ne 0){$text=[string]$shape.TextFrame.TextRange.Text}
        $items.Add(@{shapeId=[string]$shape.Id;name=[string]$shape.Name;type=[int]$shape.Type;hasText=($shape.HasTextFrame -ne 0);preview=$text.Substring(0,[Math]::Min(200,$text.Length));left=[double]$shape.Left;top=[double]$shape.Top;width=[double]$shape.Width;height=[double]$shape.Height})
    }
    return @{slideId=[string]$slide.SlideID;items=$items.ToArray();nextStart=$(if($start+$count -lt $slide.Shapes.Count){$start+$count}else{$null})}
}
