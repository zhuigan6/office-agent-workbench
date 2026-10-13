# Capability and acceptance ledger

2026-10-11 current V2 delta: observed-word-instances-1791717171814 passed the user-
opened independent readonly Word and original writable instance: distinct/stable
IDs, both reads, broker denial and native dispatcher refusal before writing,
ambiguous old target refusal, unchanged disk and no close/save. This machine's
readonly window reports COM ReadOnly:false; exact document-window readonly
markers now additionally restrict discovery AND each write. Unknown window status
refuses writes; normal names containing Read-Only do not imply readonly. Bound
capabilities refresh even within the same session. Production API confirmed the
two distinct permission sets after a backed-up idle restart. This is not universal
localized-caption support or all Word close/reopen lifecycle acceptance.

Three-format model/file-task comparison now has six successful validated outputs
plus six retained failed pilot requests; see BENCHMARK.md for scope and numbers.
Certificate CheckOnly is a real read-only maintenance entrypoint, not automatic
trust rotation. Updated package tests must include their explicit script helpers;
source test success is not yet package/cross-machine acceptance.

Current planning: V2-PLAN.md lists remaining task IDs, priorities, dependencies and
acceptance. The public alpha.2 preview is already released; historical first-release
blocker wording below must not override RELEASE-SCOPE.md or the next-version plan.

Release decision update: unfinished large blocks are deferred under the user's
2026-09-30 authorization. See RELEASE-SCOPE.md for the current first public preview
scope; original first-release blocker language below is retained as roadmap context.

Remaining roadmap areas: selection/caret-driven native rich editing,
correct independent Office instance binding, Codex CLI dual-entry
public conversation continuity, and maintenance/acceptance. See AGENT-INTEGRATION.md.
The current tests/public package do not establish full coverage of these areas.
Macros/OCR/user PPT Skills await the second-version integration described in V2-PLAN.md.
Claude independent-session adaptation is also second-release work by the user's
2026-09-30 decision. Existing managed Claude/MCP behavior remains available.

This is an alpha implementation, not the finished Office platform. A successful
greeting proves only model connectivity. The user explicitly retired the add-in
route: standalone windows and native Windows Office attachment replace Office.js.
The remaining product requirements from the planning package still apply.
The four top-level release workstreams and responsibilities are consolidated in
READINESS.md; architectural reconciliation is in ARCHITECTURE.md. Historical
evidence is not a fresh-runtime claim made by this planning review.

2026-10-06 border update (V2 source, not the public alpha package): existing
table-layout composes six named borders with layout/widths. Native composite and
outside-only writes, dedup/stale refusal, full edge-profile restoration and actual
Word PDF rendering passed. Full snapshots remain private; model receipts contain
only six aggregate profiles. Original Codex Chinese/UI acceptance passed with
two calls/one write, moved actual selection, approval/readback and UI restoration;
same vendor ID and E:/ccOffice测试 workspace retained, original disk unchanged.
Requested mixed aggregate borders are refused; not arbitrary cell/style/theme
inheritance fidelity. Column-width percentage/automatic/autofit origin cases
already passed; older wording below does not put them back in the backlog.

2026-10-06 PPT list update (V2 source): existing format-selection adds complete-
paragraph indents and character/numbered/none bullet composition. Native same-
reference transitions, stale/dedup, reverse recovery, partial-paragraph refusal
and untouched text/geometry/neighbors/disk passed. New captures explicitly carry
paragraphProfileVersion:1; old captures retain their original rich fingerprint
representation, and cannot silently gain list/indent scope. Source custom bullet
font/color linkage is captured; broader themed/custom/picture bullet cases still
need acceptance. Original Codex Chinese/UI passed two calls/one write, fixed
selection despite moving it, approval/readback/UI undo and actual PowerPoint PNG
render inspection (numbering3/4, no changed neighbors); private probe removed. This does
not complete all PPT layouts, master/group/image/chart or automatic-fit workflows.

2026-10-07 text-frame update (V2 source): layout-selection now combines complete
ordinary frame geometry with native none/text/shape fitting, margins, wrap and
vertical anchor. Three-mode native continuation/reverse recovery, partial-text
refusal and PowerPoint renders passed. Original-session Chinese/UI combined growth,
approval/readback/UI restore and actual render passed; post-restore fetch interruption
was separately reconciled without resending. Original vendor link is resumable.
Fitted size getters are EFFECTIVE sizes, not intrinsic font definitions. Recovery
does not stamp them into fonts. Private bounded copies and shared OPC readers guard
selected-shape content/style dependencies; copies are deleted, originals not saved.
Small fitted fonts are reported, not asserted readable. Wider anchors, wrapping,
mixed-size/theme/auto-fit origins, large presentations and fit-aware text editing
remain acceptance work; this is not a complete automatic layout engine.

