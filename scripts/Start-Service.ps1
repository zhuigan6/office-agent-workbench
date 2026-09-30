# Login-session supervisor. Dot-sourcing defines helpers only (also used by tests).
[CmdletBinding()]
param()

function Get-WorkbenchRoot {
    (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..') -ErrorAction Stop).ProviderPath.TrimEnd('\')
}

function Get-WorkbenchConfig([string]$Root) {
    if ($env:WORKBENCH_DATA_DIR -and [IO.Path]::GetFullPath($env:WORKBENCH_DATA_DIR).TrimEnd('\') -ine (Join-Path $Root '.local')) {
        throw 'WORKBENCH_DATA_DIR must be unset or point to this root/.local.'
    }
    $config = Get-Content -LiteralPath (Join-Path $Root '.local/config.json') -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    foreach ($field in @('uiToken', 'pfxPassword', 'coreSecret', 'aioncore', 'officecli', 'certificateThumbprint')) {
        if ($config.$field -isnot [string] -or [string]::IsNullOrWhiteSpace($config.$field)) { throw "Missing configuration field: $field" }
    }
    foreach ($field in @('port', 'corePort')) {
        if (($config.$field -isnot [int] -and $config.$field -isnot [long]) -or $config.$field -lt 1 -or $config.$field -gt 65535) { throw "Invalid port field: $field" }
    }
    if ($config.port -eq $config.corePort) { throw 'Host and core ports must differ.' }
    $config
}

function Get-WorkbenchNode {
    $candidate = Join-Path (Get-WorkbenchRoot) 'runtime\node\node.exe'
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { $candidate = 'D:\node\node.exe' }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        $candidate = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    }
    $node = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).ProviderPath
    if ([IO.Path]::GetFileName($node) -ine 'node.exe') { throw 'An actual node.exe is required.' }
    $version = & $node --version
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') { throw 'Node.js 24 is required.' }
    $node
}

function Test-WorkbenchPort([int]$Port) {
    @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object Port -eq $Port).Count -gt 0
}

function Get-WorkbenchHealth([string]$Root, $Config) {
    # Default Windows TLS validation remains enabled; never follow a redirect.
    try {
        $health = Invoke-RestMethod -Uri "https://localhost:$($Config.port)/health" -Method Get -TimeoutSec 5 -MaximumRedirection 0 -ErrorAction Stop
        if ($health.mode -cne 'standalone' -or $health.coreReady -isnot [bool]) { return 'occupied' }
        if (($health.pid -isnot [int] -and $health.pid -isnot [long]) -or $health.pid -le 0 -or $health.pid -gt [int]::MaxValue) { return 'occupied' }
        $listeners = @(Get-NetTCPConnection -LocalPort $Config.port -State Listen -ErrorAction Stop)
        if (-not ($listeners | Where-Object OwningProcess -eq $health.pid)) { return 'occupied' }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($health.pid)" -ErrorAction Stop
        $entry = Join-Path $Root 'apps\local-host\main.ts'
        $pattern = '(?:^|\s)(?:"' + [regex]::Escape($entry) + '"|' + [regex]::Escape($entry) + ')(?:\s|$)'
        if (-not $process -or [IO.Path]::GetFileName($process.ExecutablePath) -ine 'node.exe' -or $process.CommandLine -notmatch $pattern) { return 'occupied' }
        if ($health.coreReady) { return 'ready' }
        return 'starting'
    } catch {
        if (Test-WorkbenchPort $Config.port) { return 'occupied' }
        return 'absent'
    }
}

