[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'Start-Service.ps1')

function Invoke-WorkbenchStop {
    $root = Get-WorkbenchRoot
    $config = Get-WorkbenchConfig $root
    $spec = Get-WorkbenchTaskSpec $root
    $task = Get-WorkbenchTask $spec
    if (-not $task) { throw 'Owned scheduled task not found; refusing shutdown.' }
    Assert-WorkbenchTask $task $spec
    if ((Get-WorkbenchHealth $root $config) -notin @('ready', 'starting')) { throw 'Standalone host ownership is not verified; refusing shutdown.' }
    $wasEnabled = [bool]$task.Settings.Enabled
    $accepted = $false
    Disable-ScheduledTask -TaskName $spec.Name -TaskPath $spec.Path -ErrorAction Stop | Out-Null
    try {
        $reply = Invoke-RestMethod -Uri "https://localhost:$($config.port)/api/admin/shutdown" -Method Post -Headers @{ Authorization = "Bearer $($config.uiToken)" } -TimeoutSec 15 -MaximumRedirection 0 -ErrorAction Stop
        if ($reply.stopping -isnot [bool] -or $reply.stopping -ne $true) { throw 'Shutdown not accepted.' }
        $accepted = $true
        # Give core/helper/server cleanup time before stopping only the owned task wrapper.
        $deadline = (Get-Date).AddSeconds(60)
        while ((Test-WorkbenchPort $config.port) -or (Test-WorkbenchPort $config.corePort)) {
            if ((Get-Date) -ge $deadline) { throw 'Shutdown accepted but listeners remain; task stays disabled. No force kill was attempted.' }
            Start-Sleep -Milliseconds 500
        }
        Assert-WorkbenchTask (Get-WorkbenchTask $spec) $spec
        Stop-ScheduledTask -TaskName $spec.Name -TaskPath $spec.Path -ErrorAction Stop
        Write-Output 'Graceful shutdown accepted; listeners closed and owned task disabled/stopped. Run Install-Service.ps1 to resume.'
    } finally {
        if (-not $accepted -and $wasEnabled) {
            Assert-WorkbenchTask (Get-WorkbenchTask $spec) $spec
            Enable-ScheduledTask -TaskName $spec.Name -TaskPath $spec.Path -ErrorAction Stop | Out-Null
        }
    }
}

if ($MyInvocation.InvocationName -eq '.') { return }
$ErrorActionPreference = 'Stop'
try { Invoke-WorkbenchStop }
catch {
    [Console]::Error.WriteLine('Workbench stop was not completed. A rejected request (including busy HTTP 409) restores the prior enabled state; an accepted shutdown leaves the task disabled. No arbitrary process was killed.')
    exit 1
}
