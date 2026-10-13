Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
function Read-ChartPartBytes($archive,[string]$name){
    $entry=$archive.GetEntry($name);if($null -eq $entry){throw ('EXCEL_CHART_PACKAGE_PART_MISSING: '+$name)};if($entry.Length -gt 4194304){throw 'EXCEL_CHART_PACKAGE_PART_LIMIT'}
    $stream=$entry.Open();$memory=[IO.MemoryStream]::new();try{$stream.CopyTo($memory);return ,$memory.ToArray()}finally{$memory.Dispose();$stream.Dispose()}
}
function Read-ChartPartXml($archive,[string]$name){
    $bytes=Read-ChartPartBytes $archive $name;$settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null;$settings.MaxCharactersInDocument=4194304
    $stream=[IO.MemoryStream]::new($bytes,$false);$reader=[Xml.XmlReader]::Create($stream,$settings);$xml=[Xml.XmlDocument]::new();$xml.PreserveWhitespace=$true;$xml.XmlResolver=$null
    try{$xml.Load($reader);return ,$xml}finally{$reader.Dispose();$stream.Dispose()}
}
function Resolve-ChartPart([string]$base,[string]$target){
    if(-not $target -or $target -match '^[a-z]+:|[\\\x00-\x1f]|[?#%]'){throw 'EXCEL_CHART_PACKAGE_RELATIONSHIP'}
    $parts=[Collections.Generic.List[string]]::new();$path=if($target.StartsWith('/')){$target.Substring(1)}else{$base.Substring(0,$base.LastIndexOf('/')+1)+$target}
    foreach($p in $path.Split('/')){if($p -eq '..'){if($parts.Count -eq 0){throw 'EXCEL_CHART_PACKAGE_RELATIONSHIP'};$parts.RemoveAt($parts.Count-1)}elseif($p -ne '.' -and $p -ne ''){$parts.Add($p)}}
    if($parts.Count -eq 0){throw 'EXCEL_CHART_PACKAGE_RELATIONSHIP'};return $parts.ToArray() -join '/'
}
function Get-ChartRelationshipsPath([string]$part){$slash=$part.LastIndexOf('/');return $part.Substring(0,$slash+1)+'_rels/'+$part.Substring($slash+1)+'.rels'}
function Resolve-ChartRelationship($archive,[string]$part,[string]$id){
    $rels=Read-ChartPartXml $archive (Get-ChartRelationshipsPath $part);$matches=@($rels.DocumentElement.ChildNodes|Where-Object {$_.LocalName -eq 'Relationship' -and $_.GetAttribute('Id') -ceq $id})
    if($matches.Count -ne 1 -or $matches[0].GetAttribute('TargetMode') -eq 'External'){throw 'EXCEL_CHART_PACKAGE_RELATIONSHIP'}
    return Resolve-ChartPart $part ($matches[0].GetAttribute('Target'))
}
function With-ExcelChartPackage($entry,$callback){
    if($entry.kind -ne 'excel' -or [int]$entry.doc.FileFormat -ne 51){throw 'EXCEL_CHART_XLSX_REQUIRED'}
    $root=[IO.Path]::GetFullPath($env:WORKBENCH_NATIVE_SNAPSHOTS).TrimEnd('\')+'\';if(-not (Test-Path -LiteralPath $root -PathType Container)){throw 'EXCEL_CHART_SNAPSHOT_ROOT'}
    $file=Join-Path $root ([Guid]::NewGuid().ToString()+'.xlsx');if(-not $file.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $file)){throw 'EXCEL_CHART_SNAPSHOT_PATH'}
    $archive=$null
    try{
        $null=$entry.doc.SaveCopyAs($file);if((Get-Item -LiteralPath $file).Length -gt 33554432){throw 'EXCEL_CHART_SNAPSHOT_LIMIT'}
        $archive=[IO.Compression.ZipFile]::OpenRead($file);if($archive.Entries.Count -gt 10000){throw 'EXCEL_CHART_SNAPSHOT_LIMIT'}
        $size=0;$names=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach($part in $archive.Entries){$size+=$part.Length;if($size -gt 134217728 -or $part.Length -gt 33554432 -or -not $names.Add($part.FullName) -or $part.FullName -match '(^/|\\|(^|/)\.\.(/|$)|:|vbaProject\.bin$)'){throw 'EXCEL_CHART_SNAPSHOT_LIMIT'}}
        return & $callback $archive
    }finally{if($null -ne $archive){$archive.Dispose()};if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force -ErrorAction Stop}}
}
function Test-ExcelChartPackage($entry){return With-ExcelChartPackage $entry {param($archive)$null=Read-ChartPartXml $archive 'xl/workbook.xml';return @{supported=$true}}}
function Read-ExcelChartPackageGuard($entry,$ref){
    $null=Read-ExcelChart $entry $ref
    return With-ExcelChartPackage $entry {param($archive)
        $book=Read-ChartPartXml $archive 'xl/workbook.xml';$sheets=@($book.SelectNodes('//*[local-name()="sheet"]')|Where-Object {$_.GetAttribute('name') -ceq [string]$ref.sheet});if($sheets.Count -ne 1){throw 'EXCEL_CHART_PACKAGE_SHEET'}
        $relNs='http://schemas.openxmlformats.org/officeDocument/2006/relationships';$sheetPart=Resolve-ChartRelationship $archive 'xl/workbook.xml' ($sheets[0].GetAttribute('id',$relNs));$sheet=Read-ChartPartXml $archive $sheetPart
        $drawings=@($sheet.SelectNodes('//*[local-name()="drawing"]'));if($drawings.Count -ne 1){throw 'EXCEL_CHART_PACKAGE_DRAWING'}
        $drawingPart=Resolve-ChartRelationship $archive $sheetPart ($drawings[0].GetAttribute('id',$relNs));$drawing=Read-ChartPartXml $archive $drawingPart
        $shapes=@($drawing.SelectNodes('//*[local-name()="cNvPr"]')|Where-Object {$_.GetAttribute('name') -ceq [string]$ref.name});if($shapes.Count -ne 1){throw 'EXCEL_CHART_PACKAGE_SHAPE'}
        $anchor=$shapes[0];while($null -ne $anchor.ParentNode -and $anchor.ParentNode -ne $drawing.DocumentElement){$anchor=$anchor.ParentNode}
        $charts=@($anchor.SelectNodes('.//*[local-name()="chart"]'));if($charts.Count -ne 1){throw 'EXCEL_CHART_PACKAGE_CHART'}
        $chartPart=Resolve-ChartRelationship $archive $drawingPart ($charts[0].GetAttribute('id',$relNs));$bookRels=Read-ChartPartXml $archive 'xl/_rels/workbook.xml.rels';$themes=@($bookRels.DocumentElement.ChildNodes|Where-Object {$_.LocalName -eq 'Relationship' -and $_.GetAttribute('Type').EndsWith('/theme')});if($themes.Count -ne 1){throw 'EXCEL_CHART_PACKAGE_THEME'}
        $themePart=Resolve-ChartRelationship $archive 'xl/workbook.xml' ($themes[0].GetAttribute('Id'));$queue=[Collections.Generic.Queue[string]]::new();$queue.Enqueue($chartPart);$queue.Enqueue($themePart);$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal);$parts=[Collections.Generic.List[string]]::new()
        $hasThemeOverride=$false
        while($queue.Count -gt 0){
            $part=$queue.Dequeue();if(-not $seen.Add($part)){continue};if($seen.Count -gt 64){throw 'EXCEL_CHART_PACKAGE_GRAPH_LIMIT'}
            $bytes=Read-ChartPartBytes $archive $part;$sha=[Security.Cryptography.SHA256]::Create();try{$hash=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()};$parts.Add($part+'|'+$hash)
            $relsPart=Get-ChartRelationshipsPath $part
            if($null -ne $archive.GetEntry($relsPart)){
                $rels=Read-ChartPartXml $archive $relsPart;$parts.Add($relsPart+'|'+(Hash-Text $rels.OuterXml))
                foreach($rel in $rels.DocumentElement.ChildNodes|Where-Object LocalName -eq 'Relationship'){if($rel.GetAttribute('TargetMode') -eq 'External'){throw 'EXCEL_CHART_EXTERNAL_RELATIONSHIP'};if($rel.GetAttribute('Type').EndsWith('/themeOverride')){$hasThemeOverride=$true};$queue.Enqueue((Resolve-ChartPart $part ($rel.GetAttribute('Target'))))}
            }
        }
        $entries=$parts.ToArray();[Array]::Sort($entries,[StringComparer]::Ordinal)
        $withoutTitle=Read-ChartPartXml $archive $chartPart
        foreach($node in @($withoutTitle.SelectNodes('//*[local-name()="chart"]/*[local-name()="title"]/*[local-name()="tx"]'))){$null=$node.ParentNode.RemoveChild($node)}
        Remove-ExcelChartDefaultColorMap $withoutTitle
        $neutral=@($entries|ForEach-Object {if($_.StartsWith($chartPart+'|',[StringComparison]::Ordinal)){$chartPart+'|'+(Hash-Text $withoutTitle.OuterXml)}else{$_}})
        return @{hash=(Hash-Text ($anchor.OuterXml+'|'+($entries -join '|')));withoutTitleTextHash=(Hash-Text ($anchor.OuterXml+'|'+($neutral -join '|')));chartPart=$chartPart;partCount=$seen.Count;hasThemeOverride=$hasThemeOverride}
    }
}
function Remove-ExcelChartDefaultColorMap($xml){
    $defaults=@{bg1='lt1';tx1='dk1';bg2='lt2';tx2='dk2';accent1='accent1';accent2='accent2';accent3='accent3';accent4='accent4';accent5='accent5';accent6='accent6';hlink='hlink';folHlink='folHlink'}
    foreach($node in @($xml.SelectNodes('/*[namespace-uri()="http://schemas.openxmlformats.org/drawingml/2006/chart" and local-name()="chartSpace"]/*[namespace-uri()="http://schemas.openxmlformats.org/drawingml/2006/chart" and local-name()="clrMapOvr"]'))){
        if($node.ChildNodes.Count -ne 0){continue};$attributes=@($node.Attributes|Where-Object NamespaceURI -NE 'http://www.w3.org/2000/xmlns/')
        if($attributes.Count -ne $defaults.Count){continue};$equal=$true
        foreach($key in $defaults.Keys){if($node.GetAttribute($key) -cne $defaults[$key]){$equal=$false}}
        if($equal){$null=$node.ParentNode.RemoveChild($node)}
    }
}
