# First public preview: 0.1.0-alpha.2

## Scope decision, 2026-09-30

The user authorized publishing the existing useful first version and moving
unfinished large workstreams to the next version. This decision supersedes the
earlier requirement that every original first-release gate must close before
publication. Historical planning and failed probes remain available locally;
they are not evidence that deferred features shipped.

## Included

- Standalone Windows UI and CLI, shared managed conversations, approvals,
  attachments, bounded archive import/export and document operation records.
- Original AionCore0.2.2 and OfficeCLI1.0.152, fixed versions/checksums, thin
  adapters and optional CC-Switch/provider integration. AionUi is a design/source
  reference, not a fully copied renderer. No proprietary Claude frontend code.
- Live Windows Office binding and bounded selection/explicit-target editing:
  Word text/font/paragraph properties; Excel values/formulas/number formats;
  PPT text/font and single-shape geometry. Guards, readback and restoration have
  dedicated fixture evidence. Editing does not autosave or execute macros.
- OfficeCLI file-copy generation, batch edits, template merge, structured
  inspection and previews. File-copy operations do not masquerade as live edits.
- Original Codex0.159.2 terminal and the native pane share live public messages.
  This separate native shared pane is chat-only, not a document-enabled session.
  Existing managed Codex/Claude document tooling remains available separately.
- Login task/watchdog, idle stop, data-preserving program upgrade/rollback,
  package checksums and manual certificate renewal with expiry warnings.

## Deferred to the next version

1. Scoped document tools, frozen selection and approval integration into shared
   native Codex sessions; explicit offline continuation, restart reconciliation
   and stronger cross-entry execution coordination. Offline history is readable
   today, but not equivalent to resuming execution.
2. Broader live Word tables/structure and PPT replacement/multi-object/layout
   families. Common bounded operations work; arbitrary rich documents and full
   OfficeCLI live parity are not promised.
3. Comprehensive independent Word/PPT instance coverage, large/complex documents,
   partial failures and full-task efficiency tuning. Existing narrow benchmarks
   do not establish universal superiority over OfficeCLI or invoice savings.
4. Unattended certificate rotation and broader agent compatibility. Personal
   trust/login prompts cannot be silently bypassed.
5. Claude independent-session adaptation and user-provided macros, OCR and PPT
   Skills, with dependency/license/security review before inclusion.

## Supported test baseline and remaining acceptance

Windows x64, Node24.14.0, desktop Microsoft Office16, AionCore0.2.2,
OfficeCLI1.0.152 and Codex0.159.2 are the recorded local baseline. Installed
agent versions are checked; changed protocols require compatibility validation.
The project does not auto-upgrade agents, reset their homes or change global hooks.

The local source suite recorded181 passing tests and real UI/native fixtures.
CI adds clean-source and original engine tests, not licensed desktop Office or
real account authentication. Second-machine installation, representative user
documents and prolonged use remain unverified; users can report them as issues.
The preview is not suitable for unattended modification of irreplaceable files.

No config, chat database, certificates, account keys or user documents are part
of the public source/package. Office licensing and agent accounts are supplied
by the user. Start with disposable copies and inspect results before saving.
