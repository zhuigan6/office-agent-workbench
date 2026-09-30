[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $root '.local\config.json') -Raw | ConvertFrom-Json
$origin = 'https://localhost:' + $config.port
$health = Invoke-RestMethod -Uri ($origin + '/health') -TimeoutSec 5
if (-not $health.coreReady) { throw 'Agent backend is not ready. Inspect the local service log.' }
# The credential is a local fragment, never a server query parameter or console output.
Start-Process -FilePath ($origin + '/#token=' + [Uri]::EscapeDataString($config.uiToken))
