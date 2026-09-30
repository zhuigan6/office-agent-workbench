import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const scripts = ['Start-Service.ps1', 'Install-Service.ps1', 'Stop-Service.ps1'];
const parseScripts = [...scripts,'Initialize-Local.ps1','Protect-Data.ps1','Renew-Certificate.ps1'];
const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const windows = process.platform === 'win32';

// Only library functions are loaded. All service/config/network mutations are mocked.
function runPS(body: string) {
  const load = scripts.map(name => `. ${psQuote(path.join(root, 'scripts', name))}`).join('\n');
  const code = `
$ErrorActionPreference = 'Stop'
function Register-ScheduledTask { throw 'UNMOCKED registration' }
function Start-ScheduledTask { throw 'UNMOCKED start task' }
function Stop-ScheduledTask { throw 'UNMOCKED stop task' }
function Enable-ScheduledTask { throw 'UNMOCKED enable task' }
function Disable-ScheduledTask { throw 'UNMOCKED disable task' }
function Start-Process { throw 'UNMOCKED process launch' }
function Invoke-RestMethod { throw 'UNMOCKED network' }
function New-Item { throw 'UNMOCKED directory mutation' }
${load}
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Throws([scriptblock]$Action) {
  $threw = $false
  try { & $Action | Out-Null } catch { $threw = $true }
  Assert $threw 'Expected refusal'
}
${body.replaceAll('E:\\Workbench', path.parse(process.env.SystemRoot || 'C:\\Windows').root + 'Workbench').replaceAll('E:\\Other', path.parse(process.env.SystemRoot || 'C:\\Windows').root + 'Other')}
`;
  const result = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', code], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

test('scripts are UTF-8 BOM and contain no bypass or process killing', () => {
  for (const name of parseScripts) {
    const content = fs.readFileSync(path.join(root, 'scripts', name));
    assert.deepEqual([...content.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.doesNotMatch(content.toString('utf8'), /EncodedCommand|ExecutionPolicy|\.vbs\b|Stop-Process|taskkill|SkipCertificateCheck|ServerCertificateValidationCallback/i);
  }
});

test('Windows PowerShell parser accepts all scripts; dot sourcing has no side effects', { skip: !windows }, () => {
  runPS(parseScripts.map(name => `
$tokens = $null; $errors = $null
$null = [Management.Automation.Language.Parser]::ParseFile(${psQuote(path.join(root, 'scripts', name))}, [ref]$tokens, [ref]$errors)
Assert ($errors.Count -eq 0) ($errors | Out-String)
`).join('\n'));
});

const fixture = `
$spec = [pscustomobject]@{ Name='Office Agent Workbench'; Path='\\'; Description='owned'; Execute='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'; Arguments='-NoProfile -NonInteractive -WindowStyle Hidden -File "E:\\Workbench & Test\\scripts\\Start-Service.ps1"'; Root='E:\\Workbench & Test'; User='S-1-5-21-100' }
$task = [pscustomobject]@{ TaskName=$spec.Name; TaskPath=$spec.Path; Description=$spec.Description; Actions=@([pscustomobject]@{Execute=$spec.Execute; Arguments=$spec.Arguments; WorkingDirectory=$spec.Root}); Principal=[pscustomobject]@{UserId=$spec.User; LogonType='Interactive'; RunLevel='Limited'}; Settings=[pscustomobject]@{Enabled=$true} }
`;

test('configuration accepts Int32 and Int64 JSON ports but rejects coercible invalid values', { skip: !windows }, () => {
  runPS(`
$env:WORKBENCH_DATA_DIR = $null
$script:config = [pscustomobject]@{uiToken='test'; pfxPassword='test'; coreSecret='test'; aioncore='test'; officecli='test'; certificateThumbprint='test'; port=[long]18443; corePort=[int]18444}
function Get-Content { 'mocked' }
function ConvertFrom-Json { $script:config }
Assert ((Get-WorkbenchConfig 'E:\\Workbench').port -eq 18443) 'Int64 port supported'
foreach ($invalid in @('18443', [double]18443.5, $true, 0, 65536, $null)) {
  $script:config.port = $invalid
  Assert-Throws { Get-WorkbenchConfig 'E:\\Workbench' }
}
$script:config.port = [long]18444
Assert-Throws { Get-WorkbenchConfig 'E:\\Workbench' }
`);
});

test('task XML has interactive limited logon, indefinite five-minute watchdog and safe settings', { skip: !windows }, () => {
  runPS(fixture + `
$xml = [xml](New-WorkbenchTaskXml $spec $true)
Assert ($xml.Task.Principals.Principal.LogonType -eq 'InteractiveToken') 'Interactive required'
Assert ($xml.Task.Principals.Principal.RunLevel -eq 'LeastPrivilege') 'Limited required'
Assert ($xml.Task.Triggers.LogonTrigger.UserId -eq $spec.User) 'Current user only'
Assert ($xml.Task.Triggers.TimeTrigger.Repetition.Interval -eq 'PT5M') 'Five minute watchdog'
Assert (-not $xml.Task.Triggers.TimeTrigger.Repetition.Duration) 'Indefinite watchdog'
Assert ($xml.Task.Settings.RestartOnFailure.Count -eq '3') 'Three retries'
Assert ($xml.Task.Settings.RestartOnFailure.Interval -eq 'PT1M') 'One minute retry'
Assert ($xml.Task.Settings.ExecutionTimeLimit -eq 'PT0S') 'Unlimited lifetime'
Assert ($xml.Task.Settings.MultipleInstancesPolicy -eq 'IgnoreNew') 'No duplicate instances'
Assert ($xml.Task.Settings.DisallowStartIfOnBatteries -eq 'false') 'Battery start'
Assert ($xml.Task.Settings.StopIfGoingOnBatteries -eq 'false') 'Battery continue'
Assert ($xml.Task.Settings.AllowHardTerminate -eq 'false') 'No forced termination'
Assert ($xml.Task.Actions.Exec.Arguments -ceq $spec.Arguments) 'Escaped arguments round trip'
Assert ($xml.Task.Actions.Exec.WorkingDirectory -ceq $spec.Root) 'Root round trip'
Assert (([xml](New-WorkbenchTaskXml $spec $false)).Task.Settings.Enabled -eq 'false') 'RegisterOnly disables watchdog'
`);
});

test('ownership refuses mismatched action, root, user and elevation', { skip: !windows }, () => {
  runPS(fixture + `
Assert-WorkbenchTask $task $spec
$task.Actions[0].Arguments += ' -Anything'
Assert-Throws { Assert-WorkbenchTask $task $spec }
$task.Actions[0].Arguments = $spec.Arguments
$task.Actions[0].WorkingDirectory = 'E:\\Other'
Assert-Throws { Assert-WorkbenchTask $task $spec }
$task.Actions[0].WorkingDirectory = $spec.Root
$task.Principal.UserId = 'S-1-5-21-101'
Assert-Throws { Assert-WorkbenchTask $task $spec }
$task.Principal.UserId = $spec.User
$task.Principal.RunLevel = 'Highest'
Assert-Throws { Assert-WorkbenchTask $task $spec }
`);
});

test('health requires strict standalone readiness and same-root node; TLS/network failure is not health', { skip: !windows }, () => {
  runPS(`
$config = [pscustomobject]@{port=18443}
$script:reply = [pscustomobject]@{mode='standalone'; coreReady=$true; pid=123}
function Invoke-RestMethod { $script:reply }
function Get-NetTCPConnection { [pscustomobject]@{OwningProcess=123} }
function Get-CimInstance { [pscustomobject]@{ExecutablePath='D:\\node\\node.exe'; CommandLine='"D:\\node\\node.exe" --import "file:///E:/Workbench/node_modules/tsx/dist/loader.mjs" "E:\\Workbench\\apps\\local-host\\main.ts"'} }
function Test-WorkbenchPort { $true }
Assert ((Get-WorkbenchHealth 'E:\\Workbench' $config) -eq 'ready') 'Expected owned ready host'
$script:reply.pid = [long]123
Assert ((Get-WorkbenchHealth 'E:\\Workbench' $config) -eq 'ready') 'Int64 PID supported'
$script:reply.coreReady = 'true'
Assert ((Get-WorkbenchHealth 'E:\\Workbench' $config) -eq 'occupied') 'String is not true'
$script:reply.coreReady = $false
Assert ((Get-WorkbenchHealth 'E:\\Workbench' $config) -ne 'ready') 'Starting is not ready'
$script:reply.coreReady = $true; $script:reply.mode = 'addin'
Assert ((Get-WorkbenchHealth 'E:\\Workbench' $config) -eq 'occupied') 'Wrong mode'
$script:reply.mode = 'standalone'
Assert ((Get-WorkbenchHealth 'E:\\Other' $config) -eq 'occupied') 'Wrong root'
function Get-NetTCPConnection { [pscustomobject]@{OwningProcess=456} }
Assert ((Get-WorkbenchHealth 'E:\\Workbench' $config) -eq 'occupied') 'Reported PID must own listener'
function Invoke-RestMethod { throw 'TLS validation failed' }
Assert ((Get-WorkbenchHealth 'E:\\Workbench' $config) -eq 'occupied') 'Unknown listener'
function Test-WorkbenchPort { $false }
Assert ((Get-WorkbenchHealth 'E:\\Workbench' $config) -eq 'absent') 'No listener'
`);
});

const mockedRuntime = fixture + `
function Get-WorkbenchRoot { $spec.Root }
function Get-WorkbenchConfig { [pscustomobject]@{port=18443;corePort=18444;uiToken='TEST_ONLY_SECRET'} }
function Get-WorkbenchTaskSpec { $spec }
function Get-WorkbenchTask { $task }
function Assert-WorkbenchPreflight { }
function Get-WorkbenchNode { 'D:\\node\\node.exe' }
function Test-WorkbenchPort { $false }
function Get-WorkbenchHealth { 'ready' }
`;

test('startup no-ops on ready host, refuses occupied ports and propagates child failure', { skip: !windows }, () => {
  runPS(mockedRuntime + `
Assert (@(Invoke-WorkbenchStart)[-1] -eq 0) 'Ready no-op'
function Get-WorkbenchHealth { 'occupied' }
Assert-Throws { Invoke-WorkbenchStart }
function Get-WorkbenchHealth { 'absent' }
function Test-WorkbenchPort { $true }
Assert-Throws { Invoke-WorkbenchStart }
function Test-WorkbenchPort { $false }
function New-WorkbenchLogPaths { [pscustomobject]@{Out='unique.stdout.log';Err='unique.stderr.log'} }
function Start-Process {
  param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,[switch]$Wait,[switch]$PassThru,$RedirectStandardOutput,$RedirectStandardError,$ErrorAction)
  Assert ($FilePath -eq 'D:\\node\\node.exe') 'Explicit node'
  Assert ($ArgumentList -like '--import "file:///*/node_modules/tsx/dist/loader.mjs" "*\\apps\\local-host\\main.ts"') 'File URI and entry'
  Assert ($WorkingDirectory -eq $spec.Root -and $WindowStyle -eq 'Hidden' -and $Wait -and $PassThru) 'Supervisor launch'
  Assert ($RedirectStandardOutput -ne $RedirectStandardError) 'Separate logs'
  [pscustomobject]@{ExitCode=17}
}
Assert ((Invoke-WorkbenchStart) -eq 17) 'Child exit code'
`);
});

test('RegisterOnly does not start or enable task; collisions and unknown listeners fail before registration', { skip: !windows }, () => {
  runPS(mockedRuntime + `
function Get-WorkbenchTask { if ($script:registered) { $task } }
function Register-ScheduledTask {
  param($TaskName,$TaskPath,$Xml,[switch]$Force,$ErrorAction)
  Assert (([xml]$Xml).Task.Settings.Enabled -eq 'false') 'Must register disabled'
  $script:registered = $true
}
Invoke-WorkbenchInstall -RegisterOnly
Assert $script:registered 'Registered'
$task.Actions[0].WorkingDirectory = 'E:\\Other'
Assert-Throws { Invoke-WorkbenchInstall -RegisterOnly }
$script:registered = $false
function Get-WorkbenchHealth { 'occupied' }
Assert-Throws { Invoke-WorkbenchInstall -RegisterOnly }
Assert (-not $script:registered) 'Unknown listener must not register'
`);
});

test('accepted shutdown disables watchdog before POST, waits for listeners and stops only owned task', { skip: !windows }, () => {
  const output = runPS(mockedRuntime + `
$script:events = [Collections.Generic.List[string]]::new()
function Disable-ScheduledTask { $script:events.Add('disable') }
function Invoke-RestMethod {
  param($Uri,$Method,$Headers,$TimeoutSec,$MaximumRedirection,$ErrorAction)
  Assert ($Uri -eq 'https://localhost:18443/api/admin/shutdown' -and $Method -eq 'Post') 'Shutdown endpoint'
  Assert ($Headers.Authorization -eq 'Bearer TEST_ONLY_SECRET' -and $MaximumRedirection -eq 0) 'Bearer without redirects'
  $script:events.Add('post'); [pscustomobject]@{stopping=$true}
}
function Stop-ScheduledTask { param($TaskName,$TaskPath,$ErrorAction); Assert ($TaskName -eq $spec.Name -and $TaskPath -eq '\\') 'Own task only'; $script:events.Add('stop') }
Invoke-WorkbenchStop
Assert (($script:events -join ',') -eq 'disable,post,stop') 'Shutdown ordering'
`);
  assert.doesNotMatch(output, /TEST_ONLY_SECRET/);
});

test('HTTP 409 or malformed response restores prior enabled state without stopping anything', { skip: !windows }, () => {
  runPS(mockedRuntime + `
$script:events = [Collections.Generic.List[string]]::new()
function Disable-ScheduledTask { $script:events.Add('disable') }
function Enable-ScheduledTask { $script:events.Add('enable') }
function Invoke-RestMethod { throw '409 busy' }
Assert-Throws { Invoke-WorkbenchStop }
Assert (($script:events -join ',') -eq 'disable,enable') 'Restore after 409'
$script:events.Clear()
function Invoke-RestMethod { [pscustomobject]@{stopping='true'} }
Assert-Throws { Invoke-WorkbenchStop }
Assert (($script:events -join ',') -eq 'disable,enable') 'Restore after malformed response'
$script:events.Clear(); $task.Settings.Enabled = $false
Assert-Throws { Invoke-WorkbenchStop }
Assert (($script:events -join ',') -eq 'disable') 'Originally disabled remains disabled'
`);
});

test('accepted shutdown timeout keeps watchdog disabled and does not force-stop the task', { skip: !windows }, () => {
  runPS(mockedRuntime + `
$script:events = [Collections.Generic.List[string]]::new()
function Disable-ScheduledTask { $script:events.Add('disable') }
function Invoke-RestMethod { [pscustomobject]@{stopping=$true} }
function Get-WorkbenchHealth { 'starting' }
function Test-WorkbenchPort { $true }
$script:clock = [datetime]'2026-01-01'
function Get-Date { $script:clock = $script:clock.AddMinutes(2); $script:clock }
Assert-Throws { Invoke-WorkbenchStop }
Assert (($script:events -join ',') -eq 'disable') 'Accepted timeout remains disabled'
`);
});

test('task enumeration errors and unverified stop targets fail closed', { skip: !windows }, () => {
  runPS(fixture + `
function Get-ScheduledTask { throw 'Task provider unavailable' }
Assert-Throws { Get-WorkbenchTask $spec }
function Get-WorkbenchRoot { $spec.Root }
function Get-WorkbenchConfig { [pscustomobject]@{port=18443;corePort=18444} }
function Get-WorkbenchTaskSpec { $spec }
function Get-WorkbenchTask { $task }
function Get-WorkbenchHealth { 'occupied' }
Assert-Throws { Invoke-WorkbenchStop }
function Get-WorkbenchHealth { 'ready' }
$task.Actions[0].WorkingDirectory = 'E:\\Other'
Assert-Throws { Invoke-WorkbenchStop }
`);
});

test('log paths use timestamp and random ID without overwriting prior invocation', { skip: !windows }, () => {
  runPS(`
function New-Item { }
$a = New-WorkbenchLogPaths 'E:\\Workbench'
$b = New-WorkbenchLogPaths 'E:\\Workbench'
Assert ($a.Out -ne $b.Out -and $a.Err -ne $b.Err) 'Unique per invocation'
Assert ((Split-Path -Parent $a.Out) -eq 'E:\\Workbench\\.local\\service') 'Private log directory'
Assert ((Split-Path -Leaf $a.Out) -match '^[0-9]{8}-[0-9]{6}-[0-9]{3}-[a-f0-9]{32}\\.stdout\\.log$') 'Timestamped log name'
`);
});
