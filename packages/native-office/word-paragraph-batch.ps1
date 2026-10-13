function Read-WordParagraphBatch($entry,$selection,[bool]$verifyReference=$false){
    if($selection.cell -or [int]$selection.end -le [int]$selection.start){throw 'WORD_BODY_PARAGRAPHS_REQUIRED'}
    if($entry.kind -ne 'word' -or [int]$selection.storyType -ne 1){throw 'WORD_BODY_REQUIRED'}
    $null=Assert-SelectionIdentity $entry $selection
    $range=$entry.doc.Range([int]$selection.start,[int]$selection.end)
    $text=[string]$entry.doc.Content.Text;if($text.Length -gt 1048576){throw 'WORD_DOCUMENT_LIMIT'}
    if($verifyReference){
        $xml=[string]$range.WordOpenXML;if($xml.Length -gt 1048576){throw 'WORD_RANGE_LIMIT'}
        $hash=Hash-Text ([string]$range.Start+'|'+$range.End+'|'+$text+'|'+(Get-WordSemanticXml $xml))
        if($hash -cne [string]$selection.contentHash){throw 'WORD_PARAGRAPH_REVISION_CONFLICT'}
    }
    if($range.Tables.Count -gt 0){throw 'WORD_BODY_PARAGRAPHS_REQUIRED'}
    # Reuse full-paragraph scope/special-content checks; no formatting is applied.
    $snapshot=Read-WordFormat $entry $selection @() @('alignment')
    $items=[Collections.Generic.List[object]]::new()
    foreach($p in $snapshot.paragraphs){
        $ref=@{kind='word';documentId=$selection.documentId;hostSessionId=$selection.hostSessionId;storyType=1;start=[int]$p.start;end=[int]$p.end-1;preview='';contentHash=''}
        $state=Read-WordReplacement $entry $ref;$ref.contentHash=$state.contentHash;$ref.preview=$state.text
        $items.Add(@{selection=$ref;text=$state.text;paragraphHash=$state.paragraph.contentHash})
    }
    $ref=@{kind='word';documentId=$selection.documentId;hostSessionId=$selection.hostSessionId;storyType=1;start=[int]$selection.start;end=[int]$selection.end;preview=$snapshot.text;contentHash=$snapshot.contentHash}
    return @{selection=$ref;contentHash=$snapshot.contentHash;documentHash=(Hash-Text $text);items=$items.ToArray()}
}
