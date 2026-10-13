# V2 Development Checkpoint: 0.2.0-alpha.1

Date: 2026-10-13. Baseline: public 0.1.0-alpha.2. This is a progress release,
not a completed second version. V2-PLAN.md remains the task/acceptance ledger.
Private chronological logs and raw chat/document fixtures are not distributed.

## Delivered Since Alpha.2

| Area | Implemented and locally exercised | Limits |
| --- | --- | --- |
| Shared Codex | Existing UI/TUI conversation, scoped document tools, approval/denial, frozen selection, same-ID continuation, explicit proved abnormal reconciliation and cancellation | Unknown writes never replay; foreign/legacy owners and incomplete outcomes remain blocked |
| Word live | Body/cell caret, text/font/paragraph formatting, ordinary table reference, same-table batch, table layout/width/borders, appended rows, same-count paragraph batch, guarded recovery | Ordinary bounded structures; arbitrary row/column surgery, merged/nested/mixed rich structures, images and more complex layout still incomplete |
| Excel live | Values/formulas/number formats, range appearance, table creation/style/appended rows/columns, chart creation/geometry/type/plain title/style/legend, primary linear value-axis bounds/units/format | No general source reconstruction/log/secondary/category axes, complete formula/structure/large-file coverage or macros |
| PPT live | Fixed text replacement, installed fonts/RGB, paragraphs/lists, frame margins/wrap/fitting, geometry/appearance and multi-shape composition | Not arbitrary groups/masters/pictures/charts/theme inheritance; batches are non-atomic, readable final rendering needs checking |
| Office identity | Deduplicated proxies, observed independent Word/Excel instances, actual readonly detection and pre-write refusal | Not all window/lifecycle/localized-caption combinations |
| Upstream/file workflow | Original OfficeCLI, structured bounded queries, selected help/cache, batch-read/failure receipts, exact task file delivery and preview/download | File copies are not native in-place edits; full arbitrary engine command authority is not granted |
| Managed Claude | Existing Core adapter, real document tools, event-ID parameter approvals, same vendor resume after restart; stale details invalidated on disconnect | Native Claude TUI shared chat remains unimplemented; installation detection is not account/feature acceptance |
| UI/maintenance | Task-isolated drafts, multi-window history, scoped paged operation summaries/lazy details, reconnect, strict TLS client, certificate checks and safer package/helper closure | Renewal may require personal trust; fresh release package needs its own acceptance |

## Evidence And Corrections

- Source and assembled package each passed391 regression tests and typecheck; source build passed. The release
  preparation must independently verify clean export and assembled package;
  green source checks alone do not prove either distribution or real Office.
- Real dedicated native Office and model/approval/recovery workflows were exercised.
  The new-axis model probe successfully wrote/restored; its verifier failed on a
  list field omission subsequently fixed. Same-operation audit and visible restored
  history passed without replay. Its UI restore click and saved pre-task full-cell/
  disk-baseline proof remain absent; do not claim those from the audit.
- Standalone CRTX application alone does not preserve all rich chart state.
  The combined template/title/display/axis restoration path is verified in bounded
  cases, not byte-identical XML. Optional relationship-file absence is valid only
  without dangling references; integrity and size limits remain.
- Fitting stress samples had clipped content/7pt text; retained quality failures
  are not hidden by successful mutation checks. A separate readable composition
  passed final native rendering and recovery.
- Earlier package372-test checkpoint passed actual isolated upgrade/rollback,
  startup/UI/read/download with preserved data. This does not automatically cover
  the newer release source. Clean-machine, logout/reboot/sleep and long-use tests
  remain separate pending acceptance.

## Efficiency

Original deterministic OfficeCLI and wrapped operations are compared separately
from model tasks. Six corrected synthetic model-plan/file-generation runs passed;
six failed pilots remain recorded. Selected help reduced context in those samples,
but not all formats became faster, prices/invoices were not verified, and these
are not full interactive-agent benchmarks. BENCHMARK.md contains actual numbers
and methodology; no universal superiority or invoice-savings claim.

## Still To Complete

1. Broader live rich object/structure operations and complex/multi-instance lifecycle.
2. Native Claude UI/TUI shared public conversations, document context, permissions
   and execution ownership using maintained/public interfaces where feasible.
3. Whole interactive tasks with matched model/data, rendering/editability, timing,
   token/cache/retry and cost evidence; remaining agent settings/attachment coverage.
4. Final package/release acceptance, cross-machine and prolonged use, maintenance
   and compatible per-component upgrades. This release is an intermediate preview.
5. User-supplied macros, OCR and PPT Skills: separate material/license/permission
   review; no invented substitute or silent macro execution.

## Upstreams And Privacy

Release audit found two published advisories. MCP SDK is now pinned1.32.1 and the
lockfile selects source-map-js1.2.2; full npm audit reports zero vulnerabilities.
Official [MCP advisory](https://github.com/advisories/GHSA-6qxp-vccf-f47h) concerns
OAuth HTTP clients, not SDK servers/stdio clients. Workbench uses owned stdio
document clients; no evidence of credential exposure or reason to reset user auth
was found. This is not an audit of unrelated installed agent software. The
[source-map advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) is separately
patched. Actual readonly scoped MCP inventory/revocation passed after the update,
without model requests or document writes.

Pinned OfficeCLI1.0.156, AionCore0.2.2 and AionUi2.2.2 reference. AionUi's full
renderer and proprietary Claude frontend are not copied. Installed Codex/Claude
versions are inspected independently; updating one does not silently update all.
Public source/package excludes local config, databases, certificates, account
keys, user documents and native chat homes. Upgrading replaces program files,
not chat data; follow INSTALLATION.md and retain backups.
