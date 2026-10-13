# Performance evidence and limits

## Deterministic document-engine baseline

On 2026-09-28, four paired runs per format used pinned OfficeCLI 1.0.150,
identical edit plans, validation, content read-back and HTML preview. Order
alternated direct-first/workbench-first. All 24 executions passed these checks.

| Format | Direct median ms | Workbench median ms | Direct range ms | Workbench range ms |
| --- | ---: | ---: | --- | --- |
| Word | 6832 | 7026 | 6271-7562 | 6331-9852 |
| Excel | 6978 | 7462 | 6391-7513 | 6355-8081 |
| PowerPoint | 5275 | 5327.5 | 4945-6059 | 4875-5615 |

These results do not demonstrate a speed advantage. Workbench adds file records,
validation/receipt handling, scoped assets and immutable output retention.
The benchmark uses an in-memory metadata database and synthetic files, not the
production HTTP/UI path, large real documents or native Office rendering.
Four samples on one busy machine are not a statistical performance guarantee.

Selected original table-help properties reduced the returned UTF-8 payload
from 13,458 to 1,114 bytes. Create receipts were 632/626/635 bytes versus raw
direct batch output 699/803/686 bytes for Word/Excel/PPT. This is a payload
measurement, not measured token usage, cache behavior or a supplier invoice.

Reproduce from the source root using PowerShell:

```powershell
$env:WORKBENCH_BENCHMARK_REPEATS = '4'
try { node --import tsx scripts/Verify-ComplexDocuments.ts }
finally { Remove-Item Env:\WORKBENCH_BENCHMARK_REPEATS }
```

Clean CI can set WORKBENCH_OFFICECLI to the hash-verified binary instead of
providing local configuration. Reports and synthetic files are written to a
new .local/verification/complex-* directory. No user Office document is opened
or changed. Maximum 10 repetitions; default one is a functional smoke check.

## Narrow live-model pilot

The existing CC-Switch gateway reported DeepSeek and returned model identifier
deepseek-v4-flash for a synthetic Word table task. Both modes used the same user
goal and batch contract. Full original table help was compared with selected
original properties; generated commands were executed and structurally checked.

An initial four-request run with a512-output-token ceiling failed all attempts:
three truncated JSON responses and one unsupported command shape. It is retained
as a failed harness pilot, not excluded from costs or described as success.

After supplying the SAME explicit batch object contract to both modes and using
1024 maximum output tokens, selected-help passed2/2 and full-help passed1/2.
The remaining full-help failure returned a single object instead of the requested
array. There were no hidden automatic retries or output coercion.

| Mode / round | Result | Input tokens | Cached input | Output tokens | Model ms | Total ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Full /0 | Invalid object instead of array | 4867 | 0 | 51 | 736 | 739 |
| Selected /0 | Passed | 732 | 0 | 122 | 936 | 5230 |
| Selected /1 | Passed | 220 | 512 | 122 | 1295 | 5919 |
| Full /1 | Passed | 134 | 4733 | 53 | 1077 | 5543 |

These are gateway-reported fields, not independently verified supplier billing.
Cached input and ordinary input stay separate; price, currency and invoice are
not available. The failed row does not include document-engine work. This pilot
supports further testing of task-selected help, NOT overall quality, speed or
cost superiority. It does not reproduce a complete native agent/Office UI loop.

The opt-in `scripts/Benchmark-ModelContext.ts` issues four billable requests and
never runs in CI. Set WORKBENCH_ALLOW_MODEL_BENCHMARK=1 only for an intentional
local run. It writes synthetic public plans and reports, not hidden reasoning.

## Still required for broader model-cost conclusions

Compare the same task, original file, actual model and agent configuration.
Record complete input/output/cache token fields where supplied, elapsed time,
tool calls/retries, final output correctness and editability. Keep failed runs
and unavailable usage fields, not only the cheapest successful example.
Separate supplier-reported usage from estimated prices and actual invoices.
Do not claim cost savings or superiority until this paired agent test exists.

## 2026-10-11 PPT Batch Receipt Size

Accepted native two-object operation: `ppt-appearance-batch-1791693672247`.
Read-only `JSON.stringify(operation)` is22488 characters; the public
`writeToolResult(operation)` with actual IDs/geometry/RGB/absence is898 characters.
Full snapshots stay in the local journal. This compares TWO SERIALIZATIONS of the
same result, not versions or completed agent tasks. Previous replies were already
bounded; it would be incorrect to claim a22488-to898 reduction versus the old UI.
It excludes MCP wrapping, selection references, history, input help and model usage.

Actual original Codex/UI proof1791694257914 used2 tool calls and1 batch execution
for2 native child edits, then UI recovery restored original states. That is an
observed call count, not a matched baseline or measured token/billing advantage.
The paired whole-task comparison above is still required.

## Native History UI Payload

Actual same7-record original Codex session, read-only proof1791696308373:
full list420435 serialized characters versus default summary page8914 characters.
The browser normally refreshes the summary; full payload is fetched on explicit
detail expansion. All original data remains. No model messages or Office writes
were issued. These are serialized character counts, not HTTP latency, whole-task
performance, model token/billing savings or evidence of all long-history scales.
Real scope denial/lazy fetching passed. Since this session has only7 records,
multi-page UI refresh/new-arrival stability used isolated45-row browser simulation;
store tests independently check cursor stability and510 unrelated records.

## PPT Font Snapshot Microbenchmark

