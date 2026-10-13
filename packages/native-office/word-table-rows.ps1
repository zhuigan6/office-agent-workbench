. (Join-Path $PSScriptRoot 'word-readonly.ps1')
function Get-WordRowsPrefixXml([string]$xml,[int]$count){
    $doc=[Xml.XmlDocument]::new();$doc.PreserveWhitespace=$true;$doc.XmlResolver=$null;$doc.LoadXml((Get-WordSemanticXml $xml))
    $ns=[Xml.XmlNamespaceManager]::new($doc.NameTable);$ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
    $tables=@($doc.SelectNodes('//w:body/w:tbl',$ns));if($tables.Count -ne 1){throw 'WORD_ORDINARY_TABLE_REQUIRED'}
    $rows=@($tables[0].SelectNodes('w:tr',$ns));if($count -lt 1 -or $count -gt $rows.Count){throw 'WORD_ROW_RESTORE_SHAPE'}
    for($i=$rows.Count-1;$i -ge $count;$i--){$null=$tables[0].RemoveChild($rows[$i])}
    return $doc.OuterXml
}
function Write-WordTableRows($entry,$data){
    if((Get-WordWriteRestriction $entry.doc) -or $entry.doc.TrackRevisions){return @{notIssued=$true;verified=$false;code='WORD_PROTECTED_OR_TRACKED'}}
    try{$before=Read-WordTableLayout $entry $data.reference}catch{if($_.Exception.Message -match 'REVISION_CONFLICT'){return @{verified=$false;code='REVISION_CONFLICT'}};throw}
    $table=$entry.doc.Tables.Item([int]$data.reference.tableIndex);$oldCount=[int]$table.Rows.Count
    $prefix=[string]$entry.doc.Range(0,[int]$table.Range.Start).Text;$suffix=[string]$entry.doc.Range([int]$table.Range.End,[int]$entry.doc.Content.End).Text
    if($data.restore){
        $count=[int]$data.restore.reference.rows
        if($count -lt 1 -or $count -ge $oldCount -or $oldCount-$count -gt 10 -or $data.restore.reference.columns -ne $data.reference.columns -or $data.restore.reference.tableStart -ne $data.reference.tableStart){throw 'WORD_ROW_RESTORE_SHAPE'}
        if((Get-WordRowsPrefixXml $before.xml $count) -cne (Get-WordSemanticXml ([string]$data.restore.xml))){return @{verified=$false;code='REVISION_CONFLICT'}}
        for($i=$oldCount;$i -gt $count;$i--){$table.Rows.Item($i).Delete()}
        $expectedText=[string]$data.restore.documentText
    }else{
        $rows=@($data.append);$characters=0
        if($rows.Count -lt 1 -or $rows.Count -gt 10 -or $oldCount+$rows.Count -gt 20){throw 'WORD_ROW_LIMIT'}
        foreach($row in $rows){if($row.Count -ne $table.Columns.Count){throw 'WORD_COLUMN_COUNT'};foreach($text in $row){if($text -isnot [string] -or $text.Length -gt 2000 -or $text -match '[\x00-\x1f\u2028\u2029]'){throw 'WORD_CELL_TEXT_LIMIT'};$characters+=$text.Length}}
        if($characters -gt 20000){throw 'WORD_ROW_TEXT_LIMIT'}
        $addedText=''
        foreach($values in $rows){
            $newRow=$table.Rows.Add()
            for($c=1;$c -le $table.Columns.Count;$c++){$range=Get-WordCellContentRange $newRow.Cells.Item($c);$range.Text=[string]$values[$c-1];$addedText+=[string]$values[$c-1]+"`r"+[char]7}
            $addedText+="`r"+[char]7
        }
        $expectedText=$prefix+[string]$before.text+$addedText+$suffix
    }
    $snapshot=Read-WordTableSnapshot $entry (Get-WordCellContentRange $table.Cell(1,1))
    $ref=@{tableIndex=$data.reference.tableIndex;tableStart=[int]$table.Range.Start;rows=[int]$table.Rows.Count;columns=[int]$table.Columns.Count;hostSessionId=$data.reference.hostSessionId;revision=$snapshot.revision}
    $after=Read-WordTableLayout $entry $ref
    $verified=$after.documentText -ceq $expectedText
    if($data.restore){if($after.contentHash -cne [string]$data.restore.contentHash){$verified=$false}}
    elseif((Get-WordRowsPrefixXml $after.xml $oldCount) -cne (Get-WordSemanticXml $before.xml)){$verified=$false}
    return @{before=$before;after=$after;verified=$verified;revision=$after.reference.revision;atomic=$false;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
