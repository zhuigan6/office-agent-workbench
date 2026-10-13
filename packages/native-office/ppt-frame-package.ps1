function Get-PptFrameContentXml($shapeXml,[bool]$omitAppearance=$false){
    $node=$shapeXml.CloneNode($true)
    if($omitAppearance){
        foreach($n in @($node.SelectNodes('./*[local-name()="spPr"]/*[namespace-uri()="http://schemas.openxmlformats.org/drawingml/2006/main" and (local-name()="solidFill" or local-name()="noFill" or local-name()="ln")]'))){$null=$n.ParentNode.RemoveChild($n)}
        # Office stores disabled appearance in these exact extension records.
        # They belong to the appearance mask, not to text/style invariants.
        $extensions=@{'{909E8E84-426E-40DD-AFC4-6F175D3DCCD1}'='hiddenFill';'{91240B29-F687-4F45-9708-019B960494DF}'='hiddenLine'}
        foreach($ext in @($node.SelectNodes('./*[local-name()="spPr"]/*[namespace-uri()="http://schemas.openxmlformats.org/drawingml/2006/main" and local-name()="extLst"]/*[namespace-uri()="http://schemas.openxmlformats.org/drawingml/2006/main" and local-name()="ext"]'))){
            $expected=$extensions[$ext.GetAttribute('uri')]
            if($expected -and @($ext.Attributes|Where-Object {$_.NamespaceURI -cne 'http://www.w3.org/2000/xmlns/'}).Count -eq 1 -and $ext.ChildNodes.Count -eq 1 -and $ext.FirstChild.LocalName -ceq $expected -and $ext.FirstChild.NamespaceURI -ceq 'http://schemas.microsoft.com/office/drawing/2010/main'){
                $parent=$ext.ParentNode;$null=$parent.RemoveChild($ext)
                if($parent.ChildNodes.Count -eq 0){$null=$parent.ParentNode.RemoveChild($parent)}
            }
        }
    }
    foreach($n in @($node.SelectNodes('./*[local-name()="spPr"]/*[local-name()="xfrm"]|./*[local-name()="txBody"]/*[local-name()="bodyPr"]/*[local-name()="normAutofit" or local-name()="spAutoFit" or local-name()="noAutofit"]'))){$null=$n.ParentNode.RemoveChild($n)}
    foreach($body in @($node.SelectNodes('./*[local-name()="txBody"]/*[local-name()="bodyPr"]'))){foreach($key in @('lIns','rIns','tIns','bIns','anchor','wrap')){$body.RemoveAttribute($key)}}
    # Proofing dirtiness changes during native edits without changing text or style.
    foreach($properties in @($node.SelectNodes('./*[local-name()="txBody"]//*[namespace-uri()="http://schemas.openxmlformats.org/drawingml/2006/main" and (local-name()="rPr" or local-name()="endParaRPr" or local-name()="defRPr")]'))){$properties.RemoveAttribute('dirty')}
    # Native splices can split identical adjacent runs; retain every real style boundary.
    $drawing='http://schemas.openxmlformats.org/drawingml/2006/main'
    foreach($paragraph in @($node.SelectNodes('./*[local-name()="txBody"]/*[local-name()="p"]'))){
        $previous=$null
        foreach($run in @($paragraph.ChildNodes)){
            if($run.NamespaceURI -cne $drawing -or $run.LocalName -cne 'r' -or $run.Attributes.Count -ne 0 -or $run.ChildNodes.Count -ne 2){$previous=$null;continue}
            $properties=$run.SelectSingleNode('./*[local-name()="rPr"]');$text=$run.SelectSingleNode('./*[local-name()="t"]')
            if(-not $properties -or -not $text -or $properties.NamespaceURI -cne $drawing -or $text.NamespaceURI -cne $drawing){$previous=$null;continue}
            $textSignature=$text.CloneNode($true);$textSignature.InnerText=''
            $signature=$properties.OuterXml+'|'+$textSignature.OuterXml
            if($previous -and $previous.signature -ceq $signature){$previous.text.InnerText+=$text.InnerText;$null=$paragraph.RemoveChild($run)}
            else{$previous=@{signature=$signature;text=$text}}
        }
    }
    return $node.OuterXml
}
function Read-PptFrameContentHash($entry,$selection,[bool]$omitAppearance=$false){
    $root=[IO.Path]::GetFullPath($env:WORKBENCH_NATIVE_SNAPSHOTS).TrimEnd('\')+'\'
    if(-not (Test-Path -LiteralPath $root -PathType Container)){throw 'PPT_FRAME_SNAPSHOT_ROOT'}
    $file=Join-Path $root ([Guid]::NewGuid().ToString()+'.pptx');if(-not $file.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $file)){throw 'PPT_FRAME_SNAPSHOT_PATH'}
    $archive=$null
    try{
        $null=$entry.doc.SaveCopyAs($file,24)
        if((Get-Item -LiteralPath $file).Length -gt 33554432){throw 'PPT_FRAME_SNAPSHOT_LIMIT'}
        $archive=[IO.Compression.ZipFile]::OpenRead($file);if($archive.Entries.Count -gt 10000){throw 'PPT_FRAME_SNAPSHOT_LIMIT'}
        $size=0;$names=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach($part in $archive.Entries){$size+=$part.Length;if($size -gt 134217728 -or $part.Length -gt 33554432 -or -not $names.Add($part.FullName) -or $part.FullName -match '(^/|\\|(^|/)\.\.(/|$)|:|vbaProject\.bin$)'){throw 'PPT_FRAME_SNAPSHOT_LIMIT'}}
        $presentation=Read-ChartPartXml $archive 'ppt/presentation.xml';$slides=@($presentation.SelectNodes('//*[local-name()="sldId"]')|Where-Object {$_.GetAttribute('id') -ceq [string]$selection.slideId});if($slides.Count -ne 1){throw 'PPT_FRAME_SNAPSHOT_SLIDE'}
        $part=Resolve-ChartRelationship $archive 'ppt/presentation.xml' ($slides[0].GetAttribute('id','http://schemas.openxmlformats.org/officeDocument/2006/relationships'));$slide=Read-ChartPartXml $archive $part
        $shapes=@($slide.SelectNodes('//*[local-name()="sp"]')|Where-Object {$n=$_.SelectSingleNode('./*[local-name()="nvSpPr"]/*[local-name()="cNvPr"]');$null -ne $n -and $n.GetAttribute('id') -ceq [string]$selection.shapeIds[0]});if($shapes.Count -ne 1){throw 'PPT_FRAME_SNAPSHOT_SHAPE'}
        if($omitAppearance -and $shapes[0].SelectNodes('./*[local-name()="spPr"]/*[local-name()="gradFill" or local-name()="pattFill" or local-name()="blipFill" or local-name()="grpFill"]|./*[local-name()="spPr"]/*[local-name()="ln"]/*[local-name()="gradFill" or local-name()="pattFill" or local-name()="blipFill" or local-name()="grpFill"]').Count){throw 'PPT_APPEARANCE_STYLE_UNSUPPORTED'}
        $parts=[Collections.Generic.List[string]]::new();$parts.Add((Get-PptFrameContentXml $shapes[0] $omitAppearance))
        foreach($dependency in @($archive.Entries|Where-Object {$_.FullName -match '^ppt/(slideMasters|slideLayouts|theme)/[^/]+\.xml$'}|Sort-Object FullName)){if($parts.Count -gt 200){throw 'PPT_FRAME_STYLE_DEPENDENCY_LIMIT'};$parts.Add($dependency.FullName+'|'+(Hash-Text ((Read-ChartPartXml $archive $dependency.FullName).OuterXml)))}
        return Hash-Text ($parts.ToArray() -join '|')
    }finally{if($archive){$archive.Dispose()};if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force -ErrorAction Stop}}
}