2026-10-07 fitted-text continuation (V2 source): text-fit replacement now uses
intrinsic glyph-profile origins and restores intrinsic sizes rather than fitted
getters. Two unequal same-reference replacements, moved live selection, dedup,
stale refusal, both text undos and the original frame undo passed native readback
in ppt-fitted-replacement-1791362108448. Original text/fonts/geometry/disk and
neighbors restored; probe removed. DrawingML proofing dirty bits are excluded
from the nominal fingerprint; font/text/color/language negative guards passed.
Shape-fit source and original-session UI acceptance are still running/not claimed.
The 2026-10-08 update below supersedes this earlier native rich-format gap;
this is not full PPT object coverage.

2026-10-08 fitted rich formatting (V2 source): existing format-selection reuses
the rich writer for versioned rich frame references, including basic bold/size.
Intrinsic fonts and current fit mode are preserved; paragraph planning explicitly
opts into supported modes1/2 without changing legacy scope. Native text-fit and
shape-fit font/color/size -> paragraph -> all reverse recovery chains passed in
ppt-fitted-format-1791456283815 and1791456737283; originals/neighbors/disk restored,
probes removed. Compact receipts separate execution verification from bounds/small-
font review warnings. Independent rounding is checked by compatible scale intervals,
not the first rounded glyph. Original-session model edit and UI restore passed
with separate supplemental evidence after the first observer deadline; no resend
or new vendor thread, failed report retained. Mixed/theme/
complex object source coverage and overall V2 remain unfinished.

2026-10-10 chart compound editing (V2 development): excel-charts gains
optional includeFormat:true for style/title/legend summary and a formatRevision
from the complete bounded chart/dependency package guard. Existing read/geometry
refs remain compatible; snapshots/glyphs are not sent to the model. Native private-
workbook testing proved stable capture and style-only conflict detection. Template-
only recovery is insufficient; template+title glyph replay restored the captured
ordinary chart state, with title XML declarations normalized. Existing chart-layout
now composes type/plain title/legend/builtin style/geometry with formatRevision;
legacy references remain geometry-only. Actual Node broker/native worker passed
Chinese title + line/style/legend/geometry, same-ticket geometry continuation,
deduplication/stale rejection and reverse recovery in excel-chart-1791631548648.
Source cells and original file stayed unchanged; owned probe chart was removed.
New title proofing language is detected for the new text and reported, while mapped
visible font profiles remain verified; it does not normalize conflict guards.
Template assets are hash checked, theme inheritance and NA/blank display policy
preserved. Ordinary uniform-series column/bar/line/pie only, <=50 series/200 points;
no Pivot/source/axis edits or arbitrary chart fidelity claim. Main UI/model acceptance
passed in excel-chart-ui-1791632014161: original vendor/session, two tool calls and
one compound mutation, moved real selection, approval/readback/UI recovery and
unchanged source/disk. First resume observer timeout1791631803944 stays failed;
subsequent explicit same-session connection succeeded, no replacement or replay.
Release package has not been refreshed.

