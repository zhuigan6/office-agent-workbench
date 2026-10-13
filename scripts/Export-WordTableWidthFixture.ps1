param([Parameter(Mandatory=$true)][string]$OutputPdf)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent;$verification=[IO.Path]::GetFullPath((Join-Path $root '.local/verification'))
$output=[IO.Path]::GetFullPath($OutputPdf);$parent=Split-Path $output -Parent
if((Split-Path $parent -Parent) -ine $verification -or (Split-Path $parent -Leaf) -notmatch '^word-table-width-render-\d+$' -or (Split-Path $output -Leaf) -cne 'applied.pdf' -or (Test-Path -LiteralPath $output)){throw 'EXACT_NEW_PRIVATE_PDF_REQUIRED'}
if(-not (Test-Path -LiteralPath $parent -PathType Container) -or ((Get-Item -LiteralPath $parent).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'PRIVATE_OUTPUT_DIRECTORY_REQUIRED'}
$file=[IO.Path]::GetFullPath((Join-Path $root '.local/host-fixtures/word-table-1790923966234/native-word-table-test.docx'))
$app=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application');$doc=$null
for($i=1;$i -le $app.Documents.Count;$i++){if([string]$app.Documents.Item($i).FullName -ieq $file){$doc=$app.Documents.Item($i);break}}
if($null -eq $doc -or $doc.Tables.Count -ne 1 -or $doc.Windows.Count -ne 1){throw 'DEDICATED_OPEN_TABLE_REQUIRED'}
$table=$doc.Tables.Item(1)
if($table.Rows.Count -ne 3 -or $table.Columns.Count -ne 2 -or [Math]::Abs([double]$table.Columns.Item(1).Width-240) -gt 0.1 -or [Math]::Abs([double]$table.Columns.Item(2).Width-120) -gt 0.1 -or $table.Rows.Alignment -ne 1){throw 'EXACT_RENDER_PROBE_LAYOUT_REQUIRED'}
$doc.ExportAsFixedFormat($output,[int]17)
if(-not (Test-Path -LiteralPath $output -PathType Leaf)){throw 'PDF_NOT_CREATED'}
@{SourceSaveIssued=$false;Exported=$true}|ConvertTo-Json -Compress
