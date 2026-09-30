[CmdletBinding()]
param(
    [ValidateRange(1,128)][int]$MaxCandidates = 64,
    [ValidateRange(1,4096)][int]$MaxTopLevels = 2048,
    [ValidateRange(1,16384)][int]$MaxChildren = 8192,
    [ValidateRange(100,30000)][int]$SoftDeadlineMs = 10000,
    [switch]$CompileOnly
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function Stop-Probe([string]$code) {
    [Console]::Error.WriteLine((@{ error = @{ code = $code }; readOnly = $true } | ConvertTo-Json -Compress))
    exit 1
}
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) {
    Stop-Probe 'WINDOWS_POWERSHELL_5_REQUIRED'
}
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { Stop-Probe 'STA_REQUIRED' }

try {
    $source = Join-Path (Split-Path -Parent $PSScriptRoot) 'packages/native-office/office-windows.cs'
    Add-Type -Path $source -ErrorAction Stop
} catch {
    # Compilation/security policy failures are reported, never worked around.
    Stop-Probe 'ADD_TYPE_FAILED_OR_BLOCKED'
}
if ($CompileOnly) {
    @{ compiled = $true; readOnly = $true; runtime = 'WindowsPowerShell5-STA' } | ConvertTo-Json -Compress
    exit 0
}
try {
    $result = [Workbench.OfficeWindows.Probe]::Scan($MaxCandidates, $MaxTopLevels, $MaxChildren, $SoftDeadlineMs)
    ConvertTo-Json -InputObject $result -Depth 8 -Compress
} catch { Stop-Probe 'DISCOVERY_FAILED' }
