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
