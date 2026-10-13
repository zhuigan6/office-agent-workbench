$script:wordBorderEdges=[ordered]@{top=-1;left=-2;bottom=-3;right=-4;insideHorizontal=-5;insideVertical=-6}
$script:wordBorderStyles=@{none=0;single=1;dotted=2;dashed=3;double=7}
function Read-WordBorder($border,[int]$index){return @{index=$index;style=[int]$border.LineStyle;width=[int]$border.LineWidth;color=[int]$border.Color}}
function Test-WordBorderProfile($profile){
    if([int]$profile.style -lt 0 -or [int]$profile.style -gt 24){return $false}
    if([int]$profile.style -eq 0){return $true}
    return [int]$profile.width -in @(2,4,6,8,12,18,24,36,48) -and ([int]$profile.color -eq -16777216 -or ([int]$profile.color -ge 0 -and [int]$profile.color -le 16777215))
}
function Test-WordBorderMatch($actual,$expected){
    if([int]$actual.style -ne [int]$expected.style){return $false}
    return [int]$expected.style -eq 0 -or ([int]$actual.width -eq [int]$expected.width -and [int]$actual.color -eq [int]$expected.color)
}
function Read-WordTableBorders($table){
    $outer=[ordered]@{};foreach($key in $script:wordBorderEdges.Keys){$index=[int]$script:wordBorderEdges[$key];$outer[$key]=Read-WordBorder ($table.Borders.Item($index)) $index}
    $cells=[Collections.Generic.List[object]]::new()
    for($r=1;$r -le $table.Rows.Count;$r++){for($c=1;$c -le $table.Columns.Count;$c++){
        $cell=$table.Cell($r,$c);$edges=[Collections.Generic.List[object]]::new()
        foreach($index in @(-1,-2,-3,-4,-7,-8)){$profile=Read-WordBorder ($cell.Borders.Item([int]$index)) ([int]$index);if(-not (Test-WordBorderProfile $profile)){throw 'WORD_CELL_BORDER_PROFILE_UNSUPPORTED'};$edges.Add($profile)}
        $cells.Add(@{row=$r;column=$c;edges=$edges.ToArray()})
    }}
    return @{table=$outer;cells=$cells.ToArray();rows=[int]$table.Rows.Count;columns=[int]$table.Columns.Count}
}
function Get-WordBorderPlan($before,$data){
    $keys=if($data.restore){@($data.borderFields)}else{@($data.properties.borders.PSObject.Properties.Name)}
    if($keys.Count -lt 1 -or $keys.Count -gt 6){throw 'WORD_BORDER_FIELDS_REQUIRED'}
    $wanted=[ordered]@{}
    foreach($key in $keys){
        if(-not $script:wordBorderEdges.Contains([string]$key) -or ($key -eq 'insideHorizontal' -and $before.rows -lt 2) -or ($key -eq 'insideVertical' -and $before.columns -lt 2)){throw 'WORD_BORDER_EDGE_UNAVAILABLE'}
        # A mixed aggregate has no concrete table default to restore via COM.
        if(-not (Test-WordBorderProfile $before.table.$key)){throw 'WORD_MIXED_TABLE_BORDER_UNSUPPORTED'}
        if($data.restore){$profile=$data.restore.borders.table.$key;if(-not (Test-WordBorderProfile $profile)){throw 'WORD_BORDER_RESTORE_PROFILE_UNSUPPORTED'};$wanted[$key]=$profile;continue}
        $value=$data.properties.borders.$key
        if(-not $script:wordBorderStyles.ContainsKey([string]$value.style)){throw 'WORD_BORDER_STYLE_UNSUPPORTED'}
        $style=[int]$script:wordBorderStyles[[string]$value.style];$width=0;$color=-16777216
        if($style -ne 0){
            if($null -eq $value.width -or [double]$value.width -notin @(0.25,0.5,0.75,1,1.5,2.25,3,4.5,6)){throw 'WORD_BORDER_WIDTH_UNSUPPORTED'};$width=[int]([double]$value.width*8)
            if([string]$value.color -ne 'auto'){
                if([string]$value.color -notmatch '^#[0-9A-Fa-f]{6}$'){throw 'WORD_BORDER_COLOR_UNSUPPORTED'}
                $hex=[string]$value.color;$color=[Convert]::ToInt32($hex.Substring(1,2),16)+([Convert]::ToInt32($hex.Substring(3,2),16)*256)+([Convert]::ToInt32($hex.Substring(5,2),16)*65536)
            }
        }
        $wanted[$key]=@{index=[int]$script:wordBorderEdges[$key];style=$style;width=$width;color=$color}
    }
    return @{keys=$keys;wanted=$wanted}
}
function Test-WordBorderCellAffected([string]$key,[int]$row,[int]$column,[int]$index,[int]$rows,[int]$columns){
    switch($key){
        'top' {return $index -eq -1 -and $row -eq 1}
        'bottom' {return $index -eq -3 -and $row -eq $rows}
        'left' {return $index -eq -2 -and $column -eq 1}
        'right' {return $index -eq -4 -and $column -eq $columns}
        'insideHorizontal' {return ($index -eq -3 -and $row -lt $rows) -or ($index -eq -1 -and $row -gt 1)}
        'insideVertical' {return ($index -eq -4 -and $column -lt $columns) -or ($index -eq -2 -and $column -gt 1)}
    }
    return $false
}
function Set-WordBorderProfile($border,$profile){
    $border.LineStyle=[int]$profile.style
    if([int]$profile.style -ne 0){$border.LineWidth=[int]$profile.width;$border.Color=[int]$profile.color}
}
function Set-WordTableBorderPlan($table,$plan,$restore=$null){
    foreach($key in $plan.keys){Set-WordBorderProfile ($table.Borders.Item([int]$script:wordBorderEdges[$key])) $plan.wanted[$key]}
    if($restore){
        foreach($cell in $restore.cells){foreach($edge in $cell.edges){
            $affected=$false;foreach($key in $plan.keys){if(Test-WordBorderCellAffected $key ([int]$cell.row) ([int]$cell.column) ([int]$edge.index) ([int]$restore.rows) ([int]$restore.columns)){$affected=$true;break}}
            if($affected){Set-WordBorderProfile ($table.Cell([int]$cell.row,[int]$cell.column).Borders.Item([int]$edge.index)) $edge}
        }}
    }
}
function Test-WordTableBorderPlan($after,$before,$plan,[bool]$restoring=$false){
    if($after.rows -ne $before.rows -or $after.columns -ne $before.columns -or $after.cells.Count -ne $before.cells.Count){return $false}
    foreach($key in $script:wordBorderEdges.Keys){
        $expected=$before.table.$key;if(-not $restoring -and $key -in $plan.keys){$expected=$plan.wanted[$key]}
        if(-not (Test-WordBorderMatch $after.table.$key $expected)){return $false}
    }
    for($i=0;$i -lt $before.cells.Count;$i++){
        $old=$before.cells[$i];$new=$after.cells[$i];if($new.row -ne $old.row -or $new.column -ne $old.column -or $new.edges.Count -ne $old.edges.Count){return $false}
        for($j=0;$j -lt $old.edges.Count;$j++){
            $expected=$old.edges[$j];if($new.edges[$j].index -ne $expected.index){return $false}
            if(-not $restoring){foreach($key in $plan.keys){if(Test-WordBorderCellAffected $key ([int]$old.row) ([int]$old.column) ([int]$expected.index) ([int]$before.rows) ([int]$before.columns)){$expected=$plan.wanted[$key];break}}}
            if(-not (Test-WordBorderMatch $new.edges[$j] $expected)){return $false}
        }
    }
    return $true
}
