# Standalone Windows installation and recovery

The standalone application does not require an Office add-in, Visual Studio,
admin elevation, disabled antivirus, or an execution-policy bypass. Desktop
Office is needed only for live documents, not OfficeCLI file-copy operations.

## New installation

1. Extract a trusted Windows x64 package to a permanent current-user directory.
   Do not merge it over another installation or reuse another user's `.local`.
2. From its directory, verify the pristine package before initialization:
   `runtime\node\node.exe --import tsx scripts/Manage-Package.ts verify .`
3. Run `scripts/Initialize-Local.ps1`. It uses bundled engines, creates private
   credentials, restricts `.local` permissions and trusts a localhost certificate
   in the current user's store. It refuses to replace existing configuration.
4. Run `scripts/Install-Service.ps1`, then `scripts/Open-Workbench.ps1`.
5. Select an installed native agent, or configure a provider in Settings.
   CC-Switch through an existing 8787 gateway is optional, not bundled here.

The default ports are 18443/18444. `Initialize-Local.ps1 -Port 18543 -CorePort
18544` supports an isolated instance; both ports must be free. The service task
has a fixed name and ownership checks, so a second installation cannot silently
take over an existing login task. Isolated developer acceptance starts its
launcher directly, without registering a competing task.

Native agents use their existing installation/login and may inherit global
skills/hooks. Presence in the selector is not proof of authentication, quota,
vision, or complete tool support. Do not distribute user agent homes or keys.

## Upgrade

Extract the new package beside, not inside, the installation. Verify it first.
Keep a recoverable copy of private data while the service is stopped, especially
before any future database migration. An upgrade never resets `.local`, chats,
provider settings, pairing tokens or user documents.

1. In the installed directory run `scripts/Stop-Service.ps1`. Active turns or
   writes cause refusal; do not force-kill them or stop the original 8787 task.
2. From the new package directory run:
   `runtime\node\node.exe --import tsx scripts/Manage-Package.ts upgrade . INSTALLATION_PATH`
3. Record the returned backup path. Run the installed `Install-Service.ps1` and
   check the UI, existing history and a real file/read request.

The updater checks the manifest, refuses enabled matching tasks/listeners,
backs up replaced files and records checksums. Unknown files remain untouched.
It is an offline program-file upgrade, not a database migration framework.
Do not start other copies or edit deployed files during the operation.

If acceptance fails, stop the installation and use the new package's command:
`runtime\node\node.exe --import tsx scripts/Manage-Package.ts rollback INSTALLATION_PATH BACKUP_ID`

Rollback restores only journaled files and removes only verified newly installed
files. It refuses to overwrite subsequent edits. Private data is not rolled
back; a future incompatible database change requires a separately tested
migration/restore procedure. Never replace a live SQLite WAL database by copying
only its `.db` file.

## Certificate renewal

While the service is running, `scripts/Renew-Certificate.ps1 -CheckOnly` reports
expiry, localhost/config/public certificate identity and CurrentUser trust. It
does not stop services, import trust, generate a key or change files. A valid
status is not unattended renewal: actual replacement still requires an idle,
offline service and may require the user's trust confirmation.

Certificates are valid for three months. With the service stopped, run
`scripts/Renew-Certificate.ps1`; it renews inside the last 21 days. `-Force` is
for a controlled renewal test. Existing credentials and data stay unchanged;
the PFX, certificate and config are backed up first. Resume the service afterward.
Old trusted certificates are retained for recovery, not silently removed.
This is currently a maintenance command, not unattended certificate rotation.
The running UI warns during the final21 days. It does not silently renew trust.

## Pairing credential rotation

If the local UI credential appears in a diagnostic or is otherwise exposed, stop
the service and run `node --import tsx scripts/Rotate-UiToken.ts` (use bundled
`runtime/node/node.exe` in an installed package). Resume with Install-Service.ps1
and open Open-Workbench.ps1 to reconnect the browser. Only uiToken changes;
model credentials, conversations and scoped MCP grants stay unchanged. The
script refuses active listeners/enabled tasks and keeps a private config backup.
Do not re-enable the old exposed credential by restoring that backup blindly.

## Building without private configuration

After `npm ci`, checks/tests and `npm run build`, run
`node --import tsx scripts/Build-Package.ts NEW_OUTPUT_DIRECTORY`.
Existing developers may use their local configuration as before. Clean builders
can instead provide all three environment variables:
`WORKBENCH_BUILD_AIONCORE`, `WORKBENCH_BUILD_OFFICECLI`,
`WORKBENCH_BUILD_RESOURCES`. Paths are resolved relative to the repository root.
Partial overrides are rejected. Executable hashes must match upstreams.lock.json;
resources must be the original Windows managed Node bundle with no bundled agent
CLIs. Never point resources at a user agent home or provider configuration.

The builder uses explicit source allowlists and creates a fresh destination;
it does not initialize credentials, trust certificates, start services or publish.
Clean-input mode has no local credentials to scan for, so build from a reviewed
clean checkout and keep the artifact secret review as a separate release gate.
This is a configurable build entrypoint, not a claim of byte-reproducible ZIPs
or fully automated upstream-resource acquisition.

## Acceptance evidence

Local isolated-directory startup, actual file creation, upgrade data retention,
program rollback and certificate renewal have dedicated evidence. This is not
a second clean Windows machine or a real reboot test. See CAPABILITIES.md for
remaining gates. No public release or performance superiority is implied.
