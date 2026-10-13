. (Join-Path $PSScriptRoot 'word-readonly.ps1')
$script:wordTablePadding=@{topPadding='TopPadding';bottomPadding='BottomPadding';leftPadding='LeftPadding';rightPadding='RightPadding'}
function Get-WordLayoutContent([string]$xml,[bool]$widths=$false,[bool]$borders=$false){
    $doc=[Xml.XmlDocument]::new();$doc.PreserveWhitespace=$true;$doc.XmlResolver=$null;$doc.LoadXml((Get-WordSemanticXml $xml))
    $ns=[Xml.XmlNamespaceManager]::new($doc.NameTable);$ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
    $tables=@($doc.SelectNodes('//w:body/w:tbl',$ns));if($tables.Count -ne 1){throw 'WORD_ORDINARY_TABLE_REQUIRED'}
    $table=$tables[0]
    # Width declarations are excluded only for an explicitly requested width edit.
    foreach($node in @($table.SelectNodes('w:tblPr/w:jc|w:tblPr/w:tblCellMar/w:top|w:tblPr/w:tblCellMar/w:bottom|w:tblPr/w:tblCellMar/w:left|w:tblPr/w:tblCellMar/w:right|w:tr/w:trPr/w:cantSplit|w:tr/w:trPr/w:jc|w:tr/w:tblPrEx/w:jc|w:tr/w:tblPrEx/w:tblCellMar/w:top|w:tr/w:tblPrEx/w:tblCellMar/w:bottom|w:tr/w:tblPrEx/w:tblCellMar/w:left|w:tr/w:tblPrEx/w:tblCellMar/w:right',$ns))){$null=$node.ParentNode.RemoveChild($node)}
    foreach($node in @($table.SelectNodes('w:tblPr/w:tblCellMar|w:tr/w:tblPrEx/w:tblCellMar|w:tr/w:trPr',$ns))){if(-not $node.HasChildNodes -and $node.Attributes.Count -eq 0){$null=$node.ParentNode.RemoveChild($node)}}
    foreach($node in @($table.SelectNodes('w:tr/w:tblPrEx',$ns))){if(-not $node.HasChildNodes -and $node.Attributes.Count -eq 0){$null=$node.ParentNode.RemoveChild($node)}}
    if($widths){
        foreach($node in @($table.SelectNodes('w:tblPr/w:tblW|w:tblPr/w:tblLayout|w:tblGrid/w:gridCol|w:tr/w:tblPrEx/w:tblW|w:tr/w:tblPrEx/w:tblLayout|w:tr/w:tc/w:tcPr/w:tcW',$ns))){$null=$node.ParentNode.RemoveChild($node)}
        foreach($node in @($table.SelectNodes('w:tblGrid|w:tr/w:tblPrEx|w:tr/w:tc/w:tcPr',$ns))){if(-not $node.HasChildNodes -and $node.Attributes.Count -eq 0){$null=$node.ParentNode.RemoveChild($node)}}
    }
    if($borders){
        foreach($node in @($table.SelectNodes('w:tblPr/w:tblBorders|w:tr/w:tblPrEx/w:tblBorders|w:tr/w:tc/w:tcPr/w:tcBorders',$ns))){$null=$node.ParentNode.RemoveChild($node)}
        foreach($node in @($table.SelectNodes('w:tr/w:tblPrEx|w:tr/w:tc/w:tcPr',$ns))){if(-not $node.HasChildNodes -and $node.Attributes.Count -eq 0){$null=$node.ParentNode.RemoveChild($node)}}
    }
    return $doc.OuterXml
}
function Read-WordTableLayout($entry,$ref,[bool]$widths=$false,[bool]$borders=$false){
    if($entry.kind -ne 'word'){throw 'HOST_KIND'}
    $null=Assert-SelectionIdentity $entry $ref
    $table=$entry.doc.Tables.Item([int]$ref.tableIndex)
    if($table.Range.Start -ne $ref.tableStart -or $table.Rows.Count -ne $ref.rows -or $table.Columns.Count -ne $ref.columns){throw 'WORD_TABLE_REVISION_CONFLICT'}
    $range=Get-WordCellContentRange $table.Cell(1,1);$snapshot=Read-WordTableSnapshot $entry $range
    if($snapshot.revision -cne [string]$ref.revision){throw 'WORD_TABLE_REVISION_CONFLICT'}
    if($table.Rows.WrapAroundText -ne 0){throw 'WORD_FLOATING_TABLE_UNSUPPORTED'}
    # Cell-specific margins would hide the requested table defaults from view.
    $xml=[Xml.XmlDocument]::new();$xml.XmlResolver=$null;$xml.LoadXml($snapshot.xml)
    $ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
    if($xml.SelectNodes('//w:body/w:tbl/w:tr/w:tc/w:tcPr/w:tcMar|//w:body/w:tbl/w:tblPr/w:tblCellMar/w:start|//w:body/w:tbl/w:tblPr/w:tblCellMar/w:end',$ns).Count){throw 'WORD_CELL_MARGIN_OVERRIDE_UNSUPPORTED'}
    $alignment=[int]$table.Rows.Alignment;if($alignment -notin @(0,1,2)){throw 'WORD_TABLE_ALIGNMENT_UNDEFINED'}
    $properties=@{alignment=@('left','center','right')[$alignment]};$rowBreaks=[Collections.Generic.List[bool]]::new()
    foreach($field in $script:wordTablePadding.Keys){$p=$script:wordTablePadding[$field];$value=[double]$table.$p;if([double]::IsNaN($value) -or [double]::IsInfinity($value) -or $value -lt 0 -or $value -gt 72){throw 'WORD_TABLE_PADDING_LIMIT'};$properties[$field]=$value}
    for($r=1;$r -le $table.Rows.Count;$r++){for($c=1;$c -le $table.Columns.Count;$c++){
        $cell=$table.Cell($r,$c)
        foreach($field in $script:wordTablePadding.Keys){$p=$script:wordTablePadding[$field];if([Math]::Abs([double]$cell.$p-[double]$properties[$field]) -gt 0.03){throw 'WORD_ROW_MARGIN_OVERRIDE_UNSUPPORTED'}}
    }}
    for($i=1;$i -le $table.Rows.Count;$i++){$value=[int]$table.Rows.Item($i).AllowBreakAcrossPages;if($value -notin @(0,-1)){throw 'WORD_ROW_BREAK_UNDEFINED'};$rowBreaks.Add($value -ne 0)}
    $result=@{reference=$ref;properties=$properties;rowBreaks=$rowBreaks.ToArray();contentHash=$snapshot.contentHash;untouchedHash=(Hash-Text (Get-WordLayoutContent $snapshot.xml));text=$snapshot.text;documentText=[string]$entry.doc.Content.Text;xml=$snapshot.xml}
    if($widths){$result.widths=Read-WordTableWidths $table $snapshot.xml;$result.widthUntouchedHash=Hash-Text (Get-WordLayoutContent $snapshot.xml $true)}
    if($borders){$result.borders=Read-WordTableBorders $table}
    return $result
}
function Write-WordTableLayout($entry,$data){
    if((Get-WordWriteRestriction $entry.doc) -or $entry.doc.TrackRevisions){return @{notIssued=$true;verified=$false;code='WORD_PROTECTED_OR_TRACKED'}}
    $fields=if($data.restore){@($data.fields)}else{@($data.properties.PSObject.Properties.Name)}
    $widths=$fields -contains 'columnWidths'
    $borders=$fields -contains 'borders'
    try{$before=Read-WordTableLayout $entry $data.reference $widths $borders}catch{if($_.Exception.Message -match 'REVISION_CONFLICT'){return @{notIssued=$true;verified=$false;code='REVISION_CONFLICT'}};throw}
    if($fields.Count -lt 1 -or $fields.Count -gt 8){throw 'WORD_TABLE_PROPERTY_REQUIRED'}
    $table=$entry.doc.Tables.Item([int]$data.reference.tableIndex);$wantedWidths=$null
    $borderPlan=$null;if($borders){$borderPlan=Get-WordBorderPlan $before.borders $data}
    if($widths){
        $wantedWidths=if($data.restore){@($data.restore.widths.columns)}else{@($data.properties.columnWidths)}
        if($wantedWidths.Count -ne $before.widths.columns.Count){throw 'WORD_COLUMN_WIDTH_SHAPE'}
        $total=0;foreach($width in $wantedWidths){if($null -eq $width -or [double]::IsNaN([double]$width) -or [double]::IsInfinity([double]$width) -or [double]$width -lt 1 -or [double]$width -gt 1584){throw 'WORD_COLUMN_WIDTH_LIMIT'};$total+=[double]$width}
        if(-not $data.restore){
            $setup=$table.Range.Sections.Item(1).PageSetup
            if($table.Range.Sections.Count -ne 1 -or $setup.TextColumns.Count -ne 1){throw 'WORD_COLUMN_WIDTH_SECTION_UNSUPPORTED'}
            $available=[double]$setup.PageWidth-[double]$setup.LeftMargin-[double]$setup.RightMargin-[double]$setup.Gutter-[Math]::Max(0,[double]$table.Rows.LeftIndent)
            if($total -gt $available+0.1){throw 'WORD_COLUMN_WIDTH_EXCEEDS_PAGE'}
        }
    }
    $wanted=@{};foreach($key in $before.properties.Keys){$wanted[$key]=$before.properties[$key]};$breaks=@($before.rowBreaks)
    foreach($field in $fields){
        if($field -in @('columnWidths','borders')){continue}
        $value=if($data.restore){$data.restore.properties.$field}else{$data.properties.$field}
        if($field -eq 'alignment'){if($value -notin @('left','center','right')){throw 'WORD_TABLE_ALIGNMENT_VALUE'}}
        elseif($field -eq 'allowBreakAcrossPages'){
            if($data.restore){$breaks=@($data.restore.rowBreaks);if($breaks.Count -ne $before.rowBreaks.Count -or @($breaks | Where-Object {$_ -isnot [bool]}).Count){throw 'WORD_ROW_RESTORE_SHAPE'}}
            else{if($value -isnot [bool]){throw 'WORD_ROW_BREAK_VALUE'};$breaks=@(for($i=0;$i -lt $before.rowBreaks.Count;$i++){$value})};continue
        }else{if(-not $script:wordTablePadding.ContainsKey([string]$field) -or $null -eq $value -or [double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value) -or [double]$value -lt 0 -or [double]$value -gt 72){throw 'WORD_TABLE_PADDING_VALUE'}}
        $wanted[$field]=$value
    }
    $beforeProof=Hash-Text (Get-WordLayoutContent $before.xml $widths $borders)
    if($data.restore -and ((Hash-Text (Get-WordLayoutContent ([string]$data.restore.xml) $widths $borders)) -cne $beforeProof -or $data.restore.documentText -cne $before.documentText)){return @{notIssued=$true;verified=$false;code='REVISION_CONFLICT'}}
    foreach($field in $fields){
        if($field -in @('columnWidths','borders')){continue}
        if($field -eq 'alignment'){$alignment=[int](@{left=0;center=1;right=2}[$wanted.alignment]);if([int]$table.Rows.Alignment -ne $alignment){$table.Rows.Alignment=$alignment}}
        elseif($field -eq 'allowBreakAcrossPages'){for($i=1;$i -le $table.Rows.Count;$i++){$table.Rows.Item($i).AllowBreakAcrossPages=$(if($breaks[$i-1]){-1}else{0})}}
        else{$p=$script:wordTablePadding[$field];$table.$p=[double]$wanted[$field]}
    }
    if($borders){Set-WordTableBorderPlan $table $borderPlan $(if($data.restore){$data.restore.borders}else{$null})}
    # Finish geometry/preferred units/autofit AFTER other table-layout setters;
    # those setters can redistribute an already-restored automatic-width grid.
    if($widths){Set-WordTableWidths $table $wantedWidths $(if($data.restore){$data.restore.widths}else{$null}) ([string]$wanted.alignment)}
    $fresh=Read-WordTableSnapshot $entry (Get-WordCellContentRange $table.Cell(1,1));$ref=@{};foreach($key in @('tableIndex','tableStart','rows','columns','hostSessionId')){$ref[$key]=$data.reference.$key};$ref.revision=$fresh.revision
    $after=Read-WordTableLayout $entry $ref $widths $borders
    $verified=(Hash-Text (Get-WordLayoutContent $after.xml $widths $borders)) -ceq $beforeProof -and $after.documentText -ceq $before.documentText -and $after.text -ceq $before.text
    if($borders){$expected=if($data.restore){$data.restore.borders}else{$before.borders};if(-not (Test-WordTableBorderPlan $after.borders $expected $borderPlan ([bool]$data.restore))){$verified=$false}}
    if($widths){
        if($data.restore){if(-not (Test-WordTableWidthMatch $after.widths $data.restore.widths)){$verified=$false}}
        else{if($after.widths.allowAutoFit -or $after.widths.preferredType -ne 3 -or [Math]::Abs([double]$after.widths.preferred-$total) -gt 0.1){$verified=$false};for($c=0;$c -lt $wantedWidths.Count;$c++){if([Math]::Abs([double]$after.widths.columns[$c]-[double]$wantedWidths[$c]) -gt 0.1){$verified=$false}}}
    }
    foreach($key in $wanted.Keys){if($key -eq 'alignment'){if($after.properties[$key] -cne $wanted[$key]){$verified=$false}}elseif([Math]::Abs([double]$after.properties[$key]-[double]$wanted[$key]) -gt 0.03){$verified=$false}}
    for($i=0;$i -lt $breaks.Count;$i++){if($after.rowBreaks[$i] -ne $breaks[$i]){$verified=$false}}
    $normalized=$false;if($data.restore){$normalized=$after.contentHash -cne $data.restore.contentHash}
    return @{before=$before;after=$after;verified=$verified;revision=$after.reference.revision;layoutDeclarationsNormalized=$normalized;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
