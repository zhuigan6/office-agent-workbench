# Local review readiness, 2026-09-30

PUBLICATION SCOPE UPDATE: the user subsequently authorized publishing the useful
current preview and deferring unfinished large blocks. RELEASE-SCOPE.md is the
current public release boundary and supersedes the mandatory-first-release gate
language below. The four-workstream map is retained as the development roadmap,
not a claim that every group has shipped.

## Authoritative first-release work map

The remaining work is organized into FOUR top-level workstreams. These are
delivery groups, not four small patches or a claim that every future defect is
already known. Existing first-release obligations must map into these groups;
do not silently introduce a fifth feature project, or drop a requirement by
renaming a group. This map consolidates, rather than replaces, the original goals.

| Workstream | Remaining delivery | Completion evidence |
| --- | --- | --- |
| 1. Current-document editing and document workflow | Coherent selection/caret/explicit-position workflow; common Word, Excel and PPT object operations; original OfficeCLI/Skills reuse; clear in-place versus working-copy execution; readable changes, result preview and recovery | Representative user tasks complete in the actual open document, with fixed target, correct editable objects, preserved neighbors and verified recovery; supported object/action matrix matches the UI and tools |
| 2. Agent/session integration and architectural consolidation | Codex supported external entry and Workbench entry share the intended session and document tools; explicit attach/resume/ownership; settings/attachments/approvals through existing Core/ACP where available; settle the experimental native pane's place | A real native entry and the UI continue the same linked conversation, operate the same authorized document, preserve history after restart and handle concurrent/uncertain requests; neither an archive nor Workbench CLI alone substitutes for native-entry acceptance |
| 3. Quality, complex scenarios and efficiency | Independent Office instances, unsaved content, rich/large files, concurrent user edits, partial failures, real rendering/editability, permissions and regression; matched cost/latency/token evaluation; end-to-end UX | Reproducible acceptance on dedicated fixtures, negative/conflict/recovery cases and useful whole-task comparisons; failures and limitations recorded; claims no broader than evidence |
| 4. Long-term operation and release preparation | Supervision/restart/sleep, certificate lifecycle, per-component updates and compatibility, preserved data/rollback, clean-machine package, dependency/license/secret review, docs and CI/source preparation | Frozen candidate passes clean install/upgrade/rollback and retained-history checks; second-machine run package prepared; reviewable source/assets/release notes ready for final publication decision |

Pre-publication completion means the local candidate and review materials are
ready. Public Actions/download verification belongs to the separately authorized
publication step. Cross-machine acceptance can use a private candidate beforehand.
Do not claim the four groups are complete while a required user-dependent check
has neither evidence nor a clearly disclosed pending result.

Agent-owned work: implementation choices, reuse evaluation, fixes, automated and
available real-Office tests, benchmarks, installer/rollback, docs and release
preparation. User-owned work: personal login/trust approval and access to another
machine when needed. Joint work: final real-use acceptance, unresolved external
constraints if discovered, and publication approval. Do not repeatedly ask the
user to choose routine architecture or run technical investigations for us.

Second release: Claude independent-session adaptation, user macros/OCR/PPT Skills
and further agent-specific integrations. Existing managed Claude functionality
is preserved. No first-release Office/Codex requirement is moved implicitly.

Current implementation remains incomplete. The native Codex pane has chat/event
evidence but explicitly lacks document tools and offline continuation; Word/PPT
rich editing is still bounded. A compact tool wrapper, a new pane or more unit
tests alone cannot close either product gap.

UPDATE: Selection-driven native rich editing, independent Office instance
identity and Codex dual-entry session continuity are confirmed FIRST
RELEASE requirements. They are not optional cuts awaiting user approval.
See AGENT-INTEGRATION.md. Macros/OCR/user PPT Skills move to the second release.
User decision 2026-09-30: Claude independent-session adaptation also moves to
second release; existing managed Claude capabilities are retained. Other core
Office/Codex requirements have not been reduced.

This is a working local alpha candidate, NOT a published or universally complete
Office platform. The user requires a factual joint review before deciding the
first local final version and GitHub publication. No public repository, tag or
Release is created by the preparation scripts.

## Evidence already available

