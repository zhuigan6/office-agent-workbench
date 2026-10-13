$script:excelHorizontal=[ordered]@{general=1;left=-4131;center=-4108;right=-4152;justify=-4130}
$script:excelVertical=[ordered]@{top=-4160;center=-4108;bottom=-4107}
function Read-ExcelAppearanceColor($object){
    $theme=$null;try{$theme=[int]$object.ThemeColor}catch{}
    return [ordered]@{color=[int]$object.Color;index=[int]$object.ColorIndex;theme=$theme;tint=[double]$object.TintAndShade}
}
function Set-ExcelAppearanceColor($object,$profile){
    if($null -ne $profile.theme -and [int]$profile.theme -gt 0){$object.ThemeColor=[int]$profile.theme}
    elseif([int]$profile.index -lt 0){$object.ColorIndex=[int]$profile.index}
    else{$object.Color=[int]$profile.color}
    $object.TintAndShade=[double]$profile.tint
}
function Convert-ExcelAppearanceRgb([string]$value){
    if($value -notmatch '^#[0-9a-fA-F]{6}$'){throw 'EXCEL_FORMAT_COLOR'}
    return [Convert]::ToInt32($value.Substring(1,2),16)+256*[Convert]::ToInt32($value.Substring(3,2),16)+65536*[Convert]::ToInt32($value.Substring(5,2),16)
}
function Assert-ExcelAppearanceFont($font){
    foreach($key in @('Bold','Italic','Color','Size')){if($null -eq $font.$key -or $font.$key -is [DBNull]){throw 'EXCEL_FORMAT_COMPLEX_CELL'}}
}
function Read-ExcelRangeFormat($entry,$data){
    $ref=$data.reference;if($entry.kind -ne 'excel'){throw 'HOST_KIND'};$null=Assert-SelectionIdentity $entry $ref
    $sheet=$entry.doc.Worksheets.Item([string]$ref.sheet);$range=$sheet.Range([string]$ref.range)
    if($range.Areas.Count -ne 1 -or $range.CountLarge -gt 200 -or $range.MergeCells -ne $false -or $range.HasArray -ne $false -or $range.FormatConditions.Count -gt 0){throw 'EXCEL_FORMAT_RANGE_UNSUPPORTED'}
    $cells=[Collections.Generic.List[object]]::new();$heights=[Collections.Generic.List[object]]::new()
    for($r=1;$r -le $range.Rows.Count;$r++){
        if($range.Rows.Item($r).EntireRow.Hidden){throw 'EXCEL_FORMAT_HIDDEN'};$heights.Add([double]$range.Rows.Item($r).RowHeight)
        for($c=1;$c -le $range.Columns.Count;$c++){
            $cell=$range.Cells.Item($r,$c);$font=$cell.Font;$fill=$cell.Interior
            $null=Assert-ExcelAppearanceFont $font
            if($cell.EntireColumn.Hidden -or [int]$fill.Pattern -notin @(-4142,1)){throw 'EXCEL_FORMAT_COMPLEX_CELL'}
            $cells.Add([ordered]@{font=[ordered]@{bold=[bool]$font.Bold;italic=[bool]$font.Italic;color=(Read-ExcelAppearanceColor $font)};fill=[ordered]@{pattern=[int]$fill.Pattern;color=(Read-ExcelAppearanceColor $fill)};horizontal=[int]$cell.HorizontalAlignment;vertical=[int]$cell.VerticalAlignment;style=[string]$cell.Style;size=[double]$font.Size;wrap=[bool]$cell.WrapText})
        }
    }
    $state=Read-Range $entry @{sheet=$ref.sheet;range=$ref.range};$shape=[ordered]@{cells=$cells.ToArray();heights=$heights.ToArray();state=$state};$json=ConvertTo-Json -InputObject $shape -Depth 20 -Compress
    if($json.Length -gt 512000){throw 'EXCEL_FORMAT_SNAPSHOT_LIMIT'};$hash=Hash-Text $json
    return @{reference=@{sheet=[string]$sheet.Name;range=[string]$range.Address($false,$false);hostSessionId=$ref.hostSessionId;revision=$hash;dataRevision=$ref.dataRevision};cells=$cells.ToArray();heights=$heights.ToArray();rangeState=$state}
}
function Write-ExcelRangeFormat($entry,$data){
    if($entry.doc.ReadOnly){return @{verified=$false;notIssued=$true;code='READ_ONLY'}}
    $sheet=$entry.doc.Worksheets.Item([string]$data.reference.sheet)
    if($sheet.ProtectContents){return @{verified=$false;notIssued=$true;code='PROTECTED_RANGE'}}
    $before=Read-ExcelRangeFormat $entry $data
    if($before.reference.revision -cne [string]$data.reference.revision -or (ConvertTo-Json -InputObject $before -Depth 24 -Compress) -cne (ConvertTo-Json -InputObject $data.before -Depth 24 -Compress)){return @{verified=$false;notIssued=$true;code='REVISION_CONFLICT'}}
    $properties=$data.properties;$fields=@($properties.PSObject.Properties.Name)
    if($fields.Count -eq 0 -or @($fields|Where-Object {$_ -notin @('font','fill','horizontal','vertical')}).Count){throw 'EXCEL_FORMAT_PROPERTY'}
    if($properties.font){foreach($key in $properties.font.PSObject.Properties.Name){if($key -notin @('bold','italic','color')){throw 'EXCEL_FORMAT_FONT'};if($key -eq 'color'){$null=Convert-ExcelAppearanceRgb $properties.font.color}elseif($properties.font.$key -isnot [bool]){throw 'EXCEL_FORMAT_FLAG'}}}
    if($null -ne $properties.fill -and [string]$properties.fill -ne 'none'){$null=Convert-ExcelAppearanceRgb $properties.fill}
    foreach($key in @('horizontal','vertical')){if($null -ne $properties.$key){$map=if($key -eq 'horizontal'){$script:excelHorizontal}else{$script:excelVertical};if(-not $map.Contains([string]$properties.$key)){throw 'EXCEL_FORMAT_ALIGNMENT'}}}
    $range=$sheet.Range([string]$data.reference.range);$index=0
    for($r=1;$r -le $range.Rows.Count;$r++){for($c=1;$c -le $range.Columns.Count;$c++){
        $cell=$range.Cells.Item($r,$c);$old=if($data.restore){$data.restore.cells[$index]}else{$null};$index++
        if($properties.font){foreach($key in $properties.font.PSObject.Properties.Name){if($key -eq 'color'){if($old){Set-ExcelAppearanceColor $cell.Font $old.font.color}else{$cell.Font.Color=Convert-ExcelAppearanceRgb $properties.font.color;$cell.Font.TintAndShade=0}}else{$cell.Font.$key=$(if($old){[bool]$old.font.$key}else{[bool]$properties.font.$key})}}}
        if($null -ne $properties.fill){if($old){Set-ExcelAppearanceColor $cell.Interior $old.fill.color;$cell.Interior.Pattern=[int]$old.fill.pattern}elseif([string]$properties.fill -eq 'none'){$cell.Interior.Pattern=-4142}else{$cell.Interior.Pattern=1;$cell.Interior.Color=Convert-ExcelAppearanceRgb $properties.fill;$cell.Interior.TintAndShade=0}}
        if($null -ne $properties.horizontal){$cell.HorizontalAlignment=$(if($old){[int]$old.horizontal}else{[int]$script:excelHorizontal[[string]$properties.horizontal]})}
        if($null -ne $properties.vertical){$cell.VerticalAlignment=$(if($old){[int]$old.vertical}else{[int]$script:excelVertical[[string]$properties.vertical]})}
    }}
    $after=Read-ExcelRangeFormat $entry $data;$verified=(ConvertTo-Json -InputObject $after.rangeState -Depth 12 -Compress) -ceq (ConvertTo-Json -InputObject $before.rangeState -Depth 12 -Compress) -and (ConvertTo-Json -InputObject $after.heights -Compress) -ceq (ConvertTo-Json -InputObject $before.heights -Compress)
    for($i=0;$i -lt $after.cells.Count;$i++){
        $a=$after.cells[$i];$b=$before.cells[$i];$old=if($data.restore){$data.restore.cells[$i]}else{$null}
        foreach($key in @('style','size','wrap')){if($a.$key -cne $b.$key){$verified=$false}}
        foreach($key in @('bold','italic','color')){
            if($properties.font -and $null -ne $properties.font.$key){
                if($old){if((ConvertTo-Json -InputObject $a.font.$key -Compress) -cne (ConvertTo-Json -InputObject $old.font.$key -Compress)){$verified=$false}}
                elseif($key -eq 'color'){if($a.font.color.color -ne (Convert-ExcelAppearanceRgb $properties.font.color) -or $a.font.color.tint -ne 0){$verified=$false}}
                elseif($a.font.$key -ne $properties.font.$key){$verified=$false}
            }elseif((ConvertTo-Json -InputObject $a.font.$key -Compress) -cne (ConvertTo-Json -InputObject $b.font.$key -Compress)){$verified=$false}
        }
        if($null -ne $properties.fill){if($old){if((ConvertTo-Json -InputObject $a.fill -Depth 8 -Compress) -cne (ConvertTo-Json -InputObject $old.fill -Depth 8 -Compress)){$verified=$false}}elseif($properties.fill -eq 'none'){if($a.fill.pattern -ne -4142){$verified=$false}}elseif($a.fill.pattern -ne 1 -or $a.fill.color.color -ne (Convert-ExcelAppearanceRgb $properties.fill) -or $a.fill.color.tint -ne 0){$verified=$false}}
        elseif((ConvertTo-Json -InputObject $a.fill -Depth 8 -Compress) -cne (ConvertTo-Json -InputObject $b.fill -Depth 8 -Compress)){$verified=$false}
        foreach($key in @('horizontal','vertical')){$map=if($key -eq 'horizontal'){$script:excelHorizontal}else{$script:excelVertical};$wanted=if($null -eq $properties.$key){$b.$key}elseif($old){$old.$key}else{$map[[string]$properties.$key]};if($a.$key -ne $wanted){$verified=$false}}
    }
    return @{before=$before;after=$after;verified=$verified;revision=$after.reference.revision;code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