| Requirement | Implementation / evidence | Remaining work |
| --- | --- | --- |
| Word table explicit column widths (V2 development) | Existing table-layout accepts one point width per column with alignment/paddings/page-break policy. Fixed-point, percentage+autofit and automatic-unit+autofit origins passed native composition and guarded restoration of widths/units/layout/text/disk. SAME original Codex Chinese UI: two calls/one mutation, moved selection, approval/readback/UI restore passed. Actual Word PDF export was rendered offline and inspected: two-to-one columns, readable cells, unchanged before/after paragraphs. No-op alignment writes are guarded and width units/autofit are finalized after other layout setters | Ordinary inline rectangular20x20 table, every requested width18..1000pt in0.05pt increments, total within single-column section text area; explicit widths disable autofit. Origin/render tests cover the dedicated3x2 ordinary table, not arbitrary mixed unit/style/layout cases. Native percentage may normalize its representation; restore checks the observed original value, not an assumed100%. Borders/styles/structure/merged/multi-section cases and broader visual acceptance remain separate; resolved geometry/units, not package inheritance identity |
| Native turn outcome visibility (V2 development) | Completed/failed/interrupted is appended as a separate public outcome, preserving legacy completion event body/identity. Exact Codex workspace-routing timeout receives a bounded failure code; raw vendor error/reasoning/credentials are not journaled. Schema, projection, receipt/reconciliation regression and307-test suite passed. Actual successful vendor outcome and production UI pagination/display passed; failure display passed in an explicitly isolated browser response fixture, no production history injected | A live failed producer/UI chain still needs acceptance; isolated failure display is not that claim. Historical end-only events remain end-only, not relabelled successful. A failed model turn does not prove a document mutation or auto-undo, and is never automatically replayed |
| Excel appended data columns (V2 development) | One excel-table-columns call appends1..10 named columns with values OR explicit formulas per column and optional number formats, using Resize without shifting worksheet cells. Full-table frozen citation advances only after verification. Native and SAME original Codex Chinese model/UI passed: two calls/one mutation, moved actual selection, old-column preservation, formula results360/540, UI restore of table and full destination profiles, neighbors/disk unchanged. Later added-cell edits and external structured formulas block undo before mutation | Local ordinary xlsx/header table, no totals; at most20 total columns/200 cells and proved empty Normal destination. No arbitrary worksheet insertion, delete/reorder/rename/merge or universal calculated-column inheritance. Whole-workbook formula/name guard is conservative; unrelated later formulas also block undo. UsedRange may retain a cleared blank extent; resolved profiles/heights are not OOXML inheritance identity. Unknown outcomes retained, not replayed |
| Excel editable chart creation (V2 development) | One fixed source rectangle creates column/bar/line/pie with title, legend, builtin style and geometry in one mutation. Four native types/source-series readback/dedup/restore passed; package guard stable. SAME original Codex Chinese model/UI: two calls/one write, moved selection, native editable chart, approval and UI restore passed. Source cells/original disk unchanged | Standard xlsx, visible/unmerged bounded header/category/numeric data, at most1000 cells. New object only, no existing chart source/type/style editing or arbitrary deletion. Changed source or complete chart XML/relationships/theme/anchor guard blocks recovery; unknown outcomes not replayed. Source citation stays cells. Broader data layouts, chart kinds and large/cloud workbooks remain separate |
| Word/Excel discovery proxy deduplication (V2 development) | Native window and ROT observations of one document merge by real window set/path, not changing COM proxy addresses. Native provenance preferred; disjoint windows and different document paths stay distinct. Four actual discovery rounds preserved the original workbook ID; production restored its existing binding after idle activation | Does not merge independent instances or retarget history. Does not establish all close/reopen/unsaved lifecycle cases or PPT HWND-less fallback identity. Existing sticky ambiguity state clears only with an explicitly restarted idle connector; real ambiguity remains an explicit instance-bound case |
| Excel embedded chart layout (V2 development) | Bounded chart discovery, whole-chart selection or explicit chartName target, native Shape.ID/window/revision. One call combines left/top/width/height in points. Actual native same-selection continuation, stale refusal, reverse restore and same-name replacement refusal passed. SAME shared Codex/UI: two calls/one write, moved selection, approved fixed chart and UI restore; cells/disk unchanged, temporary chart removed | Geometry only: no source/type/title/style/axes edits, creation/deletion or chart-sheet mutation. Title/series/axis selections cannot expand to whole-chart layout. Revision inspects geometry/type/title/series formulas, not all rich styles/source values. Protected/grouped targets refused; unknown results not replayed; later covered changes block undo. See PROGRESS.md for current evidence |
| Excel table record append (V2 development) | Native Resize appends1..10 records/explicit formula matrix without moving worksheet cells. Exact table/window/object/version and blank Normal tail preflight; old data/style/flags and row heights checked. Native and SAME shared Codex/UI append→style chain passed in four calls/two writes, moved selection, verified values480/640, reverse UI restore of table and full tail format/height plus unchanged original disk | Non-atomic. At most1000 total/200 added cells,20 columns, no totals/protection/overlap/merged/hidden/validation/CF/comments/links/sparklines or preformatted destinations. No universal calculated-column inheritance or general row insertion/deletion. Tail edits prevent undo; UsedRange can retain cleared blank extent; not arbitrary XML identity |
| Excel mixed scalar write repair (V2 development) | Shared native setter preserves string/number/bool/null types rather than reusing a cached COM string setter. Actual heterogeneous E7:H8 write/read/restore passed; native null/empty and numeric formula-constant readback only normalized | Value numeric strings/formula literal text never coerced. Excel calculation/representation of wider formulas remains separately tested; no general canonicalization of formulas |
| Excel workbook outline (V2 development) | Bounded worksheet names/visibility/protection/UsedRange/table-chart counts from only the bound workbook, no activation; actual native read passed, scoped client evidence in PROGRESS.md | Hidden/protected flags do not grant mutation; UsedRange includes possible empty/formatted cells. Follow chart discovery for the supported geometry family; neither outline nor geometry implies full chart editing or a full cell dump |
| Excel live data-table style (V2 development) | Discovers real local ListObjects; complete-table capture freezes window/object/name/range/version. One excel-table-style call combines builtin style and first/last-column emphasis/row/column stripes. Actual native and Chinese shared Codex/UI proof: two calls/one write, moved selection, guarded UI restore, preserved formulas/data/number formats/header/totals/filter shape/outside sentinel and disk. Multi-cell COM enumeration bug fixed with pure+real regression | At most1000 cells, builtin styles, local range-source tables. Partial cells do not expand. Numeric writes validate identity then end table-style continuation. General creation/resize/rows/columns, custom/connected tables, merging/charts and broader protection/lifecycle remain separate. Resolved native properties, not arbitrary XML/inheritance fidelity |
| Whole Word table citation (V2 development) | Complete ordinary table selection or explicit tableIndex resolves a frozen table/window/version, distinct from a cell. Reuses table-batch/layout/rows; native layout→cell batch→row append with the same ID, moved selection, stale refusal and reverse recovery passed. Chinese model/UI layout+batch, four calls, original vendor ID and UI restoration passed; row/column citation display also passed | Existing table restrictions still apply. A cell/partial selection cannot expand. Older entries saying a single-selection lock cannot use table tools mean the cell/partial-range workflow, not this explicitly complete-table anchor. No arbitrary structure or inheritance fidelity claim |
| PPT installed font and RGB color (V2 development) | Rich format-selection combines name/color with size/bold/italic; native and Chinese shared Codex/UI readback, moved selection, restore and original disk preservation passed. Existing basic fingerprints/journals stay compatible | Ordinary nongroup text with a rich replacementRevision; installed fonts only, solid colors/no complex effects. Language fallback aliases are not all forced to the selected font. Restoration may retain an empty unused NameOther alias and reports it; not package-byte/inheritance identity |
| PPT paragraph composition (V2 development) | SAME format-selection combines font and/or complete-paragraph alignment, before/after point spacing and explicit line/point spacing. Two-paragraph native continuation, duplicate/stale refusal, partial selection refusal before font mutation, guarded reverse restoration and spacing-unit preservation passed. SAME Codex Chinese UI: two calls/one write, moved selection, native readback, UI undo and actual PowerPoint slide export inspected; other paragraphs/marks/objects and original disk unchanged | One ordinary rich text shape up to2000 characters,1..20 complete selected paragraphs. No partial-span expansion, bullet/indent/master/group or automatic resizing changes. Native text-bounds warning is not universal visual verification. Requested resolved properties, not package/inheritance identity; unknown outcomes retained, never replayed. PPT-only help bounded; soft-line/paragraph preview normalization does not change the frozen payload |
| Original Claude functionality | Reference and existing 8787 compatibility gateway retained | Own equivalent workflow coverage, not a proprietary frontend clone |
| Shared conversation | Shared persisted UI/CLI history, request receipt replay, concurrent-send guards; 205-message paging UI and refresh test | Broader interrupted-turn and cross-device cases |
| Shared native Codex document execution (V2 development) | Session-level original MCP tools; real UI/TUI read and format the same dedicated Word fixture; per-call approval, selection-move protection, guarded UI recovery and unchanged disk hash passed | Other document families and abrupt interruption remain separate acceptance items; not in published alpha.2 |
| Explicit native continuation (V2 development) | Clean idle disconnect/graceful restart and same-vendor-ID resume passed. Offline reconciliation checks prior process evidence and terminal turns against exact message IDs/content. Lost-completion/private-server failure recovered; UI resume and a later Word read passed. A fenced runtime still held by this host can now be explicitly retired, then reconciled; actual live-process transport loss and same-ID continuation passed. Uncertain owners cannot approve old writes | No takeover of external/orphaned processes. Prior process exit and bounded vendor evidence are required; older links without process metadata, unfinished/missing-ID turns, undispatched input and unknown write/restore journals remain blocked. Recapture old selections; not universal crash recovery |
| Native turn cancellation (V2 development) | Explicit current-turn interruption denies pending tool approvals and refuses to interrupt an executing document call. Non-success receipts stay interrupted/cancelled, not completed. Actual cancellation and subsequent new input in the same session passed; only the verified new queue item is explicitly started after vendor queue pause | No document rollback, unknown request replay or automatic drain of other queue items. Installed protocol must advertise interrupt/list/start support; unsupported versions do not expose the button. Broader multi-client queue and fault races remain separate |
| Agent and model choice | DeepSeek/AionCore, native Claude Code and Codex; both native agents completed scoped MCP lists with one-time approval. OpenAI streaming protocol fixture passed | Other runners and real direct supplier credentials; installed does not mean tested |
| Per-conversation settings | Advertised model/thinking controls, idle-only updates, observed confirmation; actual Codex model change/read-back/restore passed; permission modes rejected | Thinking current value may be unreported; per-provider reasoning semantics are not interchangeable |
| Excel live edits | Native bounded values/formulas/formats, revision/read-back, guarded recovery with duplicate receipt verified | Rich operations and broader protected-sheet acceptance |
| Excel range appearance (V2 development) | One excel-range-format composes whole-cell bold/italic/RGB font color, solid/no fill and horizontal/vertical alignment. Nine-cell native composition, fixed selection after moving to F1, continuation, stale refusal and reverse restoration passed. SAME Codex Chinese UI task: four tool calls, one appearance read, one write, approval/native readback/UI restore; data/formulas/number formats and original disk unchanged. Full snapshots private, repeated profiles grouped for the model | At most200 visible ordinary unmerged cells, no array/conditional/patterned or mixed-character formatting. No arbitrary COM, size/wrap/row height, border or structure edit. Restore guards observed data/appearance and restores changed resolved colors including theme/tint, not OOXML declarations. Cell appearance ends table-wide continuation; quote the table again explicitly |
| Excel native table construction (V2 development) | One excel-table-create combines name/builtin style/stripe/emphasis on a fixed ordinary source. Actual creation→existing style→reverse undo passed with source formulas/full cell formatting/heights retained; exact same citation becomes the complete same-range table. Actual outside structured reference blocks undo before mutation. SAME Codex Chinese UI: two calls/one write, moved selection, approval/readback/UI restore; prepared area cleared only after baseline verification, original tables/cells/disk unchanged | Standard xlsx, header+data up to20 columns/200 cells, plain unique text headers; no conversion/inserted header/overlapping or external tables, arrays/spills/conditional/validation/mixed-font content. Private package bounds32MB compressed/128MB expanded/4MB per consumed XML part/200 sheets/100000 formulas. Undo guards full source, whole-workbook formulas/defined names, table XML/theme before unlisting ONLY the new table. Thus unrelated formula/name changes also conservatively block undo. Source row dimensions restored if materialization changes them; resolved properties, not arbitrary OOXML/automatic-height inheritance identity. General row/column insertion/deletion/merge remain separate |
| Frozen selection to chat | Captured target/version, UI citation and actual selected edits; server guard rejects retarget bypasses. Word body/ordinary nonempty single-paragraph cell carets use the existing fixed-position replacement and reference continuation. Model/UI moved-caret insertion and recovery passed | Plain text, bounded ordinary body/cell scope only; coordinate/batch empty-cell targeting and insertion/deletion of paragraphs remain separate. Broader object-family, instance and restart acceptance |
| Word selected character formatting | Fixed body range bold/italic/size, per-character before state, conflict checks and guarded restore; real model/UI four-character edit and semantic-fingerprint restoration verified | Broader table/image and tracked/protected/story cases; paragraph capabilities are recorded separately below; property restoration does not universally preserve inherited-vs-direct markup |
| Word paragraph formatting | Font plus alignment, spacing, indentation and keep flags on1..20 complete body paragraphs/up to2000 characters. Single/two-paragraph real native readback, untouched neighbor, stale refusal and full-paragraph XML restoration passed. Ordinary complete-cell paragraph layout is covered below | Lists/embedded/tracked/protected content and partial paragraph expansion deliberately refused; broader complex-document acceptance remains |
| Compact live tool surface | Default MCP exposes office_live plus office_file; operation-specific help and scoped CLI live share the existing routes/selection guards. Real MCP discovery, paragraph edit and recovery passed; legacy naming is opt-in | This consolidates calls, not missing object operations; no general token/cost advantage inferred from schema bytes |
| Word selected text replacement | Single-body-paragraph bounded splices preserve unchanged runs; changed text inherits local font. Real model/UI Nati to Sample and restoration verified against original selected/paragraph fingerprints; native mixed-run test passed. Ordinary cell subset is recorded separately below | Multi-paragraph, table structure, object/field/revision cases; body recovery locks the containing paragraph, ordinary-cell recovery locks the table |
| Word ordinary table cells (V2 development) | Bounded table discovery plus explicit tableIndex/row/column reuse target, replace-selection and format-selection. Real native120-to1250/font/restore and model/UI selected-cell plus coordinate-only workflows passed. Whole-cell capture excludes the structural marker and shows row/column; moving selection after send did not retarget. Complete-cell alignment, spacing, indents and keep flags reuse existing paragraph handling; real combined font/layout, stale refusal and restoration passed | One nonempty single-paragraph cell in an ordinary main-body rectangular table, up to20x20. Cell styles, empty/merged/nested/special-content cells and row/column/structural operations remain separate. Paragraph changes require the complete cell; partial spans still support character edits only. Recovery locks the table but restores only its selected cell paragraph once; no universal package/inheritance fidelity claim |
| Word batch cell edits (V2 development) | One office_live table-batch call composes existing text/font/paragraph handlers for1..20 unique ordinary cells. Fixed table/window/revision, all-cell/property preflight, document-wide execution queue, moved-offset readback, dedup and reverse recovery passed. Actual model/UI used one batch call (five tool calls including discovery/help) for two cells and recovered it, including center/right alignment and paragraph spacing; real pre-dispatch second-cell failure preserved the untouched cell and recovered the first | Non-atomic; known partial steps are journaled and recoverable, unknown outcomes or missing journals stop automatic recovery. A single-selection message cannot use table-batch to expand its scope. No cell styles, structural edits, empty/merged/nested/multi-paragraph cells, general cancel/abrupt recovery or measured overall speed/Token advantage claimed |
| Word table layout (V2 development) | One office_live table-layout call combines left/center/right alignment, four paddings and per-row page-break policy. Compact resolved-property read, scoped table/window revision, native readback, dedup/stale refusal and UI restore passed. Original model/UI used five calls/one mutation; newer composite-width acceptance is separately recorded above | At most20x20 ordinary inline rectangular table, first cell within existing single-paragraph snapshot scope. Floating/special content, cell/unequal row margin overrides, borders/styles/structure and wider width origins remain separate. A cell/partial-range lock cannot expand to the whole table; explicitly complete-table citation is supported. Recovery restores resolved properties and untouched content, may normalize direct/inherited layout declarations; not XML/inheritance identity |
| Word selected paragraph batch (V2 development) | One office_live paragraph-batch composes existing splices for1..20 complete body paragraphs, keeps paragraph count/marks and paragraph formats, re-resolves moved offsets under one document queue and advances the same frozen reference. Three-paragraph Chinese model/UI, moved actual selection, readback and UI reverse recovery passed in three tool calls. Known partial, unknown readback and missing-journal boundaries have regression coverage | Non-atomic, at most2000 old/new selected characters; same paragraph count and nonempty plain replacement per paragraph. Partial paragraphs, tables/lists/embedded/tracked content and paragraph insertion/deletion remain separate. Unknown or missing evidence forbids replay/recovery; no overall performance/cost advantage inferred |
| Word append table rows (V2 development) | office_live table-rows appends1..10 rows of plain strings using native Rows.Add, keeping existing rows/column count. Fixed table/window/revision, whole-package existing-row proof, outside-text verification, dedup/stale checks and guarded removal of only those new rows passed. Model/UI used four calls including help/discovery and one mutation for two rows; native/UI restored exact table/document fingerprints and unchanged disk | Same ordinary inline table restrictions as table-layout, at most20x20 total and20000 new characters/2000 per cell. New rows use Office inheritance. Non-atomic: unknown/partial dispatch is not replayed or automatically restored. Selected-message scope cannot expand to the table. Insertion elsewhere, arbitrary deletion, columns, merged/nested/special content and general structural fidelity remain separate |
| PPT selected character formatting and geometry | Captured text shape/range and stable COM window identity; font readback/restoration plus single nongroup shape geometry edit/readback/recovery verified | More text effects, richer layouts, grouped shapes and slide-range operations |
| PPT selected text replacement (V2 development) | Existing replace-selection route edits a frozen normal span with equal-run retention and rich version checks. Real mixed-bold/italic and unequal-length replacement, chained formatting, stale refusal, normal Chinese model/UI instruction, selection movement, UI recovery and same-ID resume passed | Nonempty single-paragraph results up to2000 UTF-16 units, one ordinary text shape; structural edits/actions/complex effects refused. Supported resolved properties are checked, not arbitrary inherited OOXML identity. Recovery snapshots remain local rather than inflating model responses |
| PPT multi-shape layout (V2 development) | Captured2..20 nongroup shapes; one composite call reuses existing geometry writes with per-step journals, version checks and reverse recovery. Two-shape real native and shared-model/UI application/recovery passed | Not atomic; unknown outcomes require inspection; partial/late user changes are stopped. Group/slide/structural operations remain separate |
| Word builtin styles (V2 development) | Existing full-paragraph formatting accepts normal/title/subtitle/heading1..6 with localized builtin IDs; heading1/2 plus explicit font/alignment and untouched-neighbor checks passed | Word can retain newly materialized unused style declarations after semantic restoration; exact package-byte restoration is not promised. Existing definitions/content must remain unchanged; tables/lists/stories are separate |
| Scoped external-agent CLI | Same supported document routes and task grant as MCP, including explicit targets and PPT geometry; no admin-config fallback; real read/admin-denial evidence | Opt-in setup/Skills distribution and external native session synchronization are separate remaining tasks |
| Shared native Codex sessions | Production UI and original TUI exchanged3 turns; shared scoped Word tools, denied approval, fixed-range write/UI recovery and same-ID resume passed. Verified offline terminal-state reconciliation and cancellation now have specific evidence above. New sessions use an explicitly configured workspace where requested; folder moves are checked before resume | Genuinely unknown/in-progress writes, transport loss with a still-running previous owner and broader multi-client queue races remain V2-02/V2-08 work. Unrelated external sessions are not automatically attached; older test links are preserved, not silently rebound |
| Real Excel acceptance | Native fixture read/write, formulas, number formats, stale-write rejection and restore recorded by Verify-NativeOffice.ts | Broader workbook cases and full recovery suite |
| Snapshot with unsaved edits | Excel/PPT unsaved markers appeared in snapshots. Standard DOCX Word memory snapshot now preserves an unsaved marker and opens in real Word read-only; recovery and original disk hashes verified | Larger/complex files and macro-enabled formats; no autosave or universal fidelity claim |
| OfficeCLI | Pinned engine; styles/tables/formulas/charts/PPT pictures, scoped assets, versioned copies, template merge, CSV/TSV/locale imports and legacy newline replay verified | Broader rich workflows; deliberate lifecycle/Word refresh restrictions |
| Word and PowerPoint | Native paragraph/text-box read/write, conflict and guarded restore; original-text restoration verified | Rich content edits and complete complex file workflows |
| Attachments and pictures | Actual PNG/JPEG visual answers and TXT marker read-back; bounded PDF.js text reader verified through UI and native Claude, excessive pages rejected | Scanned PDF/OCR, visual PDF layout and other models |
| External agents | CLI reads existing chats; scoped MCP export and bound Word read verified; UI access denied to tool credentials | Runner-specific registration and whole-chat event adapters |
| History and context | Codex compact retained history; Claude compression remains unverified. UI/CLI share bounded read-only canonical/Claude/Codex archives; paging, dedup and export verified | Native branch/resume semantics and other formats; imported archive is not a resumed agent |
| Product interface | Standalone views, Markdown, approvals; per-task tab drafts survive reload; second window shows same chat/tool history | Cross-tab draft policy, long-history UX, full visual/accessibility acceptance |
| Upstream upgrades | Verified binaries, manifests/notices, offline program upgrade/rollback tested with config retained; alpha.2 public artifact refreshed | Expanded per-component compatibility and next-candidate acceptance (V2-14) |
| Long-lived installation | Login task, five-minute trigger, actual start/stop/crash recovery; isolated bundled startup, renewal and ownership-checked idle hang recovery passed | Fresh-login/clean-machine tests; unattended certificate renewal |
| Performance advantage | Four alternating pairs per format,24 engine executions passed; slightly slower medians. Narrow DeepSeek Word table pilot reports tokens/failures; see BENCHMARK.md | Broader matched agent tasks and real billing; no general speed/cost superiority demonstrated |
| Public release | Public office-agent-workbench repository and alpha.2 prerelease; clean-source181 tests, main/tag CI and anonymous ZIP download/extracted8904-file verification passed | Second-machine/prolonged-use acceptance and subsequent releases (V2-14) |

