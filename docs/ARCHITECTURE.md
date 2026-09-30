# Standalone architecture

The confirmed first-release selection/native editing and agent entrypoint gates
are specified in AGENT-INTEGRATION.md. CLI and MCP share one document broker;
session protocols, not MCP alone, carry full public chat continuity.

Windows first, one local HTTPS host and shared SQLite-backed state. This is not
a hosted service or Office add-in. Native agents and Office run in the current
user session. User-selected native applications remain open when Workbench stops.

## Modules and ownership

- apps/workbench: React renderer for tasks, approvals, files, archives and settings.
- apps/local-host: loopback HTTPS/WebSocket endpoints, authentication and lifecycle.
- packages/aioncore-adapter: original pinned agent backend and provider adapters.
- packages/officecli-adapter: original pinned document executable with bounded I/O.
- packages/document-workspace: scoped files, versioned copies, operation journals,
  idempotent message dispatch, archives and guarded live-edit restoration.
- packages/native-office: Windows COM helper, bounded reads/writes/snapshots of
  explicitly selected open documents. No general shell interface or autosave.
- apps/cli and local-host/mcp.ts: clients of the SAME backend, not separate chats.
- packages/distribution: pristine-package verification, offline upgrade and rollback.

## Data and concurrency

AionCore owns active agent conversations. Workbench owns document bindings,
file ancestry, request receipts, operation before/after evidence and read-only
history archives. Archives do not restore an agent runtime or native branch graph.
All persisted data lives under private .local, excluded from source/distribution.

Repeated accepted message IDs return receipts; ambiguous requests are not retried
automatically. Live edits compare target revisions, record the before-state and
read back results. Conflicts and unknown outcomes never mean success. Restoration
uses the exact post-edit revision. COM operations are optimistic, not a universal
transaction across applications. File engine operations produce new copies.

## Upgrade seams

Upstream programs remain original binaries, pinned with hashes in upstreams.lock.
Adapt protocol differences inside adapters; do not patch the upstream source or
fork a whole renderer without a documented need. AionUi is presently a reference,
not a bundled frontend. The Anthropic frontend is neither copied nor redistributed.

Change one upstream component at a time, with protocol tests, actual agent calls,
document read-back, package integrity and rollback acceptance. Document selected
capabilities rather than inventing a universal model/Office feature promise.
Native agent permissions, login, global hooks and their own tools stay outside
Workbench's scoped MCP boundary. See SECURITY.md and UPSTREAM-CAPABILITIES.md.

## Delivery boundary

Build-Source.ts exports a reviewed standalone source candidate; no Git init,
remote, commit, tag or publication is performed. Build-Package.ts produces a
separate Windows runtime candidate. Neither should copy an initialized .local.
The legacy8787 gateway is optional and remains independently managed.

## Reuse review, 2026-09-30

Before extending a major subsystem, check the pinned upstream implementation,
maintained adapters and released APIs; record a concrete missing capability before
writing an alternative. Passing our tests is not a reason to maintain a duplicate.

| Area | Decision | Workbench-specific work |
| --- | --- | --- |
| Agent protocols | Default to AionCore ACP and maintained upstream adapters; see AGENT-INTEGRATION.md | Document/session association, capability acceptance and owner fences |
| Native Codex driver | Keep bounded prototype/evidence; do not grow a general multi-vendor engine | Only a proved ACP/Core gap such as same-live-server ownership/queue semantics |
| History, settings, attachments and compaction | Core/native advertised APIs, not a second transcript database or context compactor | Public replay, scopes, unsupported-state presentation and request receipts |
| Office file editing and templates | Original pinned OfficeCLI batch/dump/query/merge/import | Authorized files, immutable versions, asset scopes and verification |
| Repeated static help | Cache original help by engine identity; coalesce requests | Hash validation, memory limits, invalidation and selective fields |
| Preview/UI widgets | Evaluate AionUi components and existing dependencies first | Current Office citation, native-vs-file distinction and recovery UX |
| Open Office editing | Native Office APIs; file preview is not live document state | Window/selection identity, unsaved content, conflicts and restoration |
| Startup/upgrades | Existing supervision and packaging, not another orchestration stack | Separate pins, acceptance, no mid-turn replacement and rollback |

Avoid TUI scraping, proprietary frontend cloning, general remote shell authority,
a second active conversation database and speculative plugin frameworks. Upstream
resident mode is a candidate for isolated working-copy latency, not permission to
open/save live originals; flush/external-change/rollback behavior needs acceptance
before adoption. Existing batch integration already provides a lower-risk seam.

