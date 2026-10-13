# Changelog

## 0.2.0-alpha.1 - 2026-10-13

Second-version development preview since alpha.2, not completion of the V2 roadmap.

- Shared native Codex document tools, frozen targets, one-time approvals, verified
  restoration, same-session continuation and bounded abnormal-state reconciliation.
- Composable live Word ordinary table cells/batches/layout/widths/borders/appended
  rows and multi-paragraph rewriting; live Excel range/table/chart workflows;
  PPT rich text/paragraph/list/frame fitting and multi-object layout/appearance.
- Primary linear Excel chart axis settings share the existing compound chart path.
  Real model write/recovery and recovered-history UI accepted; the dedicated new
  axis UI restore-click probe remains unexercised. Data-source reconstruction and
  other axes/complex chart kinds are not included.
- Fix independent readonly Word detection, native font-snapshot performance,
  bounded structured inspection, exact file delivery, paged/lazy operation history.
- Reuse original Core Claude adapter; parameter-visible approvals, same-vendor
  managed resume, scoped tool metadata and event reconnect without input replay.
- Pin original OfficeCLI1.0.156; retain Core0.2.2/AionUi2.2.2 reference. Per-version
  CLI checks do not claim compatibility with every future installed agent.
- Strengthen package test-helper closure, explicit build inputs, certificate
  diagnostics and data-preserving upgrade/rollback. Tests use bounded concurrency.
- Update MCP SDK to1.32.1 and source-map-js to1.2.2 after release audit reported
  GHSA-6qxp-vccf-f47h and GHSA-68fv-2mgg-jv7q; no forced major upgrade or auth reset.
- Fix packaging directly below an existing Windows drive root without recreating
  the root. Clean-source and assembled-package acceptance are checked separately.
- Retain failed probes and disclose limited model benchmarks, absent baselines,
  remaining native Claude sharing, broader rich-edit/lifecycle and cross-machine
  acceptance. See docs/V2-STATUS.md and docs/RELEASE-SCOPE.md.

## 0.1.0-alpha.2 - 2026-09-30

- First published preview; alpha.1 was an unpublished release candidate.
- Fix service-test fixtures to use the Windows system drive, not a required E drive.
- Include the read-only Office discovery script in source and package exports.

## 0.1.0-alpha.1 - 2026-09-30

First public Windows x64 preview of Office Agent Workbench.

- Standalone conversation/workspace UI, shared managed history and scoped CLI/MCP.
- Original AionCore and OfficeCLI integration, guarded file-copy workflows.
- Bounded native Word/Excel/PowerPoint selection editing, readback and recovery.
- Original Codex terminal/native pane shared public conversations.
- Login supervision, checksum-verified package upgrade/rollback and manual renewal.
- Automated source/engine tests, licenses, installation and capability documentation.

See docs/RELEASE-SCOPE.md for included capabilities, deferred features and known
limits. Native shared Codex document tools and full live rich-edit parity are not
included. No universal performance or model compatibility claim is made.
