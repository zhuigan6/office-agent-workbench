# Repeatable local and second-machine acceptance

## Automated developer checks

Run npm ci --ignore-scripts, npm run check, npm test and npm run build in a
clean source export. Production dependency audit is npm audit --omit=dev.
Use the pinned OfficeCLI binary (or WORKBENCH_OFFICECLI for a clean source tree)
with Verify-ComplexDocuments.ts and Verify-Templates.ts. These create synthetic
files under a fresh private verification directory; they do not launch Office.

Benchmark-ModelContext.ts is explicitly opt-in and billable; never enable it
implicitly in CI or on someone else's provider account. BENCHMARK.md describes
its narrow scope and preserved failures. Do not substitute engine checks for
native Microsoft Office rendering or a full agent workflow.

## Native Office test fixtures

Run `node --import tsx scripts/Prepare-NativeFixtures.ts` in an initialized
development checkout. It generates three native-* test files under
.local/host-fixtures, without add-ins. Existing files are NEVER overwritten.
An optional output directory supports isolated fixture creation, but the live
verification scripts intentionally target only the standard fixture directory.

Manually open native-word-test.docx, native-excel-test.xlsx and native-ppt-test.pptx
in their corresponding desktop applications. Keep unrelated user files out of
these fixtures. No Visual Studio, macro enablement or antivirus exclusions apply.

Run Verify-NativeOffice.ts first for read-only document checks. `--write` opts
into scoped fixture writes, stale-revision rejection and restoration. The helper
does not save or quit Office. A persistent private operation DB retains before
states if interrupted. A failed write with unknown outcome requires inspection,
not automatic reissue. No test should be run during an active user/agent task.

Verify-UnsavedSnapshots.ts --write-and-restore separately checks Excel/PPT unsaved
content appears in snapshots, then restores original revisions and verifies disk
hashes. Office's dirty flag may remain set even after content restoration.
Verify-WordSnapshot.ts separately checks standard DOCX memory export, a real
read-only Word opening and guarded fixture restoration. This does not certify
every rich or macro-enabled document. User documents are not implicit test fixtures.

## Second machine / human-dependent checks

Install a verified pristine runtime package following INSTALLATION.md. The user
must confirm any matching localhost certificate trust prompt and personally
authenticate agents/providers. Do not reuse another computer's .local directory.

Check a real chat, selected-file operation, attachment, approval and final file
read-back. Check live document selection and actual visible editing with dedicated
fixtures. Close/reopen the interface and verify shared history; perform a real
Windows sign-out/login and sleep/resume to verify recovery on that machine.

Record Windows/Office versions, agent/provider/model, runtime package hash and
each pass/failure without sending private keys, full user chat databases or
confidential documents. Local isolated-directory results are not substitutes for
these OS/session/application-version differences.

## Deliberately deferred material

Macros, scanned-document OCR and user-prepared PPT Skills await the user's own
materials and an integration discussion. Do not install alternative components
or duplicate that work as a hidden requirement for current foundation checks.
Public repository naming, final publication and GitHub Actions/Release validation
are separate from local development and remain subject to final publication scope.