function Assert-WorkbenchPreflight([string]$Root, $Config) {
    foreach ($relative in @('package.json', 'dist/index.html', 'node_modules/tsx/dist/loader.mjs', 'apps/local-host/main.ts', '.local/server.pfx')) {
        $script:WorkbenchPreflightDetail = 'file:' + $relative
        if (-not (Test-Path -LiteralPath (Join-Path $Root $relative) -PathType Leaf)) { throw "Required file missing: $relative" }
    }
    $script:WorkbenchPreflightDetail = 'package'
    $package = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
    if ($package.name -cne 'office-agent-workbench' -or $package.type -cne 'module') { throw 'Unexpected Workbench package.' }
    foreach ($binary in @($Config.aioncore, $Config.officecli)) {
        $script:WorkbenchPreflightDetail = 'engine-path'
        if (-not [IO.Path]::IsPathRooted($binary) -or -not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw 'A configured runtime binary is missing or not absolute.' }
    }
    $cert = $null
    $trustStore = $null
    try {
        $script:WorkbenchPreflightDetail = 'certificate-load'
        # Ephemeral loading checks the PFX without importing a key/certificate.
        $cert = [Security.Cryptography.X509Certificates.X509Certificate2]::new(
            (Join-Path $Root '.local/server.pfx'), $Config.pfxPassword,
            [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
        $script:WorkbenchPreflightDetail = 'certificate-identity-or-trust'
        # Query the OS store directly: a PS7-launched Windows PowerShell child can
        # lack the Cert: provider even though Windows trusts the certificate.
        $trustStore = [Security.Cryptography.X509Certificates.X509Store]::new('Root', 'CurrentUser')
        $trustStore.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
        $trusted = $trustStore.Certificates.Find([Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $cert.Thumbprint, $false).Count -gt 0
        if (-not $cert.HasPrivateKey -or $cert.Thumbprint -ine $Config.certificateThumbprint -or
            $cert.NotBefore -gt (Get-Date) -or $cert.NotAfter -le (Get-Date) -or
            $cert.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::DnsName, $false) -ine 'localhost' -or
            -not $trusted) {
            throw 'Certificate check failed.'
        }
    } catch { throw 'Local PFX must contain the current valid localhost certificate/private key trusted in CurrentUser/Root.' }
    finally { if ($trustStore) { $trustStore.Dispose() }; if ($cert) { $cert.Dispose() } }
}

function Get-WorkbenchTaskSpec([string]$Root) {
    [pscustomobject]@{
        Name = 'Office Agent Workbench'
        Path = '\'
        Description = "Office Agent Workbench login service v1 | $Root"
        Execute = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + (Join-Path $Root 'scripts\Start-Service.ps1') + '"'
        Root = $Root
        User = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    }
}

function Get-WorkbenchTask($Spec) {
    # Enumerate successfully first; access/provider failures must not mean "absent".
    $matches = @(Get-ScheduledTask -TaskPath $Spec.Path -ErrorAction Stop | Where-Object TaskName -eq $Spec.Name)
    if ($matches.Count -gt 1) { throw 'Ambiguous scheduled task.' }
    if ($matches.Count -eq 1) { $matches[0] }
}

function Assert-WorkbenchTask($Task, $Spec) {
    $actions = @($Task.Actions)
    if ($Task.TaskPath -cne $Spec.Path -or $Task.TaskName -cne $Spec.Name -or
        $Task.Description -cne $Spec.Description -or $actions.Count -ne 1 -or
        $actions[0].Execute -ine $Spec.Execute -or $actions[0].Arguments -cne $Spec.Arguments -or
        $actions[0].WorkingDirectory -ine $Spec.Root) { throw 'Unrelated task collision; refusing to modify it.' }
    $user = $Task.Principal.UserId
    if ($user -notmatch '^S-1-') { $user = ([Security.Principal.NTAccount]::new($user)).Translate([Security.Principal.SecurityIdentifier]).Value }
    if ($user -ne $Spec.User -or "$($Task.Principal.LogonType)" -ne 'Interactive' -or "$($Task.Principal.RunLevel)" -ne 'Limited') {
        throw 'Task is not owned by the current limited interactive user.'
    }
}

function New-WorkbenchLogPaths([string]$Root) {
    $directory = Join-Path $Root '.local\service'
    New-Item -ItemType Directory -Path $directory -Force -ErrorAction Stop | Out-Null
    $id = (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N')
    [pscustomobject]@{ Out = Join-Path $directory "$id.stdout.log"; Err = Join-Path $directory "$id.stderr.log" }
}

function Invoke-WorkbenchStart {
    $script:WorkbenchStartupStage = 'configuration'
    $root = Get-WorkbenchRoot
    $config = Get-WorkbenchConfig $root
    $script:WorkbenchStartupStage = 'preflight'
    Assert-WorkbenchPreflight $root $config
    $script:WorkbenchStartupStage = 'node'
    $node = Get-WorkbenchNode
    $script:WorkbenchStartupStage = 'ownership'
    $health = Get-WorkbenchHealth $root $config
    if ($health -eq 'ready') { Write-Output 'Standalone Workbench is already ready.'; return 0 }
    if ($health -ne 'absent' -or (Test-WorkbenchPort $config.corePort)) { throw 'Host or core port is occupied; no process was stopped.' }
    $script:WorkbenchStartupStage = 'logs'
    $logs = New-WorkbenchLogPaths $root
    $loader = ([uri](Join-Path $root 'node_modules\tsx\dist\loader.mjs')).AbsoluteUri
    $entry = Join-Path $root 'apps\local-host\main.ts'
    $arguments = '--import "' + $loader + '" "' + $entry + '"'
    # Wait keeps the task alive and propagates the exit code to RestartOnFailure.
    $script:WorkbenchStartupStage = 'launch'
    $child = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $logs.Out -RedirectStandardError $logs.Err -ErrorAction Stop
    return [int]$child.ExitCode
}

if ($MyInvocation.InvocationName -eq '.') { return }
$ErrorActionPreference = 'Stop'
try {
    $result = @(Invoke-WorkbenchStart)
    $code = [int]$result[-1]
    $result | Select-Object -SkipLast 1 | Write-Output
    exit $code
} catch {
    # Do not emit exception records: HTTP/configuration exceptions can contain secrets.
    [Console]::Error.WriteLine(('Workbench startup failed at {0} ({1}). Check prerequisites, occupied ports and private .local/service logs; no process was killed.' -f $script:WorkbenchStartupStage,$script:WorkbenchPreflightDetail))
    exit 1
}
