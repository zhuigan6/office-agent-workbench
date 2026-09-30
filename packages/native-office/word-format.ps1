# Explicit range formatting. Paragraph properties never expand a partial selection.
$script:wordParagraphProperties=@{alignment='Alignment';spaceBefore='SpaceBefore';spaceAfter='SpaceAfter';leftIndent='LeftIndent';rightIndent='RightIndent';firstLineIndent='FirstLineIndent';keepWithNext='KeepWithNext';keepTogether='KeepTogether'}
function Assert-WordParagraphValue([string]$field,$value){
    if(-not $script:wordParagraphProperties.ContainsKey($field)){throw 'WORD_PARAGRAPH_FIELD'}
    if($field -eq 'alignment'){if($value -notin @(0,1,2,3)){throw 'WORD_PARAGRAPH_VALUE'};return}
    if($field -in @('keepWithNext','keepTogether')){if($value -notin @(-1,0)){throw 'WORD_PARAGRAPH_VALUE'};return}
    $number=[double]$value;$minimum=if($field -eq 'firstLineIndent'){-1584}else{0}
    if([double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -lt $minimum -or $number -gt 1584){throw 'WORD_PARAGRAPH_VALUE'}
}
function Get-WordParagraphValue([string]$field,$value){
    if($field -eq 'alignment'){
        switch([string]$value){'left'{return 0};'center'{return 1};'right'{return 2};'justify'{return 3};default{throw 'WORD_PARAGRAPH_VALUE'}}
    }
    if($field -in @('keepWithNext','keepTogether')){if($value -isnot [bool]){throw 'WORD_PARAGRAPH_VALUE'};return $(if($value){-1}else{0})}
    Assert-WordParagraphValue $field $value
    return [double]$value
}
function Read-WordFormat($entry,$selection,$fields,$paragraphFields=@()){
    $paragraphFields=@($paragraphFields | Where-Object {$null -ne $_})
    if($entry.kind -ne 'word' -or [int]$selection.storyType -ne 1){throw 'WORD_BODY_REQUIRED'}
    $null=Assert-SelectionIdentity $entry $selection
    $start=[int]$selection.start;$end=[int]$selection.end
    if($start -lt 0 -or $end -le $start -or $end-$start -gt 2000 -or $end -gt $entry.doc.Content.End){throw 'WORD_RANGE_LIMIT'}
    $range=$entry.doc.Range($start,$end)
    if($range.Fields.Count -gt 0 -or $range.ContentControls.Count -gt 0 -or $range.Revisions.Count -gt 0){throw 'WORD_SPECIAL_CONTENT: Fields, content controls and revision-marked text need a dedicated workflow.'}
    $xml=[string]$range.WordOpenXML
    if($xml.Length -gt 1048576){throw 'WORD_RANGE_LIMIT'}
    $hash=Hash-Text ([string]$range.Start+'|'+$range.End+'|'+[string]$entry.doc.Content.Text+'|'+(Get-WordSemanticXml $xml))
    $paragraphs=[Collections.Generic.List[object]]::new();$snapshotChars=0
    if(@($paragraphFields).Count -gt 0){
        if($range.Tables.Count -gt 0 -or $range.Paragraphs.Count -gt 20){throw 'WORD_PARAGRAPH_SCOPE'}
        $first=$range.Paragraphs.Item(1).Range;$last=$range.Paragraphs.Item($range.Paragraphs.Count).Range
        if($start -ne $first.Start -or ($end -ne $last.End -and $end -ne $last.End-1)){throw 'WORD_FULL_PARAGRAPHS_REQUIRED'}
        for($i=1;$i -le $range.Paragraphs.Count;$i++){
            $p=$range.Paragraphs.Item($i).Range;$format=@{}
            if($p.ListFormat.ListType -ne 0){throw 'WORD_LIST_PARAGRAPH_UNSUPPORTED'}
            $pXml=[string]$p.WordOpenXML;$snapshotChars+=$pXml.Length
            if($snapshotChars -gt 1048576){throw 'WORD_PARAGRAPH_SNAPSHOT_LIMIT'}
            if($pXml -match '<w:(drawing|object|pict|fldChar|fldSimple|instrText|sdt|ins|del|moveFrom|moveTo|footnoteReference|endnoteReference|commentRangeStart|bookmarkStart|hyperlink|oMath|altChunk)\b'){throw 'WORD_SPECIAL_CONTENT'}
            foreach($field in $paragraphFields){
                if(-not $script:wordParagraphProperties.ContainsKey([string]$field)){throw 'WORD_PARAGRAPH_FIELD'}
                $property=$script:wordParagraphProperties[[string]$field]
                $value=[double]$p.ParagraphFormat.$property
                Assert-WordParagraphValue $field $value
                $format[$field]=$value
            }
            $paragraphs.Add(@{start=[int]$p.Start;end=[int]$p.End;text=[string]$p.Text;format=$format;xml=$pXml;contentHash=(Hash-Text (Get-WordSemanticXml $pXml))})
        }
    }
    $formats=[Collections.Generic.List[object]]::new()
    for($i=1;$i -le $range.Characters.Count;$i++){
        $font=$range.Characters.Item($i).Font;$item=@{}
        foreach($field in $fields){switch($field){
            'bold' {$item.bold=[int]$font.Bold}
            'italic' {$item.italic=[int]$font.Italic}
            'size' {$item.size=[double]$font.Size}
            default {throw 'WORD_FONT_FIELD'}
        }}
        if(($item.ContainsKey('bold') -and $item.bold -notin @(-1,0)) -or ($item.ContainsKey('italic') -and $item.italic -notin @(-1,0)) -or ($item.ContainsKey('size') -and ($item.size -lt 1 -or $item.size -gt 1638))){throw 'WORD_FONT_UNDEFINED'}
        $formats.Add($item)
    }
    return @{selection=$selection;text=[string]$range.Text;xml=$xml;contentHash=$hash;formats=$formats.ToArray();fields=@($fields);paragraphFields=@($paragraphFields);paragraphs=$paragraphs.ToArray()}
}
function Write-WordFormat($entry,$data){
    $paragraphFields=@($data.paragraphFields | Where-Object {$null -ne $_})
    if($entry.doc.ReadOnly -or $entry.doc.ProtectionType -ne -1 -or $entry.doc.TrackRevisions){return @{notIssued=$true;verified=$false;code='WORD_PROTECTED_OR_TRACKED'}}
    $before=Read-WordFormat $entry $data.selection $data.fields $paragraphFields
    if($before.contentHash -cne [string]$data.expectedFingerprint){return @{verified=$false;code='REVISION_CONFLICT';current=$before}}
    $range=$entry.doc.Range([int]$data.selection.start,[int]$data.selection.end)
    # Validate all paragraph restoration/property values before any font write.
    $paragraphValues=[Collections.Generic.List[object]]::new()
    if($paragraphFields.Count -gt 0){
        if($data.restoreParagraphFormats -and $data.restoreParagraphFormats.Count -ne $before.paragraphs.Count){throw 'WORD_RESTORE_SHAPE'}
        if($data.restoreParagraphFormats){
            if($data.expectedParagraphs.Count -ne $before.paragraphs.Count){throw 'WORD_RESTORE_SHAPE'}
            for($i=0;$i -lt $before.paragraphs.Count;$i++){
                $current=$before.paragraphs[$i];$saved=$data.restoreParagraphFormats[$i]
                if($current.contentHash -cne $data.expectedParagraphs[$i].contentHash){return @{verified=$false;code='REVISION_CONFLICT'}}
                if($saved.start -ne $current.start -or $saved.end -ne $current.end -or $saved.text -cne $current.text -or [string]::IsNullOrWhiteSpace($saved.xml) -or ([string]$saved.xml).Length -gt 1048576){throw 'WORD_RESTORE_SHAPE'}
            }
        }
        for($i=0;$i -lt $before.paragraphs.Count;$i++){
            $values=@{}
            foreach($field in $paragraphFields){
                $value=if($data.restoreParagraphFormats){$data.restoreParagraphFormats[$i].format.$field}else{Get-WordParagraphValue $field $data.paragraph.$field}
                if($null -eq $value){throw 'WORD_PARAGRAPH_VALUE'}
                Assert-WordParagraphValue $field $value;$values[$field]=$value
            }
            $paragraphValues.Add($values)
        }
    }
    if($data.restore){
        if($data.restore.Count -ne $before.formats.Count){throw 'WORD_RESTORE_SHAPE'}
        # Validate the entire restoration before issuing any write.
        foreach($item in $data.restore){foreach($field in $data.fields){
            if($field -in @('bold','italic') -and $item.$field -notin @(-1,0)){throw 'WORD_RESTORE_VALUE'}
            if($field -eq 'size' -and ([double]$item.size -lt 1 -or [double]$item.size -gt 1638)){throw 'WORD_RESTORE_VALUE'}
        }}
        for($i=1;$i -le $range.Characters.Count;$i++){
            $font=$range.Characters.Item($i).Font;$item=$data.restore[$i-1]
            foreach($field in $data.fields){switch($field){'bold'{$font.Bold=[int]$item.bold};'italic'{$font.Italic=[int]$item.italic};'size'{$font.Size=[double]$item.size}}}
        }
    }else{
        foreach($field in $data.fields){switch($field){'bold'{$range.Font.Bold=$(if($data.font.bold){-1}else{0})};'italic'{$range.Font.Italic=$(if($data.font.italic){-1}else{0})};'size'{$range.Font.Size=[double]$data.font.size}}}
    }
    for($i=$before.paragraphs.Count-1;$i -ge 0;$i--){
        $p=$entry.doc.Range([int]$before.paragraphs[$i].start,[int]$before.paragraphs[$i].end)
        if($data.restoreParagraphFormats){
            # Full paragraph snapshots also preserve inherited style semantics.
            $p.InsertXML([string]$data.restoreParagraphFormats[$i].xml)
        }else{
            foreach($field in $paragraphFields){$property=$script:wordParagraphProperties[[string]$field];$p.ParagraphFormat.$property=$paragraphValues[$i][$field]}
        }
    }
    $after=Read-WordFormat $entry $data.selection $data.fields $paragraphFields
    $verified=$after.text -ceq $before.text
    for($i=0;$i -lt $after.formats.Count;$i++){foreach($field in $data.fields){
        $wanted=if($data.restore){$data.restore[$i].$field}elseif($field -eq 'size'){[double]$data.font.size}elseif($data.font.$field){-1}else{0}
        if($after.formats[$i][$field] -ne $wanted){$verified=$false}
    }}
    if($after.paragraphs.Count -ne $before.paragraphs.Count){$verified=$false}
    for($i=0;$i -lt $after.paragraphs.Count;$i++){foreach($field in $paragraphFields){
        if([Math]::Abs([double]$after.paragraphs[$i].format[$field]-[double]$paragraphValues[$i][$field]) -gt 0.01){$verified=$false}
    }}
    if($data.restoreParagraphFormats){for($i=0;$i -lt $after.paragraphs.Count;$i++){
        if($after.paragraphs[$i].contentHash -cne $data.restoreParagraphFormats[$i].contentHash){$verified=$false}
    }}
    return @{before=$before;after=$after;verified=$verified;revision=$after.contentHash;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
