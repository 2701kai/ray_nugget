# Storage latency baseline

Run against real browser IndexedDB using Bun and the installed Playwright browser:

```sh
bun run bench:storage
PETE_BENCH_CPU_RATE=4 bun run bench:storage
PETE_BENCH_BROWSER=webkit bun run bench:storage
```

The command starts its own loopback server and a fresh browser profile. It never
opens the deployed app or calls transcription. Each scenario creates an isolated
`pete-benchmark-*` database and deletes that database afterward. Existing app data
is not opened. JSON reports are written under Git-excluded `runs/performance/`.

The workload uses 50 and 500 synthetic visitors with two completed historical jobs
per visitor and about 2 KiB of source text per job. Twenty measurements per scenario
cover both the ordinary index and the fallback used for the reported WebKit error:

- **Idle queue lookup:** completing a claim transaction when no eligible work exists.
- **Save 1 MiB:** SHA-256 hashing, atomic original/metadata/job commit, and the job-list
  refresh, while a second processing lane competes for the database transaction.

After reopening, every captured file is checked by SHA-256, attachment counts and
visitor ownership. The historical source files are tiny synthetic placeholders;
the timed saves use opaque 1 MiB binary payloads, not actual photographs.

Provisional lab budgets were set before optimization: p95 below 50 ms for idle
lookup and 250 ms for save. `PETE_BENCH_ENFORCE=1` exits unsuccessfully if a budget
is exceeded. These are development targets, not phone guarantees or CI timing
assertions. Run without other heavy tasks; CPU throttling varies with the host.

The measurements exclude camera/file picking, URI loading, rendering, real OCR,
audio recording, cloud/network latency and OS storage eviction. The fallback is
activated before the timed samples, so its first error and rollback are excluded.
The script records browser version and CPU information. It does not emulate an
iPhone merely by selecting WebKit or slowing Chromium. Physical-device timing
remains necessary before making product performance claims.

The fallback reads bounded batches of 256 jobs within the original atomic claim
transaction. It still checks all pages for the earliest eligible job and preserves
lease ownership across tabs. The ordinary index remains the normal path. No queue
schema, source-media storage, or transcription behavior changes are needed.

## Recorded baseline — 2026-10-27

500 visitors / 1,000 historical jobs, Linux x64, Intel i5-1235U, 20 samples.
Values below are p95 milliseconds from individual runs, not guaranteed bounds.

| Browser and lookup | Idle lookup | Save 1 MiB |
| --- | ---: | ---: |
| Chromium 156.0.8078.4, 4× CPU throttle, previous cursor fallback | 100.3 | 424.6 |
| Same Chromium configuration, bounded batch fallback | 47.7 | 100.5 |
| Desktop WebKit, no CPU throttle, bounded batch fallback | 14.0 | 31.0 |

The same-workload comparison supports batching as a reduction in capture delay
while the fallback is active. It does not measure end-to-end photo capture or
cloud transcription. Physical phone performance remains unmeasured.
