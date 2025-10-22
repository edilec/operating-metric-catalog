# Operating Metric Catalog

`TOOL_ID=operating-metric-catalog`. Zero-dependency Node 22+ reporter for local, exported metric catalogs. It reads one JSON document and writes only a report to stdout. The package exports `TOOL_ID`, `LIMITS`, and `validateCatalog(document)` for direct use.

```sh
node bin/operating-metric-catalog.mjs --root examples --input passing.json
node bin/operating-metric-catalog.mjs --root examples --input failing.json
npm run check
```

The examples exit `0` and `1`, respectively. `--help` prints usage; `--human` adds a brief summary on stderr. Input must be a file inside the real `--root`; an escaping symlink is refused. The CLI never fetches a dashboard or writes to the input. Standard output is a deterministic version 1 JSON report; diagnostics and bad usage go to standard error.

## Input

The document has `schemaVersion: "1"`, `asOf` (`YYYY-MM-DD`), `reviewEveryDays` (1–3650), `metrics`, and `dashboards`. A metric requires an opaque `id`, human `definition`, authoritative `formula` (opaque text, never evaluated), `unit`, `grain`, `owner`, `decisionUse`, `reviewedAt`, and `threshold` with `operator` (`min` or `max`) and a nonnegative decimal-string `value` (up to 12 whole and 6 fractional digits). A dashboard reference requires `label` and `metricId`, and may carry a displayed `formula`. The displayed formula is compared with the catalog; a dashboard label never supplies or changes the authoritative formula. Fields may contain private operations terms and are therefore not copied into reports.

Review age uses UTC calendar days from `reviewedAt` through `asOf`. Exactly `reviewEveryDays` old is current; one day older fails. Duplicate IDs make catalog evidence ambiguous. Identical definitions across distinct IDs and one definition label attached to conflicting formulas, units, or grains are reported. A reused dashboard label pointing at different metric IDs is reported. The tool compares formulas as supplied and does not parse their language or infer semantic equivalence.

## Rules and exits

Findings use `@input` as the logical provenance role, not a host path, with zero-based JSON Pointers into the exact file given to `--input`. They sort by `(file, pointer, ruleId)` in code-unit order. Messages are fixed and do not echo IDs, formulas, owners, labels, paths, or malformed JSON snippets.

| Rule | Severity | Result |
| --- | --- | --- |
| `input-unreadable`, `input-invalid`, `byte-limit`, `record-limit`, `depth-limit`, `time-limit` | warning | incomplete |
| `no-metrics`, `metric-invalid`, `metric-id-duplicate`, `dashboard-invalid`, `dashboard-metric-unknown` | warning | incomplete |
| `definition-duplicate`, `definition-conflict`, `dashboard-formula-conflict`, `dashboard-label-conflict`, `review-overdue` | error | fail |

Exit `0` means pass, `1` means evaluated policy failure, and `2` means incomplete evidence or invalid usage. Invalid usage has empty stdout; unreadable, non-UTF-8, malformed, over-limit, or unsupported input yields an incomplete JSON report. A finding of incomplete evidence takes precedence over failures in the overall status; known failures remain listed.

Limits: 1,048,576 bytes per input, 1,000 metric records, 1,000 dashboard references, JSON depth 16, and 5,000 ms evaluation time. Exactly the bound is legal; N+1 is incomplete. This validates the supplied catalog only. It does not calculate metric values, authenticate owners, verify dashboard rendering, fetch lineage, or certify that a threshold is appropriate.
