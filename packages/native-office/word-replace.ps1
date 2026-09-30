function Read-WordReplacement($entry,$selection){
    if($entry.kind -ne 'word' -or [int]$selection.storyType -ne 1){throw 'WORD_BODY_REQUIRED'}
    $null=Assert-SelectionIdentity $entry $selection
    $start=[int]$selection.start;$end=[int]$selection.end
    if($start -lt 0 -or $end -lt $start -or $end-$start -gt 2000 -or $end -gt $entry.doc.Content.End){throw 'WORD_RANGE_LIMIT'}
    $range=$entry.doc.Range($start,$end);$text=[string]$range.Text;$xml=[string]$range.WordOpenXML
    if($xml.Length -gt 1048576 -or $text -match '[\x00-\x1f\u2028\u2029]'){throw 'WORD_STRUCTURAL_RANGE'}
    if($range.Tables.Count -gt 0 -or $range.Fields.Count -gt 0 -or $range.ContentControls.Count -gt 0 -or $range.Revisions.Count -gt 0 -or $range.InlineShapes.Count -gt 0 -or $range.Hyperlinks.Count -gt 0){throw 'WORD_SPECIAL_CONTENT'}
    if($xml -match '<w:(drawing|object|pict|fldChar|fldSimple|instrText|sdt|ins|del|moveFrom|moveTo|footnoteReference|endnoteReference|commentRangeStart|bookmarkStart|hyperlink|oMath|altChunk)\b'){throw 'WORD_SPECIAL_CONTENT'}
    $documentText=[string]$entry.doc.Content.Text
    if($documentText.Length -gt 1048576){throw 'WORD_DOCUMENT_LIMIT'}
    if($range.Paragraphs.Count -ne 1){throw 'WORD_SINGLE_PARAGRAPH_REQUIRED'}
    $paragraph=$range.Paragraphs.Item(1).Range
    $paragraphXml=[string]$paragraph.WordOpenXML
    if($paragraphXml.Length -gt 1048576){throw 'WORD_PARAGRAPH_LIMIT'}
    $paragraphState=@{start=[int]$paragraph.Start;end=[int]$paragraph.End;text=[string]$paragraph.Text;xml=$paragraphXml;contentHash=(Hash-Text (Get-WordSemanticXml $paragraphXml))}
    $hash=Hash-Text ([string]$range.Start+'|'+$range.End+'|'+$documentText+'|'+(Get-WordSemanticXml $xml))
    return @{selection=$selection;text=$text;xml=$xml;contentHash=$hash;documentHash=(Hash-Text $documentText);paragraph=$paragraphState}
}
function Write-WordReplacement($entry,$data){
    if($entry.doc.ReadOnly -or $entry.doc.ProtectionType -ne -1 -or $entry.doc.TrackRevisions){return @{notIssued=$true;verified=$false;code='WORD_PROTECTED_OR_TRACKED'}}
    $before=Read-WordReplacement $entry $data.selection
    if($before.contentHash -cne [string]$data.expectedFingerprint){return @{verified=$false;code='REVISION_CONFLICT'}}
    $beforeDocument=[string]$entry.doc.Content.Text
    $base=[int]$data.selection.start;$end=[int]$data.selection.end
    $text=[string]$data.text
    if($text.Length -gt 2000 -or $text -match '[\x00-\x1f\u2028\u2029]'){throw 'WORD_TEXT_LIMIT'}
    if($data.restoreParagraph){
        # Restore a complete paragraph including its mark, not partial package XML.
        # The whole paragraph must still match the verified post-edit snapshot.
        if($before.paragraph.contentHash -cne [string]$data.expectedParagraphHash -or $before.paragraph.start -ne $data.restoreParagraph.start){return @{verified=$false;code='REVISION_CONFLICT'}}
        if(([string]$data.restoreParagraph.xml).Length -gt 1048576){throw 'WORD_XML_LIMIT'}
        $entry.doc.Range([int]$before.paragraph.start,[int]$before.paragraph.end).InsertXML([string]$data.restoreParagraph.xml)
    }else{
        $planned=[string]$before.text;$previous=$planned.Length
        foreach($edit in $data.splices){
            $a=[int]$edit.start;$b=[int]$edit.end
            if($a -lt 0 -or $b -lt $a -or $b -gt $previous){throw 'WORD_SPLICE_ORDER'}
            $planned=$planned.Substring(0,$a)+[string]$edit.text+$planned.Substring($b);$previous=$a
        }
        if($planned -cne $text){throw 'WORD_SPLICE_RESULT'}
        foreach($edit in $data.splices){
            $a=$base+[int]$edit.start;$b=$base+[int]$edit.end
            $source=if($a -lt $end){$a}else{[Math]::Max($base,$a-1)}
            $font=$entry.doc.Range($source,$source+1).Font.Duplicate
            $entry.doc.Range($a,$b).Text=[string]$edit.text
            if(([string]$edit.text).Length -gt 0){$entry.doc.Range($a,$a+([string]$edit.text).Length).Font=$font}
        }
    }
    $target=@{kind='word';documentId=$data.selection.documentId;hostSessionId=$data.selection.hostSessionId;storyType=1;start=$base;end=$base+$text.Length;preview=$text;contentHash=''}
    $after=Read-WordReplacement $entry $target;$target.contentHash=$after.contentHash
    $expectedDocument=$beforeDocument.Substring(0,$base)+$text+$beforeDocument.Substring($end)
    $verified=$after.text -ceq $text -and $after.documentHash -ceq (Hash-Text $expectedDocument)
    if($data.restoreParagraph -and $after.paragraph.contentHash -cne [string]$data.restoreParagraph.contentHash){$verified=$false}
    return @{before=$before;after=$after;verified=$verified;revision=$after.contentHash;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