Sources: [Codex ACP](https://github.com/agentclientprotocol/codex-acp),
[Claude ACP](https://github.com/agentclientprotocol/claude-agent-acp),
[ACP capabilities](https://agentclientprotocol.com/protocol/v1/session-setup),
[AionUi](https://github.com/iOfficeAI/AionUi),
[OfficeCLI](https://github.com/iOfficeAI/OfficeCLI).
Research of current main is not acceptance of a new installed release. Preserve
current data/evidence while changing one verified seam at a time.

## Design reconciliation after the morning implementation

The chosen architecture remains one user-facing Office workbench: original
OfficeCLI for file-oriented document work, native Office APIs for the open
document, and existing Core/ACP facilities for ordinary agent sessions. Skills
and models compose supported operations. Workbench supplies binding, selection,
operation evidence, conflict handling and the common interaction flow.

Useful work retained: immutable selection references, identity checks, live
readback/recovery, shared request receipts, original-engine integration, runtime
compatibility probes and the verified UI/CLI paths. The concern is how these
pieces were prioritized and integrated, not that each piece is intrinsically bad.

Specific corrections:

- Feature-by-feature expansion became too close to implementing user scenarios
  individually. Build bounded object/action families (range, paragraph, table,
  slide, shape; inspect/locate/set/insert/remove/batch), using upstream/native
  primitives. Test the execution boundaries and representative compositions,
  rather than coding a separate feature for every natural-language request.
- A universal wrapper does not create missing document capabilities. Renaming
  tools or reducing schema tokens is a small interface improvement, not the next
  milestone unless it directly unblocks an end-to-end editing task. The proposed
  compact/unified tool surface has NOT yet been implemented or accepted.
- The custom Codex manager, journal and separate pane demonstrated protocol
  behavior, but introduced another session ownership/UI path. Freeze expansion
  until comparison with the maintained ACP adapter and pinned Core demonstrates
  which native-only behavior is actually required. Do not silently discard its
  records, replace existing sessions, or market the experiment as the final flow.
- One authoritative execution owner and native session ID must exist for each
  linked conversation. A public event projection is acceptable; independently
  scheduling the same conversation through Core and the custom manager is not.
- Native Office and file engines expose different state. A file snapshot/batch
  result may help perform a task, but cannot be presented as an edit to the open,
  unsaved document. Reuse original engine output where suitable; keep explicit
  native object application/readback for the live route.
- Protection should be proportional and reusable. Focus on wrong-target writes,
  stale state, uncertain dispatch, recoverability and authorized resources. Avoid
  making every simple action a new confirmation dialog or a bespoke framework.
- Probe and regression evidence must roll into a product acceptance matrix.
  Repeat tests when behavior changes or a risk is unresolved, not after every
  prose or label change. Infrastructure polishing must not outrank missing core
  editing behavior; experimental additions should have a clear stop criterion.

Next implementation decision: select one representative complex Office task and
identify the reusable native object operations it requires. Establish its actual
target/readback/recovery boundary, implement that family, and verify the complete
interaction. In parallel where separable, settle Codex integration against Core/ACP
without rewriting their general event, model, attachment and permission machinery.
Only then consolidate tooling/presentation around the proved routes. Keep the four
delivery groups in READINESS.md as the release accounting, with CAPABILITIES.md
tracking actual coverage. A larger rewrite or new generic framework is not implied.

If supported native protocols cannot satisfy the promised independent-terminal
experience, produce the exact capability evidence and workable alternatives before
asking to revise that requirement. Do not quietly substitute our own CLI client.

## Implemented operation-family consolidation, 2026-09-30

`office_live` is the compact discovery/execution entry, not another engine.
Operation-specific help avoids loading every live operation schema on each turn.
The same entry is available to scoped CLI clients. Backend normalization runs
before the existing selection guard, and mutations retain their own typed schemas,
revision checks, serial queues and journals. No generic shell/COM escape or implicit
batch-atomicity claim is added. Legacy MCP names remain opt-in for transition.

The Word range-format family now combines fonts with complete-paragraph alignment,
spacing, indentation and keep flags. Partial paragraph targets are rejected rather
than silently widened. Recovery uses full paragraph XML snapshots, not resetting
numeric values alone, to preserve inherited-versus-direct formatting semantics.
Snapshots include paragraph marks, and restore checks whole-paragraph fingerprints
in addition to the selection revision. Specialized/list/table/embedded content stays
explicitly unsupported until a suitable object-family workflow is implemented.
Representative single/two-paragraph tasks passed real Office and real MCP recovery.
The wrapper itself does not close table/image/chart or Codex dual-entry gaps.