- Standalone UI/CLI share stored agent conversations; native Claude Code/Codex
  have actual scoped tool evidence. Built-in provider uses the existing CC-Switch
  gateway. Other advertised agents are not automatically accepted as compatible.
- Three native Office fixtures have bounded read/write/conflict/restoration
  evidence. Excel/PPT unsaved markers survive snapshot export, with original
  memory content restored and original disk hashes unchanged. No autosave.
- Original pinned OfficeCLI performs document operations. Representative Word
  styles/tables, Excel formulas/charts, PPT editable text/pictures, three-format
  templates, CSV/TSV/locale imports and legacy newline replay have read-back tests.
- CSV formula fields are explicitly rejected before import; originals remain
  intact. UI and actual stdio MCP checks cover import/template/scoping behavior.
- PNG/JPEG visual responses, TXT and PDF text extraction have model evidence.
  Native Codex compression retains history; native Claude compression remains
  unconfirmed. These are not model-independent capability promises.
- Bounded read-only history archives support canonical/Claude/Codex text formats,
  paging/dedup/export through the UI and shared CLI. Not native session restoration.
- Login supervision, graceful stop, crash/idle-hang recovery, source clean builds,
  isolated package upgrade/rollback and per-file ZIP checks have local evidence.
  Last recorded full source suite:181 tests passed; see PROGRESS.md for evidence.
  Earlier package test timeouts and failed model pilots are retained, not hidden.
- BENCHMARK.md records alternating engine comparisons and a narrow real-model
  pilot. No general speed/cost/quality superiority or invoice savings established.
- Original Codex0.159.2 terminal and a Workbench protocol client resumed the same
  owned session, exchanged live replies in both directions and exited cleanly
  (`codex-remote-1790758982857`). Production UI and scoped document tools were NOT
  part of this probe; the dual-entry product gate remains open.
- The production native pane now creates authenticated shared servers. Real UI
  and original TUI exchanged three marker turns; UI reload retained all replies
  (`managed-native-shared-1790760289912`). Document tools, offline resume and
  restart/ownership reconciliation still block full dual-entry signoff.

## Product gaps, not tasks to offload onto the user

Native Word/PPT editing covers bounded text/character formatting and single PPT
object geometry. Broader live layout, tables, charts and rich restoration remain
incomplete. File-copy capabilities do not establish equivalent live coverage.
Standard DOCX unsaved export now has a real Word read-only opening test. Discovery
of two independent same-file Excel instances also has a dedicated binding test.
Broader Word/PPT instance coverage,
automatic synchronization of arbitrary external-agent chats, full native branch
history import, unattended certificate renewal and complete upstream command
coverage are not implemented. The confirmed first-release requirements require
engineering, not just a user checkbox or a second-machine test.

Word refresh and process/install/plugin management are deliberately not exposed
to model file tools. Do not grant global shell/configuration authority just to
advertise all upstream commands. Rich native support must retain conflict and
recovery guarantees. Refer to CAPABILITIES.md for each tested boundary.

## Joint decisions before naming a first final version

Do not reopen the confirmed first-release gates as optional reductions. Review the actual document selection,
approvals, previews, version downloads and recovery experience. Decide repository
name/public positioning through agent-led preparation and final joint acceptance. Existing code
and data stay intact; there is no proposal to restart architecture or discard chats.

User-prepared macros, OCR and PPT Skills await materials, dependency/license/security
review and prioritization. Do not duplicate them or make unsupported quality claims.
Their integration is a separate jointly agreed workstream.

## User-only access and real-world acceptance

Another Windows/Office machine, actual sign-out/login/reboot/sleep cycles, personal
agent login/authorization, matching certificate trust prompts and representative
sanitized documents require user participation. Scripts/checklists are supplied
in ACCEPTANCE.md; engineering, failure diagnosis and code fixes remain our work.
Published GitHub Actions, anonymous downloads and Release acceptance can only be
verified AFTER authorized publication; local checks cannot stand in for them.

Certificates currently last three months and have a documented renewal command;
the UI warns in the last21 days. Do not describe this as unattended forever uptime.
No antivirus exclusion, elevation or execution-policy bypass is required or added.
