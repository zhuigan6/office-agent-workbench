function Get-WordCellContentRange($cell){
    $range=$cell.Range.Duplicate;$raw=[string]$range.Text
    if(-not $raw.EndsWith("`r"+[char]7)){throw 'WORD_CELL_MARK_REQUIRED'}
    # Word's one terminal range position emits the CR+cell-mark text pair.
    $range.End=$range.End-1
    if([string]$range.Text -cne $raw.Substring(0,$raw.Length-2)){throw 'WORD_CELL_BOUNDARY_UNSUPPORTED'}
    return $range
}
function Read-WordTableSnapshot($entry,$range){
    if($entry.kind -ne 'word' -or $range.Tables.Count -ne 1 -or $range.Cells.Count -ne 1){throw 'WORD_SINGLE_CELL_REQUIRED'}
    $table=$range.Tables.Item(1);$cell=$range.Cells.Item(1)
    if($table.NestingLevel -ne 1 -or -not $table.Uniform -or $table.Rows.Count -gt 20 -or $table.Columns.Count -gt 20){throw 'WORD_ORDINARY_TABLE_REQUIRED'}
    $content=Get-WordCellContentRange $cell
    if($range.Start -lt $content.Start -or $range.End -gt $content.End){throw 'WORD_CELL_CONTENT_ONLY'}
    $all=$table.Range;$xml=[string]$all.WordOpenXML
    if($all.Tables.Count -ne 1 -or $cell.Range.Paragraphs.Count -ne 1){throw 'WORD_SINGLE_PARAGRAPH_CELL_REQUIRED'}
    if($xml.Length -gt 1048576 -or $all.Fields.Count -gt 0 -or $all.ContentControls.Count -gt 0 -or $all.Revisions.Count -gt 0 -or $all.InlineShapes.Count -gt 0 -or $all.Hyperlinks.Count -gt 0){throw 'WORD_TABLE_SPECIAL_CONTENT'}
    if($xml -match '<w:(drawing|object|pict|fldChar|fldSimple|instrText|sdt|ins|del|moveFrom|moveTo|footnoteReference|endnoteReference|commentRangeStart|bookmarkStart|hyperlink|oMath|altChunk)\b'){throw 'WORD_TABLE_SPECIAL_CONTENT'}
    $null=Get-WordCellRestorePackage $xml ([int]$cell.RowIndex) ([int]$cell.ColumnIndex)
    $semantic=Get-WordSemanticXml $xml
    return @{start=[int]$all.Start;end=[int]$all.End;cellStart=[int]$content.Start;cellEnd=[int]$content.End;rows=[int]$table.Rows.Count;columns=[int]$table.Columns.Count;row=[int]$cell.RowIndex;column=[int]$cell.ColumnIndex;text=[string]$all.Text;xml=$xml;contentHash=(Hash-Text $semantic);revision=(Hash-Text ([string]$all.Start+'|'+[string]$entry.doc.Content.Text+'|'+$semantic))}
}
function Read-WordTableSelection($entry,$ref){
    $null=Assert-SelectionIdentity $entry $ref
    $table=$entry.doc.Tables.Item([int]$ref.tableIndex)
    if($table.Range.Start -ne $ref.tableStart -or $table.Rows.Count -ne $ref.rows -or $table.Columns.Count -ne $ref.columns){throw 'WORD_TABLE_REVISION_CONFLICT'}
    $snapshot=Read-WordTableSnapshot $entry (Get-WordCellContentRange $table.Cell(1,1))
    if($snapshot.revision -cne [string]$ref.revision){throw 'WORD_TABLE_REVISION_CONFLICT'}
    return @{kind='word';hostSessionId=$ref.hostSessionId;storyType=1;start=$snapshot.start;end=$snapshot.end;preview=$snapshot.text.Substring(0,[Math]::Min(4000,$snapshot.text.Length));contentHash=$snapshot.revision;table=$ref}
}
function Read-WordBatchCell($entry,$data){
    $ref=$data.reference;$null=Assert-SelectionIdentity $entry $ref
    $table=$entry.doc.Tables.Item([int]$ref.tableIndex)
    if($table.Range.Start -ne $ref.tableStart -or $table.Rows.Count -ne $ref.rows -or $table.Columns.Count -ne $ref.columns){throw 'WORD_TABLE_REVISION_CONFLICT'}
    $range=Get-WordCellContentRange $table.Cell([int]$data.row,[int]$data.column)
    if($range.End -le $range.Start -or $range.End-$range.Start -gt 2000){throw 'WORD_NONEMPTY_CELL_REQUIRED'}
    $tableState=Read-WordTableSnapshot $entry $range
    if($tableState.revision -cne [string]$ref.revision){throw 'WORD_TABLE_REVISION_CONFLICT'}
    $selection=@{kind='word';hostSessionId=$ref.hostSessionId;storyType=1;start=[int]$range.Start;end=[int]$range.End;preview=[string]$range.Text;contentHash='';cell=@{tableIndex=[int]$ref.tableIndex;row=[int]$data.row;column=[int]$data.column}}
    $snapshot=Read-WordReplacement $entry $selection;$selection.contentHash=$snapshot.contentHash
    return @{selection=$selection;snapshot=$snapshot}
}
function Get-WordCellRestorePackage([string]$xml,[int]$row,[int]$column){
    if($xml.Length -gt 1048576 -or $row -lt 1 -or $column -lt 1){throw 'WORD_TABLE_SNAPSHOT_LIMIT'}
    $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null;$settings.MaxCharactersInDocument=1048576
    $reader=[Xml.XmlReader]::Create([IO.StringReader]::new($xml),$settings)
    $doc=[Xml.XmlDocument]::new();$doc.PreserveWhitespace=$true;$doc.XmlResolver=$null
    try{$doc.Load($reader)}finally{$reader.Dispose()}
    $ns=[Xml.XmlNamespaceManager]::new($doc.NameTable);$ns.AddNamespace('pkg','http://schemas.microsoft.com/office/2006/xmlPackage');$ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
    $body=$doc.SelectSingleNode("/pkg:package/pkg:part[@pkg:name='/word/document.xml']/pkg:xmlData/w:document/w:body",$ns)
    $tables=@($body.SelectNodes('w:tbl',$ns));if($tables.Count -ne 1){throw 'WORD_TABLE_SNAPSHOT_SHAPE'}
    if($tables[0].SelectNodes('.//w:tbl',$ns).Count -ne 0){throw 'WORD_NESTED_TABLE_UNSUPPORTED'}
    $rows=@($tables[0].SelectNodes('w:tr',$ns));if($row -gt $rows.Count){throw 'WORD_CELL_SNAPSHOT_SHAPE'}
    $cells=@($rows[$row-1].SelectNodes('w:tc',$ns));if($column -gt $cells.Count){throw 'WORD_CELL_SNAPSHOT_SHAPE'}
    $paragraphs=@($cells[$column-1].SelectNodes('w:p',$ns));if($paragraphs.Count -ne 1 -or $cells[$column-1].SelectNodes('w:tbl',$ns).Count){throw 'WORD_CELL_SNAPSHOT_SHAPE'}
    $paragraph=$paragraphs[0].CloneNode($true);$body.RemoveAll();$null=$body.AppendChild($paragraph)
    return $doc.OuterXml
}
function Restore-WordTableSnapshot($entry,$current,$saved,[string]$expectedHash){
    if(-not $current -or $current.contentHash -cne $expectedHash -or $current.start -ne $saved.start -or $current.rows -ne $saved.rows -or $current.columns -ne $saved.columns){throw 'WORD_TABLE_REVISION_CONFLICT'}
    if([string]::IsNullOrWhiteSpace($saved.xml) -or ([string]$saved.xml).Length -gt 1048576){throw 'WORD_TABLE_SNAPSHOT_LIMIT'}
    if($current.row -ne $saved.row -or $current.column -ne $saved.column -or $current.cellStart -ne $saved.cellStart){throw 'WORD_CELL_REVISION_CONFLICT'}
    # Remove the table wrapper: InsertXML on a table range can nest it in cell1.
    $xml=Get-WordCellRestorePackage ([string]$saved.xml) ([int]$saved.row) ([int]$saved.column)
    $entry.doc.Range([int]$current.cellStart,[int]$current.cellEnd).InsertXML($xml)
    $cell=$entry.doc.Range([int]$current.cellStart,[int]$current.cellStart+1).Cells.Item(1)
    if($cell.Range.Paragraphs.Count -eq 2){
        $last=$cell.Range.Paragraphs.Item(2).Range
        if([string]$last.Text -cne ("`r"+[char]7)){throw 'WORD_CELL_RESTORE_EXTRA_CONTENT'}
        $separator=$entry.doc.Range([int]$last.Start-1,[int]$last.Start)
        if([string]$separator.Text -cne "`r"){throw 'WORD_CELL_RESTORE_BOUNDARY'}
        $null=$separator.Delete()
    }elseif($cell.Range.Paragraphs.Count -ne 1){throw 'WORD_CELL_RESTORE_PARAGRAPHS'}
}
function Read-WordTables($entry,$data){
    if($entry.kind -ne 'word'){throw 'HOST_KIND'}
    $start=[int]$data.start;$count=if($data.count){[int]$data.count}else{5}
    if($start -lt 0 -or $count -lt 1 -or $count -gt 10){throw 'TABLE_PAGE_LIMIT'}
    $items=[Collections.Generic.List[object]]::new();$bytes=0
    for($i=$start+1;$i -le [Math]::Min($entry.doc.Tables.Count,$start+$count);$i++){
        $table=$entry.doc.Tables.Item($i);$cells=[Collections.Generic.List[object]]::new()
        if($table.NestingLevel -ne 1 -or -not $table.Uniform -or $table.Range.Tables.Count -ne 1){$items.Add(@{tableIndex=$i;editable=$false;reason='Nonrectangular or nested table'});continue}
        $rows=[int]$table.Rows.Count;$columns=[int]$table.Columns.Count
        if($rows -gt 20 -or $columns -gt 20){$items.Add(@{tableIndex=$i;rows=$rows;columns=$columns;editable=$false;reason='Table exceeds20x20 live scope'});continue}
        $nested=$false
        for($r=1;$r -le $rows;$r++){for($c=1;$c -le $columns;$c++){
            $range=Get-WordCellContentRange $table.Cell($r,$c);$text=[string]$range.Text
            if($text.Contains([char]7)){$nested=$true}
            $preview=$text.Substring(0,[Math]::Min(200,$text.Length));$bytes+=$preview.Length
            if($bytes -gt 20000){throw 'TABLE_PAGE_TOO_LARGE'}
            $cells.Add(@{row=$r;column=$c;start=[int]$range.Start;end=[int]$range.End;preview=$preview})
        }}
        $reference=$null
        if(-not $nested -and $entry.doc.Windows.Count -eq 1){
            $xml=[string]$table.Range.WordOpenXML
            if($xml.Length -le 1048576){$reference=@{tableIndex=$i;tableStart=[int]$table.Range.Start;rows=$rows;columns=$columns;hostSessionId=$script:session+':'+(Get-OfficeWindowIdentity 'word' $entry.doc.Windows.Item(1));revision=(Hash-Text ([string]$table.Range.Start+'|'+[string]$entry.doc.Content.Text+'|'+(Get-WordSemanticXml $xml)))}}
        }
        $items.Add(@{tableIndex=$i;rows=$rows;columns=$columns;cells=$cells.ToArray();targetable=(-not $nested);reference=$reference})
    }
    return @{items=$items.ToArray();nextStart=$(if($start+$count -lt $entry.doc.Tables.Count){$start+$count}else{$null});instruction='Use target with tableIndex/row/column. Empty cells, merged/nested/structural editing require a separate workflow.'}
}