## Release rule

Do not advertise "all OfficeCLI functions", "all Claude features", "all models",
or lower cost until the corresponding cases have executable evidence. Unsupported
capabilities must be explicit, never simulated behind a successful status badge.

## Next gates

2026-10-11 V2 source: layout-selection now combines whole-object solid/absent fill
and outline, transparency and width with geometry/text-frame fitting. Native and
original Codex/UI2-call/1-write approval/readback/restore passed; fixed selection,
text/style/neighbor/disk guards preserved. Partial text cannot expand to appearance.
Recovery restores resolved native appearance and theme links, not inaccessible
hidden definitions or byte-identical inheritance XML. Gradients, pictures, groups,
masters are not covered. Multi-shape appearance is superseded by the update below.
This is not a packaged release.
Original visible theme colors/tints/transparency and dashed outline were also
restored in native1791692604161. API basis: [PowerPoint ColorFormat](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.colorformat)
and [solid-fill transparency](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.fillformat.transparency).

Multi-object appearance (V2 source): the SAME layout-selection edits[] path now
composes per-shape geometry and supported appearance within one frozen set2..20.
Each requested appearance object requires its own version1 capture; legacy geometry
references do not expand. Two-shape native continuation/reverse recovery and known
second-child pre-issue failure recovery passed (1791693672247). Batches are non-atomic;
unknown means inspect, never replay. Per-object actual geometry/appearance is compact
in model receipts; full state remains local. Producer/UI acceptance passed
in1791694257914: original Codex2 calls/1 batch,
2 actual child writes, fixed after moving selection, native readback and UI restore,
original theme/fonts/disk/neighbors retained. No overall performance claim follows.
Multi-object fitting now has separate acceptance below; unsupported gradients,
pictures/groups remain outside this capture.

