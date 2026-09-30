[CmdletBinding()]
param([switch]$RegisterOnly)

. (Join-Path $PSScriptRoot 'Start-Service.ps1')

function New-WorkbenchTaskXml($Spec, [bool]$Enabled) {
    $description = [Security.SecurityElement]::Escape($Spec.Description)
    $exe = [Security.SecurityElement]::Escape($Spec.Execute)
    $arguments = [Security.SecurityElement]::Escape($Spec.Arguments)
    $root = [Security.SecurityElement]::Escape($Spec.Root)
    $user = [Security.SecurityElement]::Escape($Spec.User)
    $enabledText = $Enabled.ToString().ToLowerInvariant()
    $firstWatchdog = (Get-Date).AddMinutes(5).ToString('yyyy-MM-ddTHH:mm:ss')
    @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>$description</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>$user</UserId></LogonTrigger>
    <TimeTrigger><Repetition><Interval>PT5M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>$firstWatchdog</StartBoundary><Enabled>true</Enabled></TimeTrigger>
  </Triggers>
  <Principals><Principal id="User"><UserId>$user</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>false</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>$enabledText</Enabled><Hidden>false</Hidden><RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="User"><Exec><Command>$exe</Command><Arguments>$arguments</Arguments><WorkingDirectory>$root</WorkingDirectory></Exec></Actions>
</Task>
"@
}

function Invoke-WorkbenchInstall([switch]$RegisterOnly) {
    $root = Get-WorkbenchRoot
    $config = Get-WorkbenchConfig $root
    Assert-WorkbenchPreflight $root $config
    $null = Get-WorkbenchNode
    $spec = Get-WorkbenchTaskSpec $root
    $existing = Get-WorkbenchTask $spec
    if ($existing) { Assert-WorkbenchTask $existing $spec }
    $health = Get-WorkbenchHealth $root $config
    if ($health -notin @('ready', 'absent')) { throw 'Listener is not a verified ready standalone Workbench for this root.' }
    if ($health -eq 'absent' -and (Test-WorkbenchPort $config.corePort)) { throw 'Core port is occupied.' }
    if ($existing) {
        $directory = Join-Path $root '.local\service'
        New-Item -ItemType Directory -Path $directory -Force -ErrorAction Stop | Out-Null
        $backup = Join-Path $directory ('task-before-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N') + '.xml')
        $xml = Export-ScheduledTask -TaskName $spec.Name -TaskPath $spec.Path -ErrorAction Stop
        # Export before registration, to a unique exact path; never overwrite a backup.
        $stream = [IO.File]::Open($backup, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
        try {
            $bytes = [Text.Encoding]::Unicode.GetPreamble() + [Text.Encoding]::Unicode.GetBytes($xml)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally { $stream.Dispose() }
        Write-Output "Existing task XML backup: $backup"
    }
    # RegisterOnly disables the whole task: neither logon nor the watchdog may race takeover.
    $xml = New-WorkbenchTaskXml $spec (-not $RegisterOnly)
    Register-ScheduledTask -TaskName $spec.Name -TaskPath $spec.Path -Xml $xml -Force -ErrorAction Stop | Out-Null
    Assert-WorkbenchTask (Get-WorkbenchTask $spec) $spec
    if ($RegisterOnly) {
        Write-Output 'Registered disabled. After stopping the old development host, run Install-Service.ps1 without -RegisterOnly.'
        return
    }
    Start-ScheduledTask -TaskName $spec.Name -TaskPath $spec.Path -ErrorAction Stop
    $deadline = (Get-Date).AddSeconds(90)
    do {
        if ((Get-WorkbenchHealth $root $config) -eq 'ready') { Write-Output 'Standalone Workbench is ready; login watchdog enabled.'; return }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw 'Task registered, but readiness was not verified within 90 seconds.'
}

if ($MyInvocation.InvocationName -eq '.') { return }
$ErrorActionPreference = 'Stop'
try { Invoke-WorkbenchInstall -RegisterOnly:$RegisterOnly }
catch {
    [Console]::Error.WriteLine('Workbench registration/readiness failed. Check prerequisites, listener/task ownership and .local/service. Registration may have succeeded; no server was forcibly stopped.')
    exit 1
}
