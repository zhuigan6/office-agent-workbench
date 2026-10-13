function Get-WordDeclaredTableWidth([string]$xml){
    $doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null;$doc.LoadXml($xml)
    $ns=[Xml.XmlNamespaceManager]::new($doc.NameTable);$ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
    $nodes=@($doc.SelectNodes('//w:body/w:tbl/w:tblPr/w:tblW',$ns));if($nodes.Count -gt 1){throw 'WORD_TABLE_WIDTH_DECLARATION_UNSUPPORTED'}
    if($nodes.Count -eq 0){return @{preferredType=1;preferred=0}}
    $type=$nodes[0].GetAttribute('type',$ns.LookupNamespace('w'));$number=$nodes[0].GetAttribute('w',$ns.LookupNamespace('w'))
    if($type -in @('auto','nil')){return @{preferredType=1;preferred=0}}
    if($type -notin @('dxa','pct') -or $number -notmatch '^\d+$'){throw 'WORD_TABLE_WIDTH_DECLARATION_UNSUPPORTED'}
    return @{preferredType=$(if($type -eq 'dxa'){3}else{2});preferred=([double]$number/$(if($type -eq 'dxa'){20}else{50}))}
}
function Read-WordTableWidths($table,[string]$xml){
    $columns=[Collections.Generic.List[double]]::new();$cells=[Collections.Generic.List[object]]::new()
    for($c=1;$c -le $table.Columns.Count;$c++){
        $width=[double]$table.Columns.Item($c).Width
        if([double]::IsNaN($width) -or [double]::IsInfinity($width) -or $width -lt 1 -or $width -gt 1584){throw 'WORD_COLUMN_WIDTH_UNDEFINED'}
        $columns.Add($width)
    }
    for($r=1;$r -le $table.Rows.Count;$r++){for($c=1;$c -le $table.Columns.Count;$c++){
        $cell=$table.Cell($r,$c);$type=[int]$cell.PreferredWidthType;$preferred=[double]$cell.PreferredWidth
        if($type -notin @(1,2,3) -or [double]::IsNaN($preferred) -or [double]::IsInfinity($preferred) -or ($type -ne 1 -and ($preferred -lt 0 -or $preferred -gt 1584)) -or [Math]::Abs([double]$cell.Width-$columns[$c-1]) -gt 0.1){throw 'WORD_CELL_WIDTH_PROFILE_UNSUPPORTED'}
        $cells.Add(@{row=$r;column=$c;preferredType=$type;preferred=$preferred})
    }}
    # Unequal columns can make the COM aggregate return wdUndefined even though
    # Word's own table-width declaration is a concrete point/percent value.
    $declared=Get-WordDeclaredTableWidth $xml;$type=[int]$declared.preferredType;$preferred=[double]$declared.preferred
    if($type -notin @(1,2,3) -or [double]::IsNaN($preferred) -or [double]::IsInfinity($preferred) -or ($type -ne 1 -and ($preferred -lt 0 -or $preferred -gt 1584))){throw 'WORD_TABLE_WIDTH_PROFILE_UNSUPPORTED'}
    return @{columns=$columns.ToArray();cells=$cells.ToArray();allowAutoFit=[bool]$table.AllowAutoFit;preferredType=$type;preferred=$preferred;nativePreferred=[double]$table.PreferredWidth}
}
function Set-WordTableWidths($table,$widths,$restore=$null,[string]$alignment='left'){
    # SetWidth's ruler behavior is defined for left alignment. Apply the final
    # requested/original alignment only after the entire width plan is set.
    if($alignment -notin @('left','center','right')){throw 'WORD_TABLE_ALIGNMENT_VALUE'}
    if([int]$table.Rows.Alignment -ne 0){$table.Rows.Alignment=[int]0}
    if($table.AllowAutoFit){$table.AllowAutoFit=$false}
    for($c=1;$c -le $table.Columns.Count;$c++){
        $column=$table.Columns.Item($c);$column.SetWidth([single]$widths[$c-1],[int]0)
        # Word resolves pending grid changes on width readback. Do not change
        # preferred units/autofit over an unobserved intermediate grid.
        if([Math]::Abs([double]$column.Width-[double]$widths[$c-1]) -gt 0.1){throw 'WORD_COLUMN_WRITE_READBACK_MISMATCH'}
    }
    # Even assigning the SAME alignment after restoring Auto units can convert
    # them back to points and redistribute the grid. Set alignment beforehand.
    $targetAlignment=[int](@{left=0;center=1;right=2}[$alignment])
    if([int]$table.Rows.Alignment -ne $targetAlignment){$table.Rows.Alignment=$targetAlignment}
    if($restore){
        foreach($saved in $restore.cells){$cell=$table.Cell([int]$saved.row,[int]$saved.column);$cell.PreferredWidthType=[int]$saved.preferredType;if([int]$cell.PreferredWidthType -ne [int]$saved.preferredType){throw 'WORD_CELL_WIDTH_UNIT_READBACK_MISMATCH'};if([int]$saved.preferredType -ne 1){$cell.PreferredWidth=[single]$saved.preferred}}
        $table.PreferredWidthType=[int]$restore.preferredType;if([int]$restore.preferredType -ne 1){$table.PreferredWidth=[single]$restore.preferred}
        if([int]$table.PreferredWidthType -ne [int]$restore.preferredType){throw 'WORD_TABLE_WIDTH_UNIT_READBACK_MISMATCH'}
        $table.AllowAutoFit=[bool]$restore.allowAutoFit
    }else{
        $total=0;foreach($width in $widths){$total+=[double]$width}
        $table.PreferredWidthType=[int]3;$table.PreferredWidth=[single]$total
    }
}
function Test-WordTableWidthMatch($actual,$expected){
    if($actual.columns.Count -ne $expected.columns.Count -or $actual.cells.Count -ne $expected.cells.Count -or $actual.allowAutoFit -ne $expected.allowAutoFit -or $actual.preferredType -ne $expected.preferredType){return $false}
    if([int]$expected.preferredType -ne 1 -and [Math]::Abs([double]$actual.preferred-[double]$expected.preferred) -gt 0.1){return $false}
    for($i=0;$i -lt $expected.columns.Count;$i++){if([Math]::Abs([double]$actual.columns[$i]-[double]$expected.columns[$i]) -gt 0.1){return $false}}
    for($i=0;$i -lt $expected.cells.Count;$i++){$a=$actual.cells[$i];$e=$expected.cells[$i];if($a.row -ne $e.row -or $a.column -ne $e.column -or $a.preferredType -ne $e.preferredType -or ([int]$e.preferredType -ne 1 -and [Math]::Abs([double]$a.preferred-[double]$e.preferred) -gt 0.1)){return $false}}
    return $true
}
