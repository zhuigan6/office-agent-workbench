# Standalone Workbench CLI

Native public-session commands share the native-session view's authenticated
backend and never silently create/fork/resume a vendor session:

Authenticated UI readers can request `GET /api/native-sessions/LINK_ID/operations?summary=1`
for20 compact records with `items/nextCursor/hasMore/total`; add `before=OPERATION_ID`
to inspect older records without moving back to newest on refresh. Full same-scope
record: `?operationId=OPERATION_ID`. Default operations list remains compatible.
Foreign document/link IDs and foreign cursors are rejected. Summary paging is not
the uncertainty audit: all scoped unknown/running/recovery outcomes still block
unsafe reconciliation even when they are outside the visible page or global500.

```powershell
node --import tsx apps/cli/main.ts native-sessions
node --import tsx apps/cli/main.ts native-events LINK_ID --after 0
node --import tsx apps/cli/main.ts native-receipts LINK_ID
node --import tsx apps/cli/main.ts native-send LINK_ID "Reply briefly" --request-id YOUR_STABLE_ID
node --import tsx apps/cli/main.ts native-close LINK_ID
```

Native sends need an explicit stable ID. Unknown dispatches are not automatically
retried; active/uncertain requests block close; closed histories remain readable.

File create/batch receipts include bounded upstream batch reads and failure
indices. Reads describe the staged state when each command ran, not a final-file
proof. Failed batches do not publish a copy; identical failed IDs are not rerun.
Full execution evidence remains in the local journal. A task-file result can be
opened by its exact ID from the UI for preview/inspection/validation. Access
credentials issued by POST /api/conversations/ID/access can be revoked by an
authenticated UI-owner DELETE to the same route with {token:THE_EXACT_CREDENTIAL};
the server checks task ownership and never revokes by name or partial token.
The original Codex session can also be attached by the supported native terminal
entry, and a document-bound native session uses the same scoped tools/approval/
selection/recovery layer as the UI. This does not promise arbitrary unrelated CLI
history synchronization. Document-bound owned Codex servers disable inherited
configured MCPs in their child process and verify the allowed Workbench relay;
standalone user CLI/global configuration is not rewritten. Chat-only sessions
retain their normal native configuration. Scope failures do not create a replacement.

The terminal client uses the same HTTPS backend, saved conversations, message
history, and file library as the standalone UI. It does not create an agent or
conversation, start/restart services, launch Office, or execute shell commands.
The backend must already be running. Node 24 and the existing pinned dependencies
are required; no dependency installation is necessary.

Run from the workbench directory:

```powershell
node --import tsx apps/cli/main.ts status
node --import tsx apps/cli/main.ts conversations
node --import tsx apps/cli/main.ts messages CONVERSATION_ID
node --import tsx apps/cli/main.ts messages CONVERSATION_ID --before CURSOR
node --import tsx apps/cli/main.ts send CONVERSATION_ID "Summarize the document"
Get-Content -Raw -Encoding utf8 .\prompt.txt | node --import tsx apps/cli/main.ts send CONVERSATION_ID
node --import tsx apps/cli/main.ts files CONVERSATION_ID
node --import tsx apps/cli/main.ts upload .\report.xlsx CONVERSATION_ID
node --import tsx apps/cli/main.ts send CONVERSATION_ID "Inspect this file" --file FILE_ID
'{"action":"list"}' | node --import tsx apps/cli/main.ts file
node --import tsx apps/cli/main.ts mcp-config CONVERSATION_ID .\my-scoped-mcp.json
```

`files` and `upload` accept an optional conversation. `file` forwards a JSON object
to `/api/file-command`; the server validates the supported document operation.
`send` accepts one quoted message, or reads stdin when omitted or `-`. Repeat
`--request-id YOUR_STABLE_ID` (8-128 letters, digits, underscores or hyphens) when
an external client needs idempotent retries. Keep the same ID and identical
content/attachments for the same logical send; do not generate a new ID after an
ambiguous timeout. Accepted requests replay their receipt without a new model
call; uncertain dispatches require inspecting history, not automatic retries.
Without this flag each CLI invocation is a new intentional message. Repeat
`--file ID` for up to ten attachments. Use `-- "--literal message"` for text that
begins with a dash. Messages are limited to 20,000 characters, stdin to 1 MiB, and
uploads to 32 MiB. Binary uploads are not decoded; names are URL-encoded UTF-8.
Use PowerShell 7 with UTF-8 output encoding for non-ASCII piped text.

## Credentials and output

Connection configuration comes only from `apps/local-host/config.ts:loadConfig`.
The existing `WORKBENCH_DATA_DIR` override is honored by that module; otherwise
it loads `.local/config.json`. The CLI always connects to HTTPS localhost on the
configured port, authenticates with `uiToken`, and converts `.local/server.cer`
from DER using `X509Certificate.toString()`. Certificate/hostname verification is
enabled, redirects are not followed, and no URL or credential CLI flags exist.
The core secret is never sent to the API. Importing the CLI does not run commands
or read configuration. `--help` also works without configuration.

