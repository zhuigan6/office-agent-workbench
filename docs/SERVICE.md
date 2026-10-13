# Windows Login Service

These scripts supervise the **standalone** Workbench in the current Windows
user's interactive login session. They do not install or use Office add-ins.
This is a user Scheduled Task, not a Windows service and not pre-login startup.
Desktop Office COM needs the same signed-in user and installed desktop Office.
Keep the checkout, its `.local` data, trusted localhost certificate, runtime
binaries and user environment available to that user at the same paths.

## Prerequisites

- Windows PowerShell 5.1 with the ScheduledTasks module, under normal execution
  policy. No elevation, stored login password, policy bypass, VBS, encoded command
  or antivirus changes are used. If policy prevents execution, stop and resolve
  it through the machine's approved policy; these scripts do not work around it.
- Bundled `runtime\node\node.exe` is preferred, then Node 24 at
  `D:\node\node.exe`; otherwise an actual `node.exe`
  application on PATH is resolved and version-checked. No npm/tsx command shim.
- Root `package.json` must identify the module package `office-agent-workbench`.
  `dist/index.html`, `apps/local-host/main.ts`, and
  `node_modules/tsx/dist/loader.mjs` must exist. Build the frontend first.
- Existing `.local/config.json` must contain valid distinct `port`/`corePort`
  (normally 18443/18444), absolute existing `aioncore`/`officecli` binaries,
  `uiToken`, `coreSecret`, `pfxPassword`, and `certificateThumbprint`.
  Scripts do not print these secrets or create/change this configuration.
- `.local/server.pfx` must contain the configured valid localhost certificate
  and private key. That certificate must already be trusted in
  the current user's Windows Root store; preflight queries the OS store directly
  and does not depend on PowerShell's optional `Cert:` drive. It does not import
  certificates or keys.
- `WORKBENCH_DATA_DIR` must be unset or name this root's `.local`. Scheduled tasks
  inherit the login environment, not transient variables from an interactive
  shell. Do not depend on shell-profile variables or relative data paths.

## Register And Take Over

Run from a normal PowerShell session as the intended Office user:

```powershell
Set-Location 'E:\ClaudeOfficeGateway-source\workbench'
.\scripts\Install-Service.ps1 -RegisterOnly
# Parent/operator gracefully stops the existing development host here.
.\scripts\Install-Service.ps1
```

`-RegisterOnly` registers the task **disabled** and does not launch anything;
neither the logon trigger nor the watchdog can race the developer's takeover.
It does not stop an already-running task/server. Normal installation enables
the task, starts it and polls readiness for up to 90 seconds. A timeout is a
failure, not a readiness claim; the registered task may still be running.

The exact task is `\Office Agent Workbench`. It uses current-user
InteractiveToken / LeastPrivilege (PowerShell Interactive / Limited), an
AtLogon trigger and a separate indefinite five-minute repeat watchdog. It
ignores overlapping instances, retries failures three times at one-minute
intervals, allows batteries and has no execution time limit. See Microsoft's
[repetition schema](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-repetition-triggerbasetype-element)
and [restart-on-failure schema](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-restartonfailure-settingstype-element).
The watchdog retries a stopped process; it does not forcibly restart a hung
process. The host exits with failure when its owned core exits or initial core
startup fails, allowing Task Scheduler to restart it. A reused external core or
an unresponsive process is not force-killed by this mechanism.

Task action uses Windows PowerShell with exactly:

```text
-NoProfile -NonInteractive -WindowStyle Hidden -File "<root>\scripts\Start-Service.ps1"
```

The supervisor resolves the real Node executable and waits on a hidden
`Start-Process -Wait -PassThru` child, using the root as working directory and
`--import "file:///<root>/node_modules/tsx/dist/loader.mjs" "<root>\apps\local-host\main.ts"`.
The child exit code is propagated for Task Scheduler retry handling.

Health is accepted only with trusted HTTPS, `mode: "standalone"`, boolean
`coreReady: true`, and a reported Node PID which owns the listener and whose
command line contains this root's absolute host entry point. A ready host is a
no-op, not a second server.
Startup/installation refuses an unknown listener, starting/unready host, wrong
root/mode, or occupied core port, never killing it. Stop can request graceful
shutdown of a verified same-root standalone host even when its core is unready.
A legacy dev command using a relative host path
will not prove root ownership: stop it explicitly before registration if refused.
There remains a small port-binding race against unrelated external processes;
these scripts never resolve that race by killing the port owner.

