# A builtin style can materialize unused style declarations in Word's package.
# Accept only additional nondefault, unreferenced declarations; every other byte
# of the semantic package, including existing styles, must still match.
function Test-WordStyleRestoration([string]$savedXml,[string]$currentXml){
    $saved=[Xml.XmlDocument]::new();$saved.PreserveWhitespace=$true;$saved.XmlResolver=$null
    $current=[Xml.XmlDocument]::new();$current.PreserveWhitespace=$true;$current.XmlResolver=$null
    $saved.LoadXml((Get-WordSemanticXml $savedXml));$current.LoadXml((Get-WordSemanticXml $currentXml))
    $w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    $before=@($saved.SelectNodes("//*[namespace-uri()='$w' and local-name()='styles']"))
    $after=@($current.SelectNodes("//*[namespace-uri()='$w' and local-name()='styles']"))
    if($before.Count -ne 1 -or $after.Count -ne 1){return @{equivalent=$false;added=@()}}
    $oldIds=@($before[0].ChildNodes | Where-Object {$_.NamespaceURI -eq $w -and $_.LocalName -eq 'style'} | ForEach-Object {$_.GetAttribute('styleId',$w)})
    $extra=@($after[0].ChildNodes | Where-Object {$_.NamespaceURI -eq $w -and $_.LocalName -eq 'style' -and $_.GetAttribute('styleId',$w) -notin $oldIds})
    $added=[Collections.Generic.List[string]]::new()
    foreach($style in $extra){
        $id=$style.GetAttribute('styleId',$w)
        if([string]::IsNullOrWhiteSpace($id) -or $style.GetAttribute('default',$w) -in @('1','true')){return @{equivalent=$false;added=@()}}
        $uses=@($current.SelectNodes("//*[namespace-uri()='$w' and (local-name()='pStyle' or local-name()='rStyle' or local-name()='tblStyle' or local-name()='basedOn' or local-name()='next' or local-name()='link')]") | Where-Object {$_.GetAttribute('val',$w) -ceq $id})
        foreach($use in $uses){
            $ancestor=$use.ParentNode
            while($ancestor -and $ancestor.LocalName -ne 'style'){$ancestor=$ancestor.ParentNode}
            if(-not $ancestor -or $ancestor.GetAttribute('styleId',$w) -in $oldIds){return @{equivalent=$false;added=@()}}
        }
        $added.Add($id)
    }
    foreach($style in $extra){[void]$style.ParentNode.RemoveChild($style)}
    return @{equivalent=($saved.OuterXml -ceq $current.OuterXml);added=$added.ToArray()}
}
