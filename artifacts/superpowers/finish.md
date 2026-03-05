# Milestone 3: TimescaleDB Telemetry — Finish

## Verification

| Command | Result |
| ------- | ------ |
| `npx tsc --noEmit` | ✅ Clean |
| `npm test` | ✅ 73/73 pass (4 files) |
| Docker container | ✅ Pulled + healthy |

## Summary

| File | Purpose |
| ---- | ------- |
| `docker-compose.telemetry.yml` | TimescaleDB on port 5433 (isolated) |
| `src/storage/schema.ts` | v2: `telemetry_buffer` table + indexes |
| `src/storage/migrations.ts` | Incremental runner: v1→v2 migration |
| `src/telemetry/tsdb-schema.sql` | `tool_calls` hypertable DDL |
| `src/telemetry/client.ts` | `TelemetryClient` (SQLite buffer + TSDB drain) |
| `src/handlers/telemetry.ts` | 4 MCP query tools |
| `tests/telemetry.test.ts` | 17 new tests |

## Commit: `d54793e`

## Activation

```bash
# Start TimescaleDB
docker compose -f docker-compose.telemetry.yml up -d

# Enable telemetry
export TSDB_URL=postgresql://coordinator:coordinator_dev@localhost:5433/telemetry

# Verify schema
psql $TSDB_URL -c "\dt"
```

## Follow-ups

- [ ] Grafana dashboard over `tool_calls` hypertable
- [ ] Retention policy (e.g. drop rows > 90 days)
- [ ] `push_telemetry_rollup` tool for post-downtime drain from agent prompt
- [ ] Milestone 4: Qdrant Semantic Memory