Batch fitting (V2 source,1791699702388): the SAME edits[] path combines each
object's geometry, frame fit/margins and appearance. Each frame needs its own rich
capture. Two-frame native chaining/fitted resize/reverse recovery passed;
original Codex UI1 call/1 batch/2 children, moved selection, readback and UI recovery
passed after snapshot-read optimization. Original fonts/text/theme/neighbors/disk
were restored. Actual receipts/UI disclose fit mode, minimum displayed font,
native overflow signals and estimated canvas clipping. Verified mutation does NOT
mean acceptable slide design: the stress fixture clipped one frame and shrank the
other to7pt; those are retained quality failures, not hidden success claims.

Rich snapshot reads use the native legacy/modern font-run boundary union, expanding
to unchanged per-character arrays/hashes. Gaps/mixed/unsupported profiles fall back
to the original reader; no fields or checks removed. Four real mixed-language/
paragraph/color/baseline cases and subranges matched the old arrays exactly, with
alternating execution order. Unit fallback/boundary cases and full364 regressions
passed. Short highly-fragmented text need not get faster; see BENCHMARK.md.

Natural-language composition1791713140015: model chose two-frame readable parallel
layout via existing tools, corrected intermediate native warnings, preserved full
text/18/24pt mixed fonts/appearance and neighbors. Final bounds/native flags plus
actual slide export accepted;3 UI inverse recoveries, fresh baseline readback and
probe cleanup accepted. Earlier verifier errors remain separately recorded; no task
or unknown write replay. One representative composition, not universal automatic
slide design or an overall speed/token advantage.

