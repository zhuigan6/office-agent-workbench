function Resolve-OfficeTarget($entry,$data){
    if($entry.kind -ne [string]$data.kind){throw 'HOST_KIND'}
    $windows=@(for($i=1;$i -le $entry.doc.Windows.Count;$i++){Get-OfficeWindowIdentity $entry.kind $entry.doc.Windows.Item($i)})
    if($data.windowId){if($windows -notcontains [string]$data.windowId){throw 'WINDOW_NOT_FOUND'};$windowId=[string]$data.windowId}
    elseif($windows.Count -eq 1){$windowId=$windows[0]}
    else{return @{status='ambiguous-window';windowIds=$windows}}
    $session=$script:session+':'+$windowId
    if($entry.kind -eq 'excel'){
        if($data.chartName){return @{status='resolved';selection=(Get-ExcelChartSelection $entry ([string]$data.sheet) ([string]$data.chartName) $session)}}
        $state=Read-Range $entry $data
        $json=ConvertTo-Json -InputObject $state -Depth 8 -Compress
        if($json.Length -gt 512000){throw 'TARGET_TOO_LARGE'}
        return @{status='resolved';selection=(Add-ExcelTableReference $entry @{kind='excel';hostSessionId=$session;sheet=$state.sheetName;range=$state.address;state=$state;preview=$json.Substring(0,[Math]::Min(4000,$json.Length));contentHash=(Hash-Text $json)})}
    }
    if($entry.kind -eq 'word'){
        if($data.tableIndex){
            $table=$entry.doc.Tables.Item([int]$data.tableIndex)
            if($table.NestingLevel -ne 1 -or -not $table.Uniform -or $table.Rows.Count -gt 20 -or $table.Columns.Count -gt 20){throw 'WORD_ORDINARY_TABLE_REQUIRED'}
            if($null -eq $data.row -and $null -eq $data.column){
                $snapshot=Read-WordTableSnapshot $entry (Get-WordCellContentRange $table.Cell(1,1))
                $ref=@{tableIndex=[int]$data.tableIndex;tableStart=$snapshot.start;rows=$snapshot.rows;columns=$snapshot.columns;hostSessionId=$session;revision=$snapshot.revision}
                return @{status='resolved';selection=(Read-WordTableSelection $entry $ref)}
            }
            $cell=$table.Cell([int]$data.row,[int]$data.column);$range=Get-WordCellContentRange $cell
            if($range.End -le $range.Start -or $range.End-$range.Start -gt 2000){throw 'WORD_NONEMPTY_CELL_REQUIRED'}
            $null=Read-WordTableSnapshot $entry $range;$xml=[string]$range.WordOpenXML
            $hash=Hash-Text ([string]$range.Start+'|'+$range.End+'|'+[string]$entry.doc.Content.Text+'|'+(Get-WordSemanticXml $xml))
            return @{status='resolved';selection=@{kind='word';hostSessionId=$session;storyType=1;start=[int]$range.Start;end=[int]$range.End;preview=[string]$range.Text;contentHash=$hash;cell=@{tableIndex=[int]$data.tableIndex;row=[int]$data.row;column=[int]$data.column}}}
        }
        $text=[string]$entry.doc.Content.Text;$needle=[string]$data.text
        if($text.Length -gt 1048576 -or $needle.Length -lt 1 -or $needle.Length -gt 2000){throw 'TARGET_TEXT_LIMIT'}
        $matches=[Collections.Generic.List[object]]::new();$offset=0
        while($offset -le $text.Length-$needle.Length){
            $found=$text.IndexOf($needle,$offset,[StringComparison]::Ordinal)
            if($found -lt 0){break}
            if($matches.Count -ge 20){return @{status='too-many-matches';candidates=$matches.ToArray();message='Narrow the text; match numbers are not accepted for truncated results.'}}
            $contextStart=[Math]::Max(0,$found-40)
            $matches.Add(@{match=$matches.Count+1;start=$found;end=$found+$needle.Length;preview=$text.Substring($contextStart,[Math]::Min(200,$text.Length-$contextStart))});$offset=$found+1
        }
        if($matches.Count -eq 0){return @{status='not-found';candidates=@()}}
        if($matches.Count -gt 1 -and -not $data.match){return @{status='ambiguous-text';candidates=$matches.ToArray()}}
        $index=if($data.match){[int]$data.match-1}else{0}
        if($index -lt 0 -or $index -ge $matches.Count){throw 'TARGET_MATCH_NOT_FOUND'}
        $range=$entry.doc.Range([int]$matches[$index].start,[int]$matches[$index].end)
        $xml=[string]$range.WordOpenXML
        if($xml.Length -gt 1048576){throw 'TARGET_XML_LIMIT'}
        $hash=Hash-Text ([string]$range.Start+'|'+$range.End+'|'+$text+'|'+(Get-WordSemanticXml $xml))
        return @{status='resolved';selection=@{kind='word';hostSessionId=$session;storyType=1;start=[int]$range.Start;end=[int]$range.End;preview=$needle;contentHash=$hash}}
    }
    $slide=if($data.slideId){$entry.doc.Slides.FindBySlideID([int]$data.slideId)}else{$entry.doc.Slides.Item([int]$data.slideIndex)}
    $selection=@{kind='powerpoint';hostSessionId=$session;slideId=[string]$slide.SlideID;shapeIds=@([string]$data.shapeId);preview='';contentHash=''}
    if($data.textStart){$selection.textStart=[int]$data.textStart;$selection.textLength=[int]$data.textLength}
    $shape=Resolve-PptShape $entry $selection
    if(-not $data.textStart){try{$null=Read-PptAppearance $shape;$selection.appearanceProfileVersion=1}catch{}}
    if($shape.HasTextFrame -ne 0 -and $shape.Type -in @(1,14,17)){try{$null=Read-PptTextFrame $shape;$selection.frameProfileVersion=1}catch{}}
    try{$selection.layoutRevision=(Read-PptLayout $entry $selection).contentHash}catch{if(-not $selection.appearanceProfileVersion){throw};$selection.Remove('appearanceProfileVersion');$selection.layoutRevision=(Read-PptLayout $entry $selection).contentHash}
    if($shape.HasTextFrame -ne 0 -and $shape.TextFrame.TextRange.Length -gt 0 -and $shape.TextFrame.TextRange.Length -le 2000){
        $state=Read-PptFormat $entry $selection;$selection.contentHash=$state.contentHash
        try{$selection.paragraphProfileVersion=1;$selection.replacementRevision=(Read-PptReplacement $entry $selection).contentHash}catch{
            $selection.Remove('paragraphProfileVersion')
            # This target can remain readable/formattable without replacement support.
        }
        $selection.preview=([string]$state.state.text).Substring([int]$state.state.start-1,[int]$state.state.length)
    }else{
        if($data.textStart){throw 'PPT_TEXT_REQUIRED'}
        $selection.contentHash=$selection.layoutRevision;$selection.preview=[string]$shape.Name
    }
    return @{status='resolved';selection=$selection}
}
