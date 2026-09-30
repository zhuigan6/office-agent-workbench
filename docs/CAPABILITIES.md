# Capability and acceptance ledger

Release decision update: unfinished large blocks are deferred under the user's
2026-09-30 authorization. See RELEASE-SCOPE.md for the current first public preview
scope; original first-release blocker language below is retained as roadmap context.

Confirmed first-release blockers: selection/caret-driven native rich editing,
correct independent Office instance binding, Codex CLI dual-entry
public conversation continuity, and maintenance/acceptance. See AGENT-INTEGRATION.md.
Existing tests/candidate packages do NOT satisfy these gates yet. Macros/OCR/user
PPT Skills are second-release work, not first-release blockers.
Claude independent-session adaptation is also second-release work by the user's
2026-09-30 decision. Existing managed Claude/MCP behavior remains available.

This is an alpha implementation, not the finished Office platform. A successful
greeting proves only model connectivity. The user explicitly retired the add-in
route: standalone windows and native Windows Office attachment replace Office.js.
The remaining product requirements from the planning package still apply.
The four top-level release workstreams and responsibilities are consolidated in
READINESS.md; architectural reconciliation is in ARCHITECTURE.md. Historical
evidence is not a fresh-runtime claim made by this planning review.

| Requirement | Implementation / evidence | Remaining work |
| --- | --- | --- |
| Original Claude functionality | Reference and existing 8787 compatibility gateway retained | Own equivalent workflow coverage, not a proprietary frontend clone |
| Shared conversation | Shared persisted UI/CLI history, request receipt replay, concurrent-send guards; 205-message paging UI and refresh test | Broader interrupted-turn and cross-device cases |
| Agent and model choice | DeepSeek/AionCore, native Claude Code and Codex; both native agents completed scoped MCP lists with one-time approval. OpenAI streaming protocol fixture passed | Other runners and real direct supplier credentials; installed does not mean tested |
| Per-conversation settings | Advertised model/thinking controls, idle-only updates, observed confirmation; actual Codex model change/read-back/restore passed; permission modes rejected | Thinking current value may be unreported; per-provider reasoning semantics are not interchangeable |
| Excel live edits | Native bounded values/formulas/formats, revision/read-back, guarded recovery with duplicate receipt verified | Rich operations and broader protected-sheet acceptance |
| Frozen selection to chat | Captured target/version, UI citation and actual selected edits; persistent server guard rejects legacy-write and retarget bypasses for selected turns | Broader object-family, instance and restart acceptance |
| Word selected character formatting | Fixed body range bold/italic/size, per-character before state, conflict checks and guarded restore; real model/UI four-character edit and semantic-fingerprint restoration verified | Paragraph/table/image operations, tracked/protected/story cases; property restoration does not universally preserve inherited-vs-direct markup |
| Word paragraph formatting | Font plus alignment, spacing, indentation and keep flags on1..20 complete body paragraphs/up to2000 characters. Single/two-paragraph real native readback, untouched neighbor, stale refusal and full-paragraph XML restoration passed | Lists/tables/embedded/tracked/protected content and partial paragraph expansion deliberately refused; broader complex-document acceptance remains |
| Compact live tool surface | Default MCP exposes office_live plus office_file; operation-specific help and scoped CLI live share the existing routes/selection guards. Real MCP discovery, paragraph edit and recovery passed; legacy naming is opt-in | This consolidates calls, not missing object operations; no general token/cost advantage inferred from schema bytes |
| Word selected text replacement | Single-body-paragraph bounded splices preserve unchanged runs; changed text inherits local font. Real model/UI Nati to Sample and restoration verified against original selected/paragraph fingerprints; native mixed-run test passed | Multi-paragraph, structural/table/object/field/revision cases; restoration locks whole containing paragraph, not merely the selected substring |
| PPT selected character formatting and geometry | Captured text shape/range and stable COM window identity; font readback/restoration plus single nongroup shape geometry edit/readback/recovery verified | Selected text replacement, richer layouts, grouped shapes and slide-range operations |
| Scoped external-agent CLI | Same supported document routes and task grant as MCP, including explicit targets and PPT geometry; no admin-config fallback; real read/admin-denial evidence | Opt-in setup/Skills distribution and external native session synchronization are separate remaining tasks |
| Experimental direct Codex sessions | Private real queue/same-server resume; public events, two-window replies, persisted receipts and Workbench CLI reads verified | Document tools absent; arbitrary native-TUI attachment and offline continuation unimplemented; consolidate with ACP/Core before expanding |
| Real Excel acceptance | Native fixture read/write, formulas, number formats, stale-write rejection and restore recorded by Verify-NativeOffice.ts | Broader workbook cases and full recovery suite |
| Snapshot with unsaved edits | Excel/PPT unsaved markers appeared in snapshots. Standard DOCX Word memory snapshot now preserves an unsaved marker and opens in real Word read-only; recovery and original disk hashes verified | Larger/complex files and macro-enabled formats; no autosave or universal fidelity claim |
| OfficeCLI | Pinned engine; styles/tables/formulas/charts/PPT pictures, scoped assets, versioned copies, template merge, CSV/TSV/locale imports and legacy newline replay verified | Broader rich workflows; deliberate lifecycle/Word refresh restrictions |
| Word and PowerPoint | Native paragraph/text-box read/write, conflict and guarded restore; original-text restoration verified | Rich content edits and complete complex file workflows |
| Attachments and pictures | Actual PNG/JPEG visual answers and TXT marker read-back; bounded PDF.js text reader verified through UI and native Claude, excessive pages rejected | Scanned PDF/OCR, visual PDF layout and other models |
| External agents | CLI reads existing chats; scoped MCP export and bound Word read verified; UI access denied to tool credentials | Runner-specific registration and whole-chat event adapters |
| History and context | Codex compact retained history; Claude compression remains unverified. UI/CLI share bounded read-only canonical/Claude/Codex archives; paging, dedup and export verified | Native branch/resume semantics and other formats; imported archive is not a resumed agent |
| Product interface | Standalone views, Markdown, approvals; per-task tab drafts survive reload; second window shows same chat/tool history | Cross-tab draft policy, long-history UX, full visual/accessibility acceptance |
| Upstream upgrades | Private verified binaries, manifests/notices, offline program upgrade/rollback tested with config retained | Final artifact refresh and expanded compatibility matrix |
| Long-lived installation | Login task, five-minute trigger, actual start/stop/crash recovery; isolated bundled startup, renewal and ownership-checked idle hang recovery passed | Fresh-login/clean-machine tests; unattended certificate renewal |
| Performance advantage | Four alternating pairs per format,24 engine executions passed; slightly slower medians. Narrow DeepSeek Word table pilot reports tokens/failures; see BENCHMARK.md | Broader matched agent tasks and real billing; no general speed/cost superiority demonstrated |
| Public release | Local development branch only | Complete release gates, secret review, new repository and verified package |

## Release rule

Do not advertise "all OfficeCLI functions", "all Claude features", "all models",
or lower cost until the corresponding cases have executable evidence. Unsupported
capabilities must be explicit, never simulated behind a successful status badge.

## Next gates

Local service recovery, multi-window history, three-format native fixtures,
model file creation, PNG/JPEG/TXT/PDF acceptance and isolated upgrade/rollback
now have evidence. Next: final refreshed package verification, remaining complex
document cases, native-agent controls and measured comparative performance.
Keep evidence from the retired add-in separately labelled; it is not native COM
acceptance. No public release until outstanding gates are resolved or explicitly
excluded from the documented first-release scope.
