# Agent entrypoints and first-release implementation plan

Decision update: 2026-09-29. These are REQUIRED workstreams, not optional scope
cuts. Existing candidate packages predate completion of these requirements.

USER DECISION, 2026-09-30: Claude independent-session adaptation is SECOND RELEASE.
Preserve existing managed Claude/MCP features, but do not implement new Claude
native session hooks/channels now. Codex continuity and native Office editing
remain first-release work. This supersedes older combined Codex/Claude gates.

Planning reconciliation 2026-09-30: READINESS.md is the authoritative four-group
release map; ARCHITECTURE.md records the implementation corrections. The direct
Codex manager/pane is a bounded experiment with retained history. Its public
chat/API/Workbench-CLI evidence does not prove native-TUI attachment, document-tool
integration or production continuation after restart. Further protocol expansion
requires a demonstrated gap in maintained ACP/Core behavior. Keep current data
and working paths while deciding consolidation; no automatic migration is approved.

## Reuse-first agent integration decision

New runners should first use AionCore's existing ACP integration and maintained
upstream adapters, not a separate custom runtime/protocol/UI for each vendor.
The maintained [codex-acp](https://github.com/agentclientprotocol/codex-acp) wraps
Codex App Server and maps its events, permissions, usage and configuration to ACP.
It ships a compatible Codex dependency and supports an explicit CODEX_PATH override.
The maintained [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)
uses the official Claude Agent SDK. These are reuse candidates, not newly installed
or locally accepted dependencies. Prefer tagged releases over preview packages.

The [ACP registry](https://github.com/agentclientprotocol/registry) is discovery
metadata, not authority to install or execute arbitrary packages. Pin exact adapter
versions, license/source and runtime identity; capability-negotiate images, load,
permissions and settings. According to the [session protocol](https://agentclientprotocol.com/protocol/v1/session-setup),
session/load requires an advertised loadSession capability. A new adapter therefore
normally needs configuration and the shared acceptance suite, not a new engine.
Provider differences and unsupported capabilities remain explicit.

Keep a narrow native escape hatch only where ACP/AionCore cannot preserve a
required operation (for example same-live-server attachment or queue semantics).
The existing Codex native-session work is such a bounded experiment; it must not
grow into a parallel replacement for all upstream agent functionality. Session
history/ownership/document scopes are Workbench concerns shared by transports.
No scraping arbitrary transcript files or silently changing native global hooks.

First-release work is agent-owned implementation, local/packaged acceptance and
release preparation. User participation is limited to personal authorization,
second-machine availability and final usage acceptance. A privately shared
pre-release installer can support second-machine testing BEFORE public GitHub release.
Second release adds Claude independent continuity and user macros/OCR/PPT Skills.

## Native Codex transport evidence, 2026-09-30

Refresh acceptance: installed0.159.2 also passed the actual queue, public events,
completed receipt and same-server same-ID resume probe at
`.local/verification/codex-rpc-1790748691382/report.json`.
Fresh schema evidence is in `codex-compatibility-77Q545`. The tested baseline is
now0.159.2; older or newer versions still need their own matching evidence.
Claude Code2.1.285 is observed installed, not newly accepted for independent
continuity; that work remains in release2. These checks do not prove native TUI
attachment or document tools in the experimental native chat pane.

Installed Codex 0.157.0 exports its actual protocol through
`app-server generate-json-schema --experimental`. The version-specific snapshot
is private verification material, not a vendored fork or a global configuration.

The new native-sessions modules provide bounded newline RPC, public event
projection, persistent links/owner epochs/message receipts, and a linked Codex
session using `thread/queue/add` with a stable `clientUserMessageId`. Queueing avoids
using `turn/start` to steer an already active shared native turn. Unknown dispatches
are never automatically retried; handoff cannot rewrite an older dispatch epoch.
Approvals require an explicit handler; absent handlers reject rather than consent.
Only allowlisted public messages and tool events are journalled. This is not a
guarantee that arbitrary free-text tool output contains no sensitive information.

Real isolated acceptance:
`.local/verification/codex-rpc-1790735621024/report.json` verifies initialization,
model list, owned new-thread attachment, queue acceptance, the exact requested
reply, public turn/user/assistant events, completion and same-ID resume on the
same server. No tools, user-history reads or global configuration changes occurred;
the owned test process exited. A private SQLite journal preserves the evidence.

Important lifecycle correction: in this installation, resuming a just-created
zero-turn thread returned "not found". Use the trusted thread/start acknowledgement
for the owned new thread, not a speculative resume. After its first completed turn,
same-server resume succeeded. Failed probes are retained.

Still outstanding: authenticated shared-server/terminal transport on Windows,
Workbench API/UI integration and actual two-entry acceptance; Claude's corresponding
public event/continuation adapter. A successful private stdio test does not prove
attachment to an independently running TUI or every desktop product.

## Evidence and transport choice

OfficeCLI provides a command-line executable, agent Skills and a built-in MCP
server. Its current wiki describes one command-oriented MCP tool forwarding to
the CLI engine. This is not an Office task-pane plugin dependency. Wiki examples
can differ from the pinned binary; verify commands against our locked version.

Use CLI plus lazily loaded Skills for terminal-capable agents, MCP for clients
needing a standard tool connection. Both must reach the SAME Workbench document
broker, scoped credentials, immutable target references and operation journal.
Do not give external agents the UI administrator token merely to simplify CLI
setup. Admin CLI uses local UI credentials; the separate scoped agent CLI now
exists at apps/cli/scoped.ts and passed a real task-grant read/admin-denial check.
See SCOPED-CLI.md. This does not by itself implement external chat synchronization.

MCP is not inherently expensive. Schema volume, result size, repeated context
and tool round trips drive model cost. Return compact structured results, cache
stable help, load format/scene instructions only when needed, and batch local
operations. Preserve detailed local evidence without sending it all to the model.
Never substitute unrestricted eval/shell or disabled approvals for optimization.

Chat/session synchronization is a SEPARATE adapter concern. Prefer the installed
agent's supported session/event/resume APIs; use ACP where actually advertised,
provider-native protocols otherwise. Workbench-managed sessions are not proof
that independently opened native sessions already synchronize bidirectionally.
Do not write vendor transcript databases or poll private files as a universal API.

Concrete investigation targets: Codex App Server thread/event/resume interfaces
(already used by our local protocol probe), and Claude Agent SDK session/streaming
interfaces. A documented session resume interface is NOT proof of attaching to an
already-running independent terminal. Verify exclusive execution ownership and
native entrypoint support before promising bidirectional control. If optional
documented hooks are needed for an independent native entrypoint, offer explicit
project-local opt-in; never install global hooks silently or depend on screen scraping.

## First-release gates (not negotiable omissions)

1. Capture current selection/caret in the explicitly bound Office document.
   UI shows the cited region, host/window identity and a bounded content preview.
2. On send, freeze document/instance/session, target anchor and content version.
   A later selection/window change must not retarget an in-flight operation.
3. Without a selection, resolve user-described locations from bounded structure;
   show ambiguity rather than guessing. Support common native rich edits, not
   only plain paragraph replacement or a file-copy surrogate.
4. Read back native results, retain format/neighbor checks and guarded restoration.
   Cover unsaved content, tables, grouped objects, protected ranges, track changes,
   hidden sheets/slides, document closure, same-name files and concurrent edits.
5. Discover accessible independent Office instances with explicit identity; report
   inaccessible instances and never fall back to an unrelated open document.
6. Codex CLI: Workbench entry and separately launched agent entry,
   linked public messages/tool events/results, explicit continuation and one writer
   per session. Other agents follow with separate capability matrices.
7. Automatic certificate lifecycle design, restart/sleep recovery, data-preserving
   upgrade and final frozen-package acceptance. Do not bypass trust prompts.
8. Compare identical real tasks and models for correctness, editability, latency,
   tokens, retries and cost. No universal superiority claim before evidence.

## Concrete development order

A. Typed selection snapshots and immutable capture IDs; read-only native probes.
B. Bound selection UI + send-time context + tools using frozen targets, not live
   Application.Selection at execution time. Fail closed on drift or host restart.
C. Rich native operation adapters, per-kind verification/restore, then multi-instance
   discovery. Selection text in tables/headers/group shapes must retain its story
   or object context; never coerce it to a whole paragraph silently.
D. Scoped CLI/MCP parity and opt-in project-local Skills setup, no global settings
   installation without consent. One implementation under all entrypoints.
E. Codex session continuity with public event IDs, replay cursors,
   approvals and an execution-owner lease. Unsupported native resume is explicit.
F. Integrated scenarios, maintenance and final package. Packaging is secondary to
   these first-release gates, not a replacement for them.

Macros, OCR and user-supplied PPT Skills are explicitly SECOND RELEASE. Repository
working name: office-agent-workbench; agent handles naming/availability and open
source preparation. Publication follows final joint acceptance, not this research.

## Sources and interpretation

### Native Codex feasibility evidence, 2026-09-30

`codex-remote-1790758982857` passed using the original Codex0.159.2 TUI and
an independent Workbench RPC connection to the same authenticated loopback server.
The terminal resumed the owned thread with history, submitted a new public reply
observed by the RPC connection, displayed the reverse reply, and exited cleanly.
Server-side read-only permissions were verified. The client used an isolated
CODEX_HOME; primary configuration was unchanged and owned processes stopped.

This establishes native-terminal feasibility, not production UI/document parity.
The production manager's stdio transport, scoped document tools, ownership and
disconnect/restart integration are still pending. Do not call the full dual-entry
feature complete. Remote resume rejects permission overrides on the TUI command;
set and verify them on the owned server instead. A previous account/read workspace
routing timeout (-32603) was observed, and a later run succeeded; availability
must be handled explicitly rather than described as an unsupported feature.

The later `managed-native-shared-1790760289912` probe exercised the production
Workbench pane and the original TUI: UI-to-terminal, terminal-to-UI, then another
UI reply appeared in both entries. UI refresh retained all three; `/quit` left the
owned backend alive and idle close retained history. NativeSessions now uses the
shared transport for new links; old offline links are not migrated or replaced.
Only authenticated UI access can issue the RAM-only terminal capability. The
capability is scoped to one owned app server, but is not a method-restricted
document credential. No scoped tool credential can access that management API.
Document-tool binding and restart/ownership reconciliation remain incomplete.

- [OfficeCLI MCP](https://github.com/iOfficeAI/OfficeCLI/wiki/command-mcp)
- [OfficeCLI Skills](https://github.com/iOfficeAI/OfficeCLI/wiki/command-skills)
- [Anthropic MCP context engineering](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [ACP session capabilities](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/draft/session-setup.mdx)
- [Codex App Server](https://developers.openai.com/codex/app-server/)
- [Claude Agent SDK sessions](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Word Selection](https://learn.microsoft.com/en-us/office/vba/api/word.selection)
- [Excel Selection](https://learn.microsoft.com/en-us/office/vba/api/excel.application.selection)
- [PowerPoint Selection](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.selection)

Community threads on dynamic MCP loading were reviewed as inspiration, not
benchmarks or security authority. Their advertised savings do not establish ours.
Official product behavior does not reveal Anthropic's proprietary implementation.