Updating an existing task requires its exact task path/name, description,
single action, arguments, working directory, user and limited interactive
principal to match. An unrelated same-name task is refused. Before updating an
owned task, its exported XML is saved to a unique exact path printed as:
`.local/service/task-before-<timestamp>-<GUID>.xml`. Keep this backup for manual
Task Scheduler XML restoration after checking ownership. No auto-delete or
uninstall is performed.

## Stop And Resume

```powershell
.\scripts\Stop-Service.ps1
# Later, enable the watchdog and start again:
.\scripts\Install-Service.ps1
```

Stop verifies task and host ownership before disabling the task, then sends
`POST https://localhost:<port>/api/admin/shutdown` with the private bearer token.
Normal TLS validation stays enabled; redirects are not followed. The parent
host must reject active turns/writes with HTTP 409 and return JSON
`{ "stopping": true }` only when graceful core/helper/server shutdown is accepted.

If the endpoint rejects, times out or returns an invalid response, the prior
enabled state is restored (an originally disabled task stays disabled). A
timeout has an uncertain server outcome: check health before retrying. After
acceptance the task stays disabled, so the watchdog cannot undo manual stop.
The script waits up to 60 seconds for both host/core listeners to close before
stopping only the verified owned task wrapper. On timeout it leaves the task
disabled and does not force-kill Node, core, helpers or Office. An absent or
unverified host is refused without task mutation. This script is not a general
process cleanup tool.

## Logs And Verification

Each launched invocation gets timestamp-and-GUID stdout/stderr files in ignored
`.local/service`; active logs are never reused/truncated by the next invocation.
No automatic rotation/deletion is performed. Treat runtime logs and exported
task XML as private local diagnostics; application output can contain user data.
Top-level script failures use generic messages to avoid dumping secret-bearing
configuration/HTTP exception records. Check task LastTaskResult, prerequisites,
private logs and trusted `/health` when troubleshooting; registration alone is
not proof of readiness or working Office automation.

Focused tests (no registration, host start/stop, configuration or trust changes):

```powershell
& 'D:\node\node.exe' --import ./node_modules/tsx/dist/loader.mjs --test tests/service-scripts.test.ts
```

The tests check the Windows PowerShell parser, BOM, task XML and mocked startup,
ownership, shutdown and log behavior. Local real registration, graceful cleanup,
crash recovery and native Office read/write acceptance have also been performed.
Fresh login, battery transitions and a second clean Windows machine remain
separate acceptance cases. Packages include the pinned engines, Node and `tsx`;
see INSTALLATION.md for isolated startup, offline upgrade and rollback. A local
package test is not a GitHub publication or a clean-machine guarantee.

Native Codex setup errors now report a setup phase plus bounded startup state,
transport failure category and classified stderr hints, not raw stderr/credentials.
Document-bound child servers read effective MCP configuration, disable inherited
configured servers using per-entry native overrides, retain the document relay,
then verify effective enable flags. An empty `mcp_servers={}` override does NOT
remove inherited entries and must not be used as an isolation claim. This changes
only owned child processes, not the user's CLI home/config/account or ordinary CLI.
Unsafe native override names/missing configuration fail explicitly. This is MCP
configuration scoping, not a claim of sandboxing every builtin or plugin capability.
Do not replay uncertain setup/document requests or call a few successful resumes
proof of long-term reliability.

On this machine repeated triggers while the verified instance is running can
leave LastTaskResult=0x800710E0 even though the same supervisor/host PID remains
healthy. The configured MultipleInstances policy is IgnoreNew. Do not classify
the code alone as success or failure: correlate running task EnginePID, owned
host process, health and private logs. Operational task history may be disabled;
in that case the specific scheduler cause is not established by a code alone.
Do not switch to Parallel/StopExisting or administrator privileges just to clear
the result. Reference: [Microsoft instance policy](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/ne-taskschd-task_instances_policy).