Native run-reader corpus1791699437415, four dedicated temporary shapes, identical
basic/rich expanded arrays plus nonzero-start subrange comparisons. Order alternated;
all probes removed, original disk and neighbor IDs unchanged. API basis:
[PowerPoint TextRange.Runs](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.textrange.runs).
The reader unions legacy/modern run boundaries, falling back on unsupported/mixed
profiles; journals still use the original per-character format and fingerprints.

| Case | UTF-16 units / slices | Old basic+rich read (ms) | New read (ms) | First |
| --- | --- | --- | --- | --- |
| Mixed Latin sizes/colors | 56 / 6 | 1435.7694 | 278.1213 | old |
| Three paragraphs | 42 / 6 | 726.5892 | 141.7720 | new |
| Chinese/Arabic/combining/emoji | 19 / 9 | 348.4494 | 383.6597 | old |
| Underline/baseline offset | 46 / 9 | 800.1848 | 195.5758 | new |

These are single paired getter measurements, NOT complete tasks, model tokens,
prices or universal speedups. The fragmented19-unit case is slower. An earlier
274/339-unit two-run read showed large reductions but used new-first ordering;
do not combine these tiny samples into an overall project advantage. Actual
original Codex batch UI1791699702388 passed after optimization; this demonstrates
the previously failing chain, not a matched end-to-end latency improvement.

Readable two-frame task1791713140015 (same original Codex session): natural-language
layout request,4 tool calls including help,3 batches,92436ms send-to-observed-completion.
Final actual fonts/content/geometry/native warnings and exported slide accepted;
3 UI inverse recoveries and final fresh baseline readback passed. Intermediate
overflow warnings remain in journals, not counted as final failure. No token/price
or paired baseline was collected here; this sample proves task composition only.

## OfficeCLI1.0.156 Paired Upgrade Regression

complex1791715229484: original release binary/hash, same plans and checks through
direct engine and FileWorkspace, two rounds with reversed order. All6 paired cases
passed structured readback/validation/HTML, including Excel computed30.

| Format | Direct (ms), round0/1 | Workbench (ms), round0/1 |
| --- | --- | --- |
| Word | 6784 / 6663 | 6739 / 6638 |
| Excel | 5839 / 5820 | 5974 / 5825 |
| PPT | 4385 / 4389 | 4421 / 4407 |

Single static table help through active local API:359.99ms cold,2.74/2.33ms cached,
identical output,0 model requests/document writes. Do not compare these sample
times with old measurements to claim a version speedup: workloads/machine/cache
conditions differ. Two repetitions do not establish overall superiority or fees.

## Three-Format Model/File Tasks, 2026-10-11

`Benchmark-ModelTasks.ts` extends the narrow table test with Word title/style/body/
table, Excel cross-sheet arithmetic plus native chart, and two-slide editable PPT.
Same gateway returned `deepseek-v4-flash`; same pinned OfficeCLI1.0.156. Each mode
plans once, creates a new synthetic file, validates it, reads exact structures,
and generates HTML. No live original or chat was created/modified. No retries.
Full original element help/direct engine and selected help/FileWorkspace differ
in BOTH context and execution wrapper: do not attribute the timings to one factor.

Initial protocol1 pilot1791717633289:0/6 passed. Word properties escaped `props`,
Excel used disallowed command shapes/one truncated JSON, PPT used parent labels
instead of actual paths. All six plans/usages/failures remain. No file writes
were issued for rejected plans. This exposed insufficient batch wire guidance,
not a reason to weaken plan validation. The shared MCP command description now
shows add/set envelopes and distinguishes parent-kind labels from document paths.

Protocol2 benchmark1791717836286:6/6 passed, selected-first, one sample per task/
mode. Both modes have identical wire examples/allowed shapes; output limit3072
instead of pilot2048. Do NOT combine the two protocols into repeated samples.
`quality-audit.json` additionally checks exact Word style/table widths, Excel
values/computed30/column chart, PPT backgrounds/native textbox geometry/font,
one table/two sheets/two slides. It rechecks existing artifacts without model or
write replay and leaves original reports unchanged. First audit placed Excel
value in format instead of text; corrected against actual schema before acceptance.

| Task | Mode | Ordinary input | Cache read | Output | Model ms | Total ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Word | Full | 19199 | 256 | 373 | 2368 | 9262 |
| Word | Selected | 1699 | 0 | 396 | 1668 | 8565 |
| Excel | Full | 18173 | 256 | 996 | 5061 | 12561 |
| Excel | Selected | 1884 | 0 | 714 | 3812 | 11361 |
| PPT | Full | 13845 | 128 | 313 | 1761 | 7144 |
| PPT | Selected | 1590 | 0 | 335 | 1929 | 7308 |

Counters are gateway-reported, not verified provider billing. Selected help
reduces the observed input here, but PPT is slower and has more output tokens.
One-shot successful task outputs are NOT a matched interactive UI/terminal agent
benchmark or real Office render acceptance. No aggregate superiority, universal
success rate or monetary savings established. Each artifact remains editable;
HTML/structured audits cannot establish aesthetic quality. No more model samples
were silently retried after this12-request total exploration.

Run only with explicit `WORKBENCH_ALLOW_MODEL_BENCHMARK=1` in the designated
`E:/ccOffice测试` workspace. `WORKBENCH_MODEL_TASK_ROUNDS` permits1–2 rounds;
`WORKBENCH_MODEL_TASK_ORDER=selected-first` reverses the initial order. Neither
entrypoint is run by automated unit tests. Audit existing data with
`scripts/Audit-ModelTasks.ts PRIVATE_MODEL_TASK_REPORT_DIRECTORY`.
