param([Parameter(Mandatory=$true)][string]$InputFile,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/word-snapshot.ps1')
try{Export-WordFlatPackage ([IO.File]::ReadAllText($InputFile)) $Destination | ConvertTo-Json -Compress}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