Successful commands print one JSON result to stdout. Failures print a sanitized
JSON error to stderr and exit 1, without raw backend errors or stack traces.
Known local secrets and credential-named fields are redacted from output.
Requests have a 90-second wall-clock deadline and an 8 MiB response cap. There
are no automatic retries: a timeout does not prove that a mutation failed.
Inspect the shared history/files before retrying. A successful `send` acknowledges
submission, not completion of the assistant turn; use `messages` to inspect it.

## Read-only imported archives

`archives` lists the same archives as the UI; `archive SHA256 --offset 50` reads
a bounded page. `import-history PATH` imports an8MiB-or-smaller JSON/JSONL file.
These commands never create agent sessions or replay commands. Canonical,
Claude Code and Codex public-message formats and limitations are in HISTORY.md.

## Scoped MCP access files

`mcp-config` calls `POST /api/conversations/:id/access`, whose backend contract is
`{mcpServers:{"office-workbench":{command,args,env}}}`. The server owns grant issuance
and conversation scoping. The CLI retains only the agreed command, loader args,
`WORKBENCH_URL`, `WORKBENCH_TOOL_TOKEN`, and `WORKBENCH_CA`. It never substitutes the
global UI credential for a scoped token. No grants are reconstructed locally.

The requested output must not exist. Export checks first and writes with `wx`
(exclusive creation), so files, directories, and symlinks are not overwritten,
including a competing writer between the check and write. Parent directories must
already exist. Stdout contains only `{written:true,outputPath}`, never the grant.
The CLI does not modify any agent settings. Treat the exported file as a secret:
keep it out of version control and use a user-private directory. Mode 0600 is
requested, but Windows ACLs are inherited, not rewritten. A failed write after
grant issuance may leave an unused grant or partial new output; inspect rather
than assuming rollback. Existing output is never replaced.

## Integration and focused checks

### Original Codex terminal continuation

New sessions in the native-session pane use an owned authenticated loopback
app server. To open the original installed Codex TUI on that same session, run
from the project directory:

```powershell
& .\scripts\Start-NativeTerminal.ps1 -LinkId '<link ID from the native pane>'
```

Use the Workbench link ID, not an arbitrary vendor session ID. The script obtains
the capability through the existing authenticated local API, keeps it in a
temporary environment variable and restores the previous environment on exit.
No credential is printed, written into the command line or saved in the terminal
home. A private terminal home avoids changing the user's normal Codex config.
Backend credentials expire when that owned server exits; upgraded CLI binaries
must pass a fresh compatibility/continuation check, not attach to an old server
automatically. No TLS trust or execution-policy bypass is used.

Public messages from both entries are journaled in the same link. Exit the terminal
with `/quit` to detach while leaving the backend alive. Closing the Workbench's
idle connection ends that owned server and disconnects attached terminals. Active
or uncertain turns block closing and further Workbench sends. The vendor queue
arbitrates submissions; the UI guard is not a distributed terminal-writer lease.
Old offline links remain readable and are not implicitly replaced/resumed.
In V2 development, choose an existing document task when creating the shared
session: the original scoped MCP tools are available to both entries and requests
wait for per-call approval in the native pane. That pane also displays this
session's edits and guarded recovery. Clean idle close and graceful backend
restart permit explicit "resume original session" with the same vendor ID;
unexpected shutdown/unknown dispatches remain fenced pending reconciliation.
Previously selected tickets are not revived; recapture before a new selected edit.

### Native testing workspace

New native Codex sessions can use an existing directory through optional private
`nativeWorkspace` configuration. Configure it without moving any history:

```powershell
& .\node_modules\.bin\tsx.cmd scripts/Set-NativeWorkspace.ts 'E:\ccOffice测试'
```

The script backs up private configuration and preserves other fields. Restart the
idle Workbench to activate it. Without this option, other installs keep their
per-session private workspace default. Existing links keep their recorded identity;
if Codex's folder UI moved a thread, Workbench refuses to resume with its stale cwd
instead of undoing that move. This machine's development Codex tests use the above
folder; no transcript export, archive cleanup or account-wide home change is needed.

The parent may add `"cli": "tsx apps/cli/main.ts"` to package scripts, enabling
`npm.cmd run cli -- status`. This sidecar deliberately does not edit package.json
or backend entrypoints. Direct invocation works without that script.

```powershell
node --import tsx --test tests/cli.test.ts
```

Tests use injected network transport and local disposable fixtures, not the live
backend. Live scoped-grant authorization, native Office operations, and full UI
integration must be verified by the parent release workflow.