Native operation history (2026-10-11 V2 source): default UI uses scoped20-record
summary pages; full snapshots are retrieved only when details are expanded, with
unchanged authorization. Cursor pages remain stable under refresh/new records.
Lookup/recovery/uncertainty checks use the OWN scope instead of the global500-row
window, so older unknown outcomes cannot be hidden by unrelated work. Isolated510-
foreign-record and45-record paging tests passed. Actual7-record UI/foreign-scope
denial/lazy detail passed1791696308373; multi-page UI was isolated browser simulation,
not added to real history. Full records retained; no model/Office mutation in this UI test.

Local service recovery, multi-window history, three-format native fixtures,
model file creation, PNG/JPEG/TXT/PDF acceptance and isolated upgrade/rollback
now have evidence. Next: final refreshed package verification, remaining complex
document cases, native-agent controls and measured comparative performance.
Keep evidence from the retired add-in separately labelled; it is not native COM
acceptance. No public release until outstanding gates are resolved or explicitly
excluded from the documented first-release scope.

Managed Claude (V2 source): original Core adapter/npm2.1.296 has actual document
help/read and parameter-visible approval UI acceptance. Exact event conversation,
turn and permission ID are matched in bounded volatile cache; unavailable/conflict
is shown, never inferred from nearby history. Same original vendor session resume
after restart independently verified. Readonly bound Word task used deferred tool
discovery, two help calls and one real read; absent pre-task baseline is explicit.
Scoped office_live enum metadata agrees with authority, excludes readonly writes,
and suggests operation-specific help. This is not measured token reduction or
native Claude TUI sharing. Catalog detection is installation only. Source382
tests/typecheck/build accepted; package372 still needs refresh at freeze.

