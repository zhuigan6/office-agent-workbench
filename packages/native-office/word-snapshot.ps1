function Export-WordFlatPackage([string]$xml,[string]$destination){
    if($xml.Length -gt 67108864){throw 'WORD_SNAPSHOT_XML_LIMIT'}
    $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null;$settings.MaxCharactersInDocument=67108864
    $reader=[Xml.XmlReader]::Create([IO.StringReader]::new($xml),$settings)
    $document=[Xml.XmlDocument]::new();$document.PreserveWhitespace=$true;$document.XmlResolver=$null
    try{$document.Load($reader)}finally{$reader.Dispose()}
    $ns='http://schemas.microsoft.com/office/2006/xmlPackage'
    if($document.DocumentElement.LocalName -ne 'package' -or $document.DocumentElement.NamespaceURI -ne $ns){throw 'WORD_FLAT_PACKAGE_REQUIRED'}
    $parts=@($document.DocumentElement.ChildNodes | Where-Object {$_.NodeType -eq [Xml.XmlNodeType]::Element})
    if($parts.Count -lt 1 -or $parts.Count -gt 4096){throw 'WORD_SNAPSHOT_PART_LIMIT'}
    $entries=[Collections.Generic.List[object]]::new();$names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase);$size=0
    $contentTypes=[Xml.XmlDocument]::new();$types=$contentTypes.CreateElement('Types','http://schemas.openxmlformats.org/package/2006/content-types');[void]$contentTypes.AppendChild($types)
    foreach($part in $parts){
        if($part.LocalName -ne 'part' -or $part.NamespaceURI -ne $ns){throw 'WORD_INVALID_PART'}
        $name=$part.GetAttribute('name',$ns);$type=$part.GetAttribute('contentType',$ns)
        if(-not $name.StartsWith('/') -or $name.Contains('\') -or $name.Contains(':') -or $name -match '[\x00-\x1f]|(?i)%2e|%2f|%5c'){throw 'WORD_INVALID_PART_PATH'}
        $entryName=$name.Substring(1)
        if($entryName.Split('/') -contains '..' -or $entryName.Split('/') -contains '.' -or $entryName.Split('/') -contains '' -or -not $names.Add($entryName) -or $entryName -eq '[Content_Types].xml' -or -not $type){throw 'WORD_INVALID_PART_PATH'}
        $xmlData=@($part.ChildNodes | Where-Object {$_.LocalName -eq 'xmlData' -and $_.NamespaceURI -eq $ns})
        $binary=@($part.ChildNodes | Where-Object {$_.LocalName -eq 'binaryData' -and $_.NamespaceURI -eq $ns})
        if($xmlData.Count -eq 1 -and $binary.Count -eq 0){
            $roots=@($xmlData[0].ChildNodes | Where-Object {$_.NodeType -eq [Xml.XmlNodeType]::Element})
            if($roots.Count -ne 1){throw 'WORD_INVALID_XML_PART'}
            $bytes=[Text.UTF8Encoding]::new($false).GetBytes($roots[0].OuterXml)
        }elseif($binary.Count -eq 1 -and $xmlData.Count -eq 0){$bytes=[Convert]::FromBase64String($binary[0].InnerText)}else{throw 'WORD_INVALID_PART_DATA'}
        $size+=$bytes.Length;if($size -gt 67108864){throw 'WORD_SNAPSHOT_EXPANDED_LIMIT'}
        $entries.Add(@{name=$entryName;bytes=$bytes})
        $override=$contentTypes.CreateElement('Override',$types.NamespaceURI);$override.SetAttribute('PartName',$name);$override.SetAttribute('ContentType',$type);[void]$types.AppendChild($override)
    }
    if(-not $names.Contains('word/document.xml') -or -not $names.Contains('_rels/.rels')){throw 'WORD_DOCUMENT_PARTS_MISSING'}
    $entries.Add(@{name='[Content_Types].xml';bytes=[Text.UTF8Encoding]::new($false).GetBytes($contentTypes.OuterXml)})
    Add-Type -AssemblyName System.IO.Compression
    $stream=[IO.File]::Open($destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $archive=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$false)
    try{foreach($entry in $entries){$output=$archive.CreateEntry($entry.name,[IO.Compression.CompressionLevel]::Optimal).Open();try{$output.Write($entry.bytes,0,$entry.bytes.Length)}finally{$output.Dispose()}}}finally{$archive.Dispose();$stream.Dispose()}
    return @{parts=$entries.Count;expandedBytes=$size}
}
