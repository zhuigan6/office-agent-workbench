[CmdletBinding()]
param([Parameter(Mandatory)][ValidatePattern('^[a-f0-9-]{36}$')][string]$LinkId)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dataRoot = if ($env:WORKBENCH_DATA_DIR) { $env:WORKBENCH_DATA_DIR } else { Join-Path $root '.local' }
$config = Get-Content -LiteralPath (Join-Path $dataRoot 'config.json') -Raw | ConvertFrom-Json
$grant = Invoke-RestMethod -Uri ('https://localhost:' + $config.port + '/api/native-sessions/' + $LinkId + '/terminal') -Method Post -Headers @{ Authorization = 'Bearer ' + $config.uiToken } -TimeoutSec 30 -MaximumRedirection 0
if ($grant.endpoint -notmatch '^ws://127\.0\.0\.1:[1-9][0-9]{0,4}$' -or $grant.threadId -notmatch '^[a-f0-9-]{36}$') { throw 'Invalid owned terminal grant.' }
$previousHome = $env:CODEX_HOME
$previousToken = $env:WORKBENCH_NATIVE_TOKEN
$previousTerm = $env:TERM
try {
    $env:CODEX_HOME = $grant.clientHome
    $env:WORKBENCH_NATIVE_TOKEN = $grant.token
    if (-not $env:TERM -or $env:TERM -eq 'dumb') { $env:TERM = 'xterm-256color' }
    Push-Location -LiteralPath $grant.workspace
    try {
        # The bearer is passed only in the environment, never in the command line.
        & $grant.binary --remote $grant.endpoint --remote-auth-token-env WORKBENCH_NATIVE_TOKEN --no-alt-screen resume $grant.threadId
        if ($LASTEXITCODE -ne 0) { throw 'Native terminal disconnected with an error. The linked history is retained.' }
    } finally { Pop-Location }
} finally {
    $env:CODEX_HOME = $previousHome
    $env:WORKBENCH_NATIVE_TOKEN = $previousToken
    $env:TERM = $previousTerm
    $grant = $null
}