13Oct event recovery: exact ownership prevents duplicate Core observers; disconnect
invalidates stale approval parameters while retaining changed-input conflicts.
Actual authenticated observer reconnect passed without sending any model prompt,
starting a runner or changing existing task state. Source387/typecheck/build now
passed; prior assembled package is unchanged. Selected CLI entrypoint inspection
is reusable and readonly, not native Claude conversation synchronization.

13Oct M2 source: existing excel-chart-layout combines primary linear valueAxis
bounds/units/automatic resets/numeric format with existing geometry/chart properties.
Explicit formatRevision required, no source cell writes or arbitrary COM. Native
compound edit/disjoint bounds/automatic reset/reverse recovery passed in dedicated
new workbook; source/title/format preserved, workbook closed without saving changes.
Same-template sequential editing exposed missing OPTIONAL CRTX relationships; valid
absence now accepted only without dangling relationship attributes. Limits/hash/
scope guards remain. Source390/typecheck/build passed. Original Codex model/UI
acceptance is still running; not yet an end-to-end delivered capability. Data source,
log/secondary/category axes, complex chart kinds remain separate incomplete work.

Follow-up for the SAME new-axis Codex task: actual write/receipt and verified
backend recovery accepted; original vendor ID retained. Initial verifier failed
on an omitted list field, not on native mutation; that forwarding bug is fixed.
Independent fresh object/axis comparison and actual recovered-history UI passed,
probe chart removed. No request replay. New-axis UI restore CLICK was not exercised;
missing saved pre-task disk/full-cell baseline prevents a broader invariance claim.
See completion-audit.json1791895646764 and PROGRESS.md; retain this exact distinction
instead of declaring the whole model/UI/restore gate complete.
