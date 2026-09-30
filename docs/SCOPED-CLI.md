# Scoped document-tool CLI (development source)

Run from the workbench checkout with its existing Node 24 and installed dependencies:

```powershell
node --import tsx apps/cli/scoped.ts --help
node --import tsx apps/cli/scoped.ts capabilities
'{"action":"help"}' | node --import tsx apps/cli/scoped.ts live
'{"action":"help","operation":"format-selection"}' | node --import tsx apps/cli/scoped.ts live
'{"action":"list"}' | node --import tsx apps/cli/scoped.ts file
'{"sheet":"Sheet1","range":"A1:D12"}' | node --import tsx apps/cli/scoped.ts read-range
```

The launching agent must already receive the same three scoped environment fields
as MCP: `WORKBENCH_URL`, `WORKBENCH_TOOL_TOKEN`, `WORKBENCH_CA`. Supply only a
conversation/document tool grant, never UI admin credentials. This CLI neither
mints grants nor reads `.local/config.json`, and does not export credentials.
The server authenticates the grant and enforces its bound document, conversation,
capabilities and operation journal. The client cannot identify an opaque token's
role offline; passing an admin token is not supported.

URL spelling must be exactly `https://localhost` or `https://127.0.0.1`, optionally
followed by a port from 1 to 65535. No slash (even trailing), userinfo, path, query,
fragment, whitespace, alternate IP spelling or remote hostname is accepted.
`WORKBENCH_CA` is an absolute path to an explicit PEM/DER X.509 certificate,
at most 64 KiB, normalized like MCP. TLS certificate/hostname verification remains
enabled. Use the hostname covered by the certificate; no insecure override exists.

## Commands and shared backend

| CLI command | MCP tool | POST route |
| --- | --- | --- |
| capabilities | MCP startup discovery | /tools/capabilities |
| live | office_live (default compact surface) | /tools/live |
| target | office_target | /tools/target |
| shapes | office_inspect_slide | /tools/shapes |
| layout-selection | office_layout_selection | /tools/layout-selection |
| read-range | office_read_range | /tools/read |
| write-range | office_write_range | /tools/write |
| file | office_file | /tools/file |
| read-text | office_read_text | /tools/read-text |
| write-text | office_write_text | /tools/write-text |
| write-selection | office_write_selection | /tools/write-selection |
| replace-selection | office_replace_selection | /tools/replace-selection |
| format-selection | office_format_selection | /tools/format-selection |

The individual MCP names in this table are the compatibility surface, enabled
with `WORKBENCH_TOOL_SURFACE=legacy` in that scoped MCP launch environment.
Default MCP exposes `office_live` for current-document operations and `office_file`
for working-copy tasks. Existing CLI commands and backend routes remain supported.
`live` accepts action `help` (optional operation) or `execute` (operation and params).
Help is scoped to the bound application/capabilities; execution normalizes to the
same existing handler BEFORE selection-lock checks, so it cannot bypass a frozen
reference or acquire admin permissions. It does not accept arbitrary routes/COM.

Commands take a JSON object on UTF-8 stdin (optional `-`) or `--json <object>`.
Prefer stdin to avoid document content in process arguments. `capabilities` with
no input flag sends `{}`. Other commands require input. A UTF-8 BOM is accepted;
input is limited to 1 MiB, responses to 8 MiB, and each request to 90 seconds.
There is no generic route, admin/config command, upload/download, shell, local
OfficeCLI execution, global installation, hook or configuration mutation.

Payloads are forwarded to the existing MCP backend, not a second document engine.
`target` resolves an explicit Word text, Excel address or PPT slide/object without
moving the Office selection. Ambiguous results do not create an editing reference;
choose only after the user's intent identifies a candidate. Selected-message
restrictions forbid retargeting through this command.
Use MCP's documented payload fields; the backend validates schemas and scope.
Read before writes, preserve `expectedRevision`, use a stable unique `operationId`,
and pass the frozen `selectionId` explicitly for selection edits. Conflicts require
rereading; unknown outcomes require inspection. Never retarget or retry blindly.
The CLI performs one request, without retries or redirect following.

Success writes one JSON value to stdout (exit 0); failure writes a sanitized JSON
error to stderr (exit 1). Non-2xx responses suppress server details. Known token
occurrences and credential-named fields are redacted, including nested values and
keys. Redaction is not a general document DLP filter: arbitrary unknown secrets
in document text cannot be identified. Do not log untrusted document output.

## Verification and scope

```powershell
node --import tsx --test tests/scoped-cli.test.ts
npm run check
```

Tests use injected transport, a temporary public CA fixture, entrypoint subprocesses,
and an isolated local stalled-TLS socket. They do not touch live documents, call
models, read admin configuration or restart services. Real Office acceptance and
live certificate/grant authorization remain separate integration checks. This is
source-only; the existing admin CLI and package scripts are unchanged.
