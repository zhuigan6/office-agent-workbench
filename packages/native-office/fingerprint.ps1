# Word regenerates rsid metadata when exporting a range; it is not document content.
function Get-WordSemanticXml([string]$xml){
    $document=[Xml.XmlDocument]::new()
    $document.PreserveWhitespace=$true
    $document.XmlResolver=$null
    $document.LoadXml($xml)
    $namespace='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    $attributes=@($document.SelectNodes("//@*[namespace-uri()='$namespace' and starts-with(local-name(),'rsid')]"))
    foreach($attribute in $attributes){[void]$attribute.OwnerElement.RemoveAttributeNode($attribute)}
    $histories=@($document.SelectNodes("//*[namespace-uri()='$namespace' and local-name()='rsids']"))
    foreach($history in $histories){[void]$history.ParentNode.RemoveChild($history)}
    return $document.OuterXml
}
