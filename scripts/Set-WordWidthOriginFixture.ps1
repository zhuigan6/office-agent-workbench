param([Parameter(Mandatory=$true)][string]$BeforePath,[ValidateSet('PercentAutofit','AutoUnits')][string]$Mode='PercentAutofit')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent;$verification=[IO.Path]::GetFullPath((Join-Path $root '.local/verification'))
$source=[IO.Path]::GetFullPath($BeforePath);$parent=Split-Path $source -Parent
if((Split-Path $parent -Parent) -ine $verification -or (Split-Path $parent -Leaf) -notmatch '^word-table-width-origins-\d+$' -or (Split-Path $source -Leaf) -cne 'baseline.json'){throw 'EXACT_PRIVATE_BASELINE_REQUIRED'}
if((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'LINKED_BASELINE_REFUSED'}
$baseline=Get-Content -LiteralPath $source -Raw|ConvertFrom-Json
$file=[IO.Path]::GetFullPath((Join-Path $root '.local/host-fixtures/word-table-1790923966234/native-word-table-test.docx'))
. (Join-Path $root 'packages/native-office/fingerprint.ps1')
. (Join-Path $root 'packages/native-office/word-table-layout.ps1')
. (Join-Path $root 'packages/native-office/word-table-widths.ps1')
function Hash-Text([string]$value){$sha=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
$app=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application');$doc=$null
for($i=1;$i -le $app.Documents.Count;$i++){if([string]$app.Documents.Item($i).FullName -ieq $file){$doc=$app.Documents.Item($i);break}}
if($null -eq $doc -or $doc.ReadOnly -or $doc.Windows.Count -ne 1 -or $doc.Tables.Count -ne 1 -or $doc.ProtectionType -ne -1 -or $doc.TrackRevisions){throw 'DEDICATED_WRITABLE_TABLE_REQUIRED'}
$table=$doc.Tables.Item(1);$xml=[string]$table.Range.WordOpenXML
if($table.Rows.Count -ne 3 -or $table.Columns.Count -ne 2 -or [string]$doc.Content.Text -cne [string]$baseline.documentText -or (Hash-Text (Get-WordLayoutContent $xml $true)) -cne [string]$baseline.widthUntouchedHash -or -not (Test-WordTableWidthMatch (Read-WordTableWidths $table $xml) $baseline.widths)){throw 'BASELINE_CHANGED_BEFORE_SEED'}
if($Mode -eq 'AutoUnits'){
    $table.PreferredWidthType=[int]1
    for($r=1;$r -le 3;$r++){for($c=1;$c -le 2;$c++){$table.Cell($r,$c).PreferredWidthType=[int]1}}
}else{
    $table.PreferredWidthType=[int]2;$table.PreferredWidth=[single]100
    for($r=1;$r -le 3;$r++){for($c=1;$c -le 2;$c++){$cell=$table.Cell($r,$c);$cell.PreferredWidthType=[int]2;$cell.PreferredWidth=[single]50}}
}
$table.AllowAutoFit=$true;$doc.Repaginate()
@{Mode=$Mode;RequestedPercent=$(if($Mode -eq 'PercentAutofit'){100}else{$null});AutoFit=$true;SaveIssued=$false}|ConvertTo-Json -Compress
