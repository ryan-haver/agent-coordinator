# Integration Test Framework — Finish Summary

## What Was Built

| File | Purpose |
|---|---|
| `tests/integration/helpers/server.ts` | `createTestServer()` — InMemoryTransport harness |
| `tests/integration/helpers/fixtures.ts` | `createFixture()` — isolated tmpDir per test |
| `tsconfig.test.json` | IDE type resolution for test files |
| `tests/integration/m1-handlers.test.ts` | 15 M1 handler integration tests |
| `tests/integration/m2-sqlite.test.ts` | 9 M2 SQLite backend tests |
| `tests/integration/m3-telemetry.test.ts` | 9 M3 telemetry tests (7 always + 2 TSDB) |
| `scripts/integration-gate.ps1` | Mandatory milestone gate (tsc + unit + integration) |

## Verification Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ pass |
| `npx tsc -p tsconfig.test.json --noEmit` | ✅ pass |
| `npm test` (unit) | ✅ 74/74 pass |
| `npm run test:integration` (no TSDB) | ✅ 31 pass, 2 skip |
| `pwsh scripts/integration-gate.ps1` | ✅ exit 0 |

## Key Findings (integration test insights)

1. **`add_agent_to_manifest` writes to `manifest_content` blob** in SQLite mode — not directly to the `agents` table. `getAgent()` reads the `agents` table → fails for agents added via manifest update. This is a known architectural gap (M2 milestone note).

2. **`get_my_assignment` requires agent in `agents` table** — only works after `storage.addAgent()` is called, not just manifest write. Integration tests verified this boundary.

3. **Telemetry buffer correctly records** success/fail/duration/args_summary to SQLite on every tool call. All 4 MCP telemetry query tools work against the local buffer.

## Permanent Gate Rule

> No milestone closes without running: `pwsh scripts/integration-gate.ps1` → exit 0

The 2 TSDB tests in Part B are skipped when `TSDB_URL` is not set. To run full TSDB validation:

```powershell
$env:TSDB_URL = "postgresql://coordinator:coordinator_dev@localhost:5433/telemetry"
pwsh scripts/integration-gate.ps1
```

## Follow-ups

- [ ] **M2 gap**: `add_agent_to_manifest` should call `storage.addAgent()` after updating manifest — so `getAgent()` works in SQLite mode. (Not blocking M4, but worth fixing in M5 docs sprint.)
- [ ] **M4 Qdrant**: add `tests/integration/m4-qdrant.test.ts` before closing M4
- [ ] **TSDB CI**: automate Part B tests in a Docker-integrated CI pipeline
