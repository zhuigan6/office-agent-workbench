import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourcePath = path.join(root, 'packages/native-office/office-windows.cs');
const scriptPath = path.join(root, 'scripts/Inspect-OfficeWindows.ps1');
const source = readFileSync(sourcePath, 'utf8');
const script = readFileSync(scriptPath, 'utf8');
const shell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const windows = { skip: process.platform !== 'win32' };
function run(args: string[]) {
  return spawnSync(shell, ['-NoProfile', '-NonInteractive', '-STA', ...args],
    { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 25000, maxBuffer: 2 * 1024 * 1024 });
}

test('prototype source permits only read-only native operations and fixed source loading', () => {
  for (const api of ['EnumWindows', 'EnumChildWindows', 'GetWindowThreadProcessId', 'AccessibleObjectFromWindow',
    'OpenProcessToken', 'GetTokenInformation', 'GetIUnknownForObject']) assert.ok(source.includes(api));
  assert.match(source, /AccessibleObjectFromWindow\(pane, 0xFFFFFFF0/);
  assert.match(source, /00020400-0000-0000-C000-000000000046/);
  assert.match(source, /OpenProcess\(0x1000, false, pid\)/);
  assert.match(source, /OpenProcessToken\(owner.handle, 0x0008/);
  assert.match(source, /sid != userSid/);
  assert.match(source, /targetSession != sessionId/);
  assert.match(source, /ELEVATED_SKIPPED/);
  assert.match(source, /BindingFlags.GetProperty/);
  assert.doesNotMatch(source, /BindingFlags\.(SetProperty|InvokeMethod)|Process\.Start|CreateProcess|CreateInstance|GetActiveObject|GetTypeFromProgID|SendMessage|WriteProcessMemory|SetForegroundWindow/);
  assert.doesNotMatch(source, /Property\([^\n]+"(?:Hwnd|HWND|ActiveWindow|ActiveDocument|ActiveWorkbook|Selection)"/);
  assert.doesNotMatch(script, /ExecutionPolicy|Start-Process|New-Object\s+-ComObject|bridge\.ps1|config\.json|Invoke-Expression/);
  assert.match(script, /ADD_TYPE_FAILED_OR_BLOCKED/);
  assert.match(script, /Add-Type -Path \$source -ErrorAction Stop/);
});

test('identity deduplication retains COM references and uses worker-scoped IDs, not paths or PPT HWND', () => {
  assert.match(source, /retainedIdentities.Add\(identity\)/);
  assert.match(source, /foreach \(IntPtr identity in probe.retainedIdentities\) Marshal.Release\(identity\)/);
  assert.match(source, /windows.TryGetValue\(key, out existing\)/);
  assert.match(source, /existing.evidence.Add\(evidence\)/);
  assert.match(source, /documents.TryGetValue\(docKey, out docId\)/);
  assert.match(source, /applications.TryGetValue\(appKey, out appId\)/);
  assert.match(source, /Guid.NewGuid\(\).ToString\(\)/);
  assert.match(source, /report.workerId \+ ":window:"/);
  assert.match(source, /report.workerId \+ ":document:"/);
  assert.doesNotMatch(source, /FinalReleaseComObject|\.Hwnd|\.HWND/);
});

test('PowerShell parser and Windows PowerShell 5 C# compilation; pure mapping and limit tests', windows, () => {
  const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const program = `
$ErrorActionPreference = 'Stop'
$tokens = $null; $issues = $null
[void][Management.Automation.Language.Parser]::ParseFile(${quote(scriptPath)}, [ref]$tokens, [ref]$issues)
if ($issues.Count) { throw 'PARSE_FAILED' }
Add-Type -Path ${quote(sourcePath)} -ErrorAction Stop
if ([Workbench.OfficeWindows.Probe]::KindFor('WINWORD.EXE','_WwG') -ne 'word') { throw 'WORD_MAP' }
if ([Workbench.OfficeWindows.Probe]::KindFor('excel.exe','EXCEL7') -ne 'excel') { throw 'EXCEL_MAP' }
if ([Workbench.OfficeWindows.Probe]::KindFor('POWERPNT.EXE','paneClassDC') -ne 'powerpoint') { throw 'PPT_MAP' }
foreach ($pair in @(@('other.exe','EXCEL7'), @('EXCEL.EXE','_WwG'), @('POWERPNT.EXE','PPTFrameClass'), @('WINWORD.EXE','_wwg'))) {
  if ($null -ne [Workbench.OfficeWindows.Probe]::KindFor($pair[0],$pair[1])) { throw 'UNSAFE_MAP' }
}
[Workbench.OfficeWindows.Probe]::ValidateLimits(1,1,1,100)
[Workbench.OfficeWindows.Probe]::ValidateLimits(128,4096,16384,30000)
foreach ($limits in @(@(0,1,1,100),@(129,1,1,100),@(1,0,1,100),@(1,4097,1,100),@(1,1,0,100),@(1,1,16385,100),@(1,1,1,99),@(1,1,1,30001))) {
  $rejected = $false
  try { [Workbench.OfficeWindows.Probe]::ValidateLimits($limits[0],$limits[1],$limits[2],$limits[3]) } catch { $rejected = $true }
  if (-not $rejected) { throw 'UNBOUNDED_SCAN' }
}
'NATIVE_DISCOVERY_UNIT=PASS'
`;
  const result = run(['-Command', program]);
  assert.equal(result.error, undefined, 'PowerShell timed out or could not start; no workaround attempted.');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NATIVE_DISCOVERY_UNIT=PASS/);
});

test('standalone read-only runtime snapshot has bounded, unique identities and explicit diagnostics', windows, t => {
  const result = run(['-File', scriptPath]);
  assert.equal(result.error, undefined, 'Probe exceeded external timeout; no Office process is terminated.');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.readOnly, true);
  assert.equal(report.scope, 'current-user-current-session-current-desktop');
  assert.match(report.workerId, /^[a-f0-9-]{36}$/);
  assert.ok(report.topLevelsVisited <= 2048 && report.childrenVisited <= 8192 && report.candidatesVisited <= 64);
  assert.ok(report.diagnostics.length <= 256 && report.windows.length <= 64);
  assert.equal(new Set(report.windows.map((w: any) => w.windowId)).size, report.windows.length);
  assert.equal(new Set(report.instances.map((i: any) => i.processId)).size, report.instances.length);
  const panes = new Set<string>();
  for (const window of report.windows) {
    assert.ok(['word', 'excel', 'powerpoint'].includes(window.kind));
    assert.ok(window.windowId.startsWith(report.workerId + ':window:'));
    assert.ok(report.instances.some((i: any) => i.processId === window.processId && i.status === 'VERIFIED'));
    assert.match(window.instanceId, /^\d+:\d+$/);
    if (window.applicationAccessible) assert.ok(window.applicationId.startsWith(report.workerId + ':application:'));
    if (window.status === 'document-accessible') {
      assert.ok(window.documentId.startsWith(report.workerId + ':document:'));
      for (const field of ['name', 'fullName', 'path']) assert.equal(typeof window[field], 'string');
    }
    for (const evidence of window.evidence) {
      assert.match(evidence.topLevelHwnd, /^0x[0-9A-F]+$/);
      assert.match(evidence.paneHwnd, /^0x[0-9A-F]+$/);
      assert.ok(!panes.has(evidence.paneHwnd)); panes.add(evidence.paneHwnd);
      assert.equal(typeof evidence.topLevelVisible, 'boolean');
      assert.equal(typeof evidence.topLevelMinimized, 'boolean');
    }
  }
  t.diagnostic(JSON.stringify({ accessible: report.windows.map((w: any) => ({ kind: w.kind, status: w.status,
    applicationAccessible: w.applicationAccessible })), instances: report.instances.length,
    diagnostics: report.diagnostics.map((d: any) => d.code), truncated: report.truncated }));
});

test('small enumeration budget explicitly reports an incomplete snapshot', windows, () => {
  const result = run(['-File', scriptPath, '-MaxTopLevels', '1']);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.ok(report.topLevelsVisited <= 1);
  assert.equal(report.truncated, true);
  assert.ok(report.diagnostics.some((d: any) => d.code === 'ENUMERATION_INCOMPLETE'));
});
