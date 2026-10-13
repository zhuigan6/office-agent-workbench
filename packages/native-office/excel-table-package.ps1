function Test-ExcelPackageCellInRange([string]$cell,[string]$range){
    $m=[regex]::Match($range,'^([A-Z]+)(\d+):([A-Z]+)(\d+)$');$c=[regex]::Match($cell,'^([A-Z]+)(\d+)$');if(-not $m.Success -or -not $c.Success){throw 'EXCEL_TABLE_PACKAGE_EXCLUSION_RANGE'}
    $column={param([string]$s)$n=0;foreach($char in $s.ToCharArray()){$n=$n*26+[int]$char-65+1};return $n}
    $n=& $column $c.Groups[1].Value;return $n -ge (& $column $m.Groups[1].Value) -and $n -le (& $column $m.Groups[3].Value) -and [int]$c.Groups[2].Value -ge [int]$m.Groups[2].Value -and [int]$c.Groups[2].Value -le [int]$m.Groups[4].Value
}
function Read-ExcelTablePackage($entry,$ref,$exclude=$null){
    return With-ExcelChartPackage $entry {param($archive)
        $book=Read-ChartPartXml $archive 'xl/workbook.xml';$ns='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
        $formulaRecords=[Collections.Generic.List[string]]::new();$outsideRecords=[Collections.Generic.List[string]]::new();$sheets=@($book.SelectNodes('//*[local-name()="sheet"]'));if($sheets.Count -gt 200){throw 'EXCEL_TABLE_PACKAGE_SHEET_LIMIT'}
        $targetPart=$null
        foreach($sheet in $sheets){
            $part=Resolve-ChartRelationship $archive 'xl/workbook.xml' ($sheet.GetAttribute('id',$ns));$xml=Read-ChartPartXml $archive $part
            foreach($formula in $xml.SelectNodes('//*[local-name()="c"]/*[local-name()="f"]')){$address=$formula.ParentNode.GetAttribute('r');$record=$part+'|'+$address+'|'+$formula.OuterXml;$formulaRecords.Add($record);if(-not ($exclude -and $sheet.GetAttribute('name') -ceq [string]$exclude.sheet -and (Test-ExcelPackageCellInRange $address ([string]$exclude.range)))){$outsideRecords.Add($record)};if($formulaRecords.Count -gt 100000){throw 'EXCEL_TABLE_FORMULA_LIMIT'}}
            if($null -ne $ref -and $sheet.GetAttribute('name') -ceq [string]$ref.sheet){$targetPart=$part}
        }
        foreach($name in $book.SelectNodes('//*[local-name()="definedName"]')){$formulaRecords.Add('name|'+$name.OuterXml);$outsideRecords.Add('name|'+$name.OuterXml)}
        $records=$formulaRecords.ToArray();[Array]::Sort($records,[StringComparer]::Ordinal);$formulaHash=Hash-Text ($records -join '|');$guard=$null
        if($ref){
            if(-not $targetPart){throw 'EXCEL_TABLE_PACKAGE_SHEET'};$sheetXml=Read-ChartPartXml $archive $targetPart;$matches=[Collections.Generic.List[object]]::new()
            foreach($node in $sheetXml.SelectNodes('//*[local-name()="tablePart"]')){
                $part=Resolve-ChartRelationship $archive $targetPart ($node.GetAttribute('id',$ns));$table=Read-ChartPartXml $archive $part
                if($table.DocumentElement.GetAttribute('name') -ceq [string]$ref.name){$matches.Add(@{part=$part;xml=$table})}
            }
            if($matches.Count -ne 1 -or $matches[0].xml.DocumentElement.GetAttribute('ref') -cne [string]$ref.range){throw 'EXCEL_TABLE_PACKAGE_IDENTITY'}
            $rels=Read-ChartPartXml $archive 'xl/_rels/workbook.xml.rels';$themes=@($rels.DocumentElement.ChildNodes|Where-Object {$_.LocalName -eq 'Relationship' -and $_.GetAttribute('Type').EndsWith('/theme')});if($themes.Count -ne 1){throw 'EXCEL_TABLE_PACKAGE_THEME'}
            $theme=Read-ChartPartXml $archive (Resolve-ChartRelationship $archive 'xl/workbook.xml' ($themes[0].GetAttribute('Id')))
            $guard=@{hash=(Hash-Text ($matches[0].xml.OuterXml+'|'+$theme.OuterXml));tableId=$matches[0].xml.DocumentElement.GetAttribute('id');part=$matches[0].part}
        }
        $outside=$outsideRecords.ToArray();[Array]::Sort($outside,[StringComparer]::Ordinal)
        return @{formulaHash=$formulaHash;outsideFormulaHash=(Hash-Text ($outside -join '|'));formulaCount=$records.Length;table=$guard}
    }
}
