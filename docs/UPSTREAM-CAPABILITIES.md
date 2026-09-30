# Upstream integration boundaries

## Stable upstream refresh, 2026-09-30

OfficeCLI is now pinned to original release1.0.152, commit
ffa8a0afbe2e9686abd636368e3da38c50f22131. Its Windows x64 binary was verified
against the release's SHA256SUMS before replacing the configured engine path.
The1.0.152 query child-combinator fix is inherited without forking the engine.
Three-format complex workflows, template replacement, CSV/TSV import and live
static-help requests passed. Previous1.0.150 benchmark evidence stays historical;
one new paired run per format is an upgrade regression, not a speedup claim.

AionUi2.2.2 and AionCore0.2.2 remain the latest formal releases checked on this
date. The original Core binary still matches its pinned hash. AionUi is a UI
reference, not an installed or vendored renderer; do not describe this refresh
as replacing an AionUi desktop application. Untagged main changes are not silently
substituted for the stable releases.

Installed Codex0.159.2 passed current schema inspection and an isolated actual
queue/public-event/completion/same-ID-resume probe. Installed Claude Code2.1.285
was version-checked only; this does not validate independent Claude continuity
or prove that a managed ACP/SDK process uses that global executable.

Different user CLI versions are capability-probed, not rejected merely because
they differ from a tested baseline. A matching version alone never means accepted:
functional evidence must match the current version and protocol fingerprint.
Changed required methods/fields fail closed. Bundled document/Core engines stay
hash-pinned; refresh their lock and package together after regression tests.
Keep previous binaries/config backups for rollback and never hot-swap an active
document operation or reset conversation IDs during an upgrade.

Upgrade policy: original binary versions/hashes remain separately pinned. Users
may update native CLIs; each new native Codex session inspects the installed
version and generated protocol before launch. Shape compatibility is not functional
acceptance of a new release. No hot-swap, ID/history reset or silent CLI upgrade.
Prefer maintained ACP adapters through AionCore for additional agents.

Repeated static OfficeCLI help now has in-memory caching/request coalescing.
Cache access validates engine identity; changed pinned binaries are rejected;
unpinned fixture changes invalidate entries. Failures are not cached, output stays
verbatim, and document reads/writes are never memoized. Original1.0.150 probe:
cold1231.34ms; warm0.223ms and0.169ms, identical output. This only establishes
static-help latency, not general task/token/billing superiority.

The pinned original OfficeCLI executable performs document edits. Workbench
does not maintain a fork of its OOXML engine. Its original element schemas
are available through `office_file help`; optional `fields` returns selected
property definitions verbatim to avoid repeatedly sending the entire schema.

| Surface | Current route | Boundary |
| --- | --- | --- |
| Structured reads | inspect: view/get/query/validate/raw/dump | Bounded output and flags; no arbitrary output paths |
| Structured edits | create/batch: add/set/remove/move/swap/raw-set/add-part | Uploaded files or new working copies; stable operation ID |
| Pictures/image fills | asset:fileId or image:asset:fileId | Must belong to the task; filenames/URLs are not implicit authorization |
| Table CSV data | Inline text or uploaded CSV asset | Inline row separators normalized into a data URI; no accidental file lookup |
| Excel data import | import with target fileId, dataFileId, sheet and locale options | Both uploaded files scoped; new xlsx copy, original workbook/data retained |
| Legacy dump replay | Leading meta/dumpVersion1 marker in batch | Only exact documented marker; preserves old newline-as-linebreak behavior |
| Templates | merge with uploaded template fileId + scalar JSON data | Original engine replaces {{key}}; creates a new version and retains original |
| Preview | Upstream HTML in an isolated iframe | Not native Office rendering; external resources/scripts blocked |
| Process/install/server commands | Not exposed to model file tools | Managed by application installation, not document instructions |
| Word refresh | Not exposed | Original command requires Word automation; do not bypass host/startup restrictions |
| Resident open/save/close and watch | Not exposed to model | Workbench manages copies/previews; process lifecycle is not a document permission |
| Macros/OCR/user PPT skills | Deferred by user | Await supplied components and integration discussion |

File receipts include validation and a package-part change summary. Changed
parts are not a semantic or visual diff. Metadata or generated IDs can also
change. Version numbers describe edit ancestry, not a single global latest
version; parallel branches may have the same generation and different file IDs.

`scripts/Verify-ComplexDocuments.ts` generates independent synthetic Word styles
and tables, Excel cross-sheet formulas/charts, and a multi-slide editable PPT
with a picture. It validates, reads back and requests upstream HTML previews.
It writes only a new private verification directory and does not open Office or
modify user documents. Native visual fidelity remains a separate acceptance step.

Template merge accepts at most200 scalar fields/64,000 characters, not a JSON
filename or arbitrary nested automation. Data is staged in a private temporary
file so sensitive values are not placed in process command-line arguments. The
template must be attached to the calling task. Source hashes, idempotent receipt,
validation and output ancestry use the same file-operation path as other edits.
Verify-Templates.ts exercises original OfficeCLI docx/xlsx/pptx replacement and
byte-identical source retention. It is not mail-merge pagination or rich array
templating support. Existing agent sessions may need a new tool discovery to see
the newly advertised merge action; no sessions are force-reset.

CSV/TSV import uses original OfficeCLI's import command, not an independent CSV
engine. The target must be xlsx, source an uploaded CSV/TSV. Sheet path and starting
cell are bounded; header, comma/semicolon/pipe/tab separator and dot/comma decimal
mark are explicit options. Paths, shell flags and mixed batch/import are rejected.
The original importer evaluates equals-prefixed fields as formulas. Workbench
therefore rejects such fields BEFORE invoking it, including quoted/whitespace
and supported BOM variants. Use explicit reviewed formula edits separately.
UTF-8 and BOM-marked UTF-16 are accepted; ambiguous/invalid encodings, malformed
quotes and overlong cell text are refused rather than silently reinterpreted.
Verify-DataImport.ts checks ordinary CSV, TSV, locale decimals, formula rejection,
original retention and legacy Word newline behavior. Future upstream schema
versions need verification before enabling new metadata or flags.
