function Set-ExcelSavedColor($object,$profile){
    if($null -ne $profile.theme -and [int]$profile.theme -gt 0){$object.ThemeColor=[int]$profile.theme}
    elseif([int]$profile.colorIndex -lt 0){$object.ColorIndex=[int]$profile.colorIndex}
    else{$object.Color=[int]$profile.color}
    $object.TintAndShade=[double]$profile.tint
}
function Restore-ExcelRangeProfiles($entry,[string]$sheetName,$snapshot){
    $sheet=$entry.doc.Worksheets.Item($sheetName);$range=$sheet.Range([string]$snapshot.range);$index=0
    if($range.CountLarge -ne $snapshot.profiles.Count){throw 'EXCEL_PROFILE_RESTORE_SCOPE'}
    for($r=1;$r -le $range.Rows.Count;$r++){for($c=1;$c -le $range.Columns.Count;$c++){
        $cell=$range.Cells.Item($r,$c);$saved=$snapshot.profiles[$index];$index++;$style=$cell.Style;$styleName=if($style -is [string]){[string]$style}else{[string]$style.NameLocal}
        if($styleName -cne [string]$saved.style){$cell.Style=[string]$saved.style}
        $font=$cell.Font
        foreach($key in @('Name','Size','Bold','Italic','Underline','Strikethrough','Subscript','Superscript','ThemeFont')){
            $value=if($key -eq 'Name'){[string]$saved.font.$key}elseif($key -eq 'Size'){[double]$saved.font.$key}elseif($key -in @('Bold','Italic','Strikethrough','Subscript','Superscript')){[bool]$saved.font.$key}else{[int]$saved.font.$key}
            if($font.$key -cne $value){$font.$key=$value}
        }
        Set-ExcelSavedColor $font $saved.font.color
        $fill=$cell.Interior;Set-ExcelSavedColor $fill $saved.fill.color;$fill.PatternColorIndex=[int]$saved.fill.patternColorIndex;if([int]$saved.fill.patternColorIndex -ge 0){$fill.PatternColor=[int]$saved.fill.patternColor};$fill.Pattern=[int]$saved.fill.pattern
        foreach($savedBorder in $saved.borders){$border=$cell.Borders.Item([int]$savedBorder.index);Set-ExcelSavedColor $border $savedBorder.color;$border.Weight=[int]$savedBorder.weight;$border.LineStyle=[int]$savedBorder.line}
        foreach($key in @('NumberFormat','HorizontalAlignment','VerticalAlignment','WrapText','ShrinkToFit','Orientation','IndentLevel','ReadingOrder','Locked','FormulaHidden')){
            $value=if($key -eq 'NumberFormat'){[string]$saved.properties.$key}elseif($key -in @('WrapText','ShrinkToFit','Locked','FormulaHidden')){[bool]$saved.properties.$key}else{[int]$saved.properties.$key}
            if($cell.$key -cne $value){$cell.$key=$value}
        }
    }}
    # Table materialization/format restoration can recompute row heights. The
    # caller guarded these entire-row dimensions before removing the new table.
    for($r=1;$r -le $range.Rows.Count;$r++){if([Math]::Abs([double]$range.Rows.Item($r).RowHeight-[double]$snapshot.rowHeights[$r-1]) -gt 0.001){$range.Rows.Item($r).RowHeight=[double]$snapshot.rowHeights[$r-1]}}
}
