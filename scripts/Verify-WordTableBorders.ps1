$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/fingerprint.ps1')
. (Join-Path $PSScriptRoot '../packages/native-office/word-table-layout.ps1')
. (Join-Path $PSScriptRoot '../packages/native-office/word-table-borders.ps1')
$profile=@{style=1;width=4;color=-16777216}
$table=@{};foreach($key in $script:wordBorderEdges.Keys){$table[$key]=$profile.Clone()}
$cells=@(for($r=1;$r -le 3;$r++){for($c=1;$c -le 2;$c++){@{row=$r;column=$c;edges=@(foreach($index in @(-1,-2,-3,-4,-7,-8)){@{index=$index;style=$(if($index -le -7){0}else{1});width=4;color=-16777216}})}}})
$before=@{table=$table;cells=$cells;rows=3;columns=2}
$data=ConvertFrom-Json '{"properties":{"borders":{"top":{"style":"double","width":1.5,"color":"#123456"},"insideHorizontal":{"style":"none"}}}}'
$plan=Get-WordBorderPlan $before $data
if($plan.wanted.top.color -ne 5649426 -or $plan.wanted.top.width -ne 12 -or $plan.wanted.top.style -ne 7){throw 'RGB_OR_LINE_MAPPING'}
$after=ConvertFrom-Json ($before|ConvertTo-Json -Depth 12)
foreach($key in $plan.keys){$after.table.$key=$plan.wanted[$key]}
foreach($cell in $after.cells){for($j=0;$j -lt $cell.edges.Count;$j++){foreach($key in $plan.keys){if(Test-WordBorderCellAffected $key $cell.row $cell.column $cell.edges[$j].index 3 2){$cell.edges[$j]=$plan.wanted[$key].Clone();$cell.edges[$j].index=$before.cells[($cell.row-1)*2+$cell.column-1].edges[$j].index;break}}}}
if(-not (Test-WordTableBorderPlan $after $before $plan)){throw 'BORDER_PLAN_VERIFY'}
$after.cells[0].edges[1].color=0
if(Test-WordTableBorderPlan $after $before $plan){throw 'UNREQUESTED_EDGE_IGNORED'}
$mixed=@{table=$table.Clone();rows=3;columns=2};$mixed.table.top=@{style=9999999;width=4;color=0}
$refused=$false;try{Get-WordBorderPlan $mixed $data|Out-Null}catch{$refused=$_.Exception.Message -eq 'WORD_MIXED_TABLE_BORDER_UNSUPPORTED'}
if(-not $refused){throw 'MIXED_AGGREGATE_NOT_REFUSED'}
$xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tr><w:tc><w:tcPr><w:tcBorders><w:top w:val="single"/></w:tcBorders><w:shd w:fill="FFFFFF"/></w:tcPr><w:p><w:r><w:t>Keep</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
$edited=$xml.Replace('single','double')
if((Get-WordLayoutContent $xml) -ceq (Get-WordLayoutContent $edited)){throw 'LEGACY_BORDER_PROOF_CHANGED'}
if((Get-WordLayoutContent $xml $false $true) -cne (Get-WordLayoutContent $edited $false $true)){throw 'EXPLICIT_BORDER_NORMALIZATION'}
foreach($changed in @($edited.Replace('Keep','Changed'),$edited.Replace('FFFFFF','FF0000'))){if((Get-WordLayoutContent $xml $false $true) -ceq (Get-WordLayoutContent $changed $false $true)){throw 'UNRELATED_BORDER_EDIT_IGNORED'}}
@{rgb=$true;edgeScope=$true;mixedRefused=$true;xmlScope=$true}|ConvertTo-Json -Compress
