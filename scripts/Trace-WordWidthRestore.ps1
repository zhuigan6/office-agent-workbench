param([Parameter(Mandatory=$true)][string]$BaselinePath)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent;$verification=[IO.Path]::GetFullPath((Join-Path $root '.local/verification'));$source=[IO.Path]::GetFullPath($BaselinePath)
if((Split-Path (Split-Path $source -Parent) -Parent) -ine $verification -or (Split-Path (Split-Path $source -Parent) -Leaf) -notmatch '^word-table-width-origins-\d+$' -or (Split-Path $source -Leaf) -cne 'baseline.json'){throw 'EXACT_PRIVATE_BASELINE_REQUIRED'}
$baseline=Get-Content -LiteralPath $source -Raw|ConvertFrom-Json
. (Join-Path $root 'packages/native-office/fingerprint.ps1')
. (Join-Path $root 'packages/native-office/word-table-layout.ps1')
. (Join-Path $root 'packages/native-office/word-table-widths.ps1')
function Hash-Text([string]$value){$sha=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
$file=[IO.Path]::GetFullPath((Join-Path $root '.local/host-fixtures/word-table-1790923966234/native-word-table-test.docx'))
$app=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application');$doc=$null
for($i=1;$i -le $app.Documents.Count;$i++){if([string]$app.Documents.Item($i).FullName -ieq $file){$doc=$app.Documents.Item($i);break}}
if($null -eq $doc -or $doc.ReadOnly -or $doc.Windows.Count -ne 1 -or $doc.Tables.Count -ne 1 -or $doc.ProtectionType -ne -1 -or $doc.TrackRevisions){throw 'DEDICATED_TABLE_REQUIRED'}
$table=$doc.Tables.Item(1);$xml=[string]$table.Range.WordOpenXML
if($table.Rows.Count -ne 3 -or $table.Columns.Count -ne 2 -or [string]$doc.Content.Text -cne [string]$baseline.documentText -or (Hash-Text (Get-WordLayoutContent $xml $true)) -cne [string]$baseline.widthUntouchedHash -or -not (Test-WordTableWidthMatch (Read-WordTableWidths $table $xml) $baseline.widths)){throw 'BASELINE_CHANGED'}
$directory=Join-Path $verification ('word-width-trace-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds());$null=New-Item -ItemType Directory -Path $directory
$steps=[Collections.Generic.List[object]]::new();$report=@{saveIssued=$false;baseline=$source;steps=$steps}
function Observe([string]$label){
    $widths=@(for($c=1;$c -le 2;$c++){[double]$table.Columns.Item($c).Width})
    $cells=@(for($r=1;$r -le 3;$r++){for($c=1;$c -le 2;$c++){$cell=$table.Cell($r,$c);@{row=$r;column=$c;type=[int]$cell.PreferredWidthType;preferred=[double]$cell.PreferredWidth}}})
    $steps.Add(@{label=$label;columns=$widths;tableType=[int]$table.PreferredWidthType;tablePreferred=[double]$table.PreferredWidth;autoFit=[bool]$table.AllowAutoFit;alignment=[int]$table.Rows.Alignment;cells=$cells})
}
function AutoCellUnits(){for($r=1;$r -le 3;$r++){for($c=1;$c -le 2;$c++){$table.Cell($r,$c).PreferredWidthType=[int]1}}}
try{
    $table.PreferredWidthType=[int]1;AutoCellUnits;$table.AllowAutoFit=$true;$doc.Repaginate();Observe 'seed-auto'
    Set-WordTableWidths $table @(240,120) $null 'center';Observe 'edited-fixed'
    $table.Rows.Alignment=[int]0;$table.AllowAutoFit=$false;Observe 'restore-disable-auto'
    $table.Columns.Item(1).SetWidth([single]225,[int]0);Observe 'restore-col1'
    $table.Columns.Item(2).SetWidth([single]225,[int]0);Observe 'restore-col2'
    AutoCellUnits;Observe 'restore-auto-cell-units'
    $table.PreferredWidthType=[int]1;Observe 'restore-auto-table-units'
    $table.AllowAutoFit=$true;Observe 'restore-enable-auto-last'
    $table.Rows.Alignment=[int]0;Observe 'repeat-unchanged-alignment-after-auto'
    # Discriminating alternate order, observed separately rather than replaying a
    # failed business operation or relabelling its recovery journal.
    $table.AllowAutoFit=$true;Observe 'alternate-auto-enabled-first'
    $table.Columns.Item(1).SetWidth([single]225,[int]0);Observe 'alternate-col1'
    $table.Columns.Item(2).SetWidth([single]225,[int]0);Observe 'alternate-col2'
    AutoCellUnits;Observe 'alternate-auto-cell-units'
    $table.PreferredWidthType=[int]1;Observe 'alternate-auto-table-units'
    $report.alternateState=Read-WordTableWidths $table ([string]$table.Range.WordOpenXML)
}catch{$report.error=$_.Exception.Message}
finally{
    try{
        if([string]$doc.Content.Text -cne [string]$baseline.documentText -or (Hash-Text (Get-WordLayoutContent ([string]$table.Range.WordOpenXML) $true)) -cne [string]$baseline.widthUntouchedHash){throw 'UNSUPPORTED_CONTENT_CHANGED_REFUSING_CLEANUP'}
        Set-WordTableWidths $table $baseline.widths.columns $baseline.widths 'left'
        $report.fixtureRestored=Test-WordTableWidthMatch (Read-WordTableWidths $table ([string]$table.Range.WordOpenXML)) $baseline.widths
        if(-not $report.fixtureRestored){throw 'BASELINE_WIDTH_RESTORE_FAILED'}
    }catch{$report.cleanupError=$_.Exception.Message}
    [IO.File]::WriteAllText((Join-Path $directory 'report.json'),(ConvertTo-Json -InputObject $report -Depth 10),[Text.UTF8Encoding]::new($false))
}
@{directory=$directory;fixtureRestored=$report.fixtureRestored;error=$report.error;cleanupError=$report.cleanupError}|ConvertTo-Json -Compress
if($report.error -or $report.cleanupError){exit 1}
