# Operations Guide

> Setup, configuration, and troubleshooting for the Agent Coordinator MCP server.

---

## Quick Start

```powershell
# 1. Clone and install
git clone https://github.com/ryan-haver/agent-coordinator.git
cd agent-coordinator
.\install.ps1

# 2. Verify
# Open Antigravity → type: /health

# 3. Optional: start data backends
docker compose -f docker-compose.telemetry.yml up -d
```

---

## Docker Services

The MCP server runs standalone (no Docker required). Docker is only needed for optional backends:

```powershell
# Start all services
docker compose -f docker-compose.telemetry.yml up -d

# Start individual services
docker compose -f docker-compose.telemetry.yml up -d timescaledb
docker compose -f docker-compose.telemetry.yml up -d qdrant

# Check status
docker compose -f docker-compose.telemetry.yml ps

# Stop
docker compose -f docker-compose.telemetry.yml down
```

### Health Checks

```powershell
# TimescaleDB
pg_isready -h localhost -p 5433 -U coordinator -d telemetry

# Qdrant
curl http://localhost:6333/healthz
```

### Data Volumes

| Service | Volume | Data |
|---------|--------|------|
| TimescaleDB | `agent_coordinator_tsdb_data` | Tool call telemetry |
| Qdrant | `agent_coordinator_qdrant_data` | Vector embeddings |

To reset data:

```powershell
docker compose -f docker-compose.telemetry.yml down -v
```

---

## Environment Variables

Copy `.env.example` to `.env` and customize. All variables have safe defaults:

| Variable | Default | Purpose |
|----------|---------|---------|
| `STORAGE_BACKEND` | `file` | Storage backend: `file` or `sqlite` |
| `TSDB_URL` | _(unset)_ | TimescaleDB connection string. If unset, telemetry buffers to SQLite only |
| `TSDB_PASSWORD` | `coordinator_dev` | TimescaleDB password |
| `QDRANT_URL` | _(unset)_ | Qdrant REST URL. If unset, all memory tools return "not configured" |
| `TELEMETRY_ENABLED` | `true` | Enable/disable telemetry recording |
| `TELEMETRY_BUFFER_TTL_HOURS` | `168` | Hours to keep telemetry in SQLite buffer |
| `WORKSPACE_ROOT` | _(auto-detected)_ | Override workspace root |

### Recommended Settings

**Development (local, no Docker):**

```
STORAGE_BACKEND=file
# No TSDB_URL, no QDRANT_URL
```

**Development (with Docker backends):**

```
STORAGE_BACKEND=sqlite
TSDB_URL=postgresql://coordinator:coordinator_dev@localhost:5433/telemetry
QDRANT_URL=http://localhost:6333
```

**Production swarms:**

```
STORAGE_BACKEND=sqlite
TSDB_URL=postgresql://coordinator:<password>@<host>:5433/telemetry
QDRANT_URL=http://<host>:6333
```

---

## Storage Backend Selection

| Backend | Best For | Pros | Cons |
|---------|----------|------|------|
| `file` | Simple tasks, single agent | No dependencies, human-readable | No atomic writes, no queries |
| `sqlite` | Multi-agent swarms, production | Atomic writes, queryable, resilient | Requires `better-sqlite3` |

Switch backend:

```powershell
$env:STORAGE_BACKEND = "sqlite"
# Restart MCP server
```

---

## Telemetry Setup

### SQLite Buffer (always active)

When `TELEMETRY_ENABLED=true`, every tool call is recorded to a local SQLite database at `<workspace>/.agent-coordinator/telemetry.db`.

### TimescaleDB (optional)

1. Start TimescaleDB:

   ```powershell
   docker compose -f docker-compose.telemetry.yml up -d timescaledb
   ```

2. Set connection string:

   ```powershell
   $env:TSDB_URL = "postgresql://coordinator:coordinator_dev@localhost:5433/telemetry"
   ```

3. Schema is auto-created on first connection. The `tool_calls` hypertable is partitioned by `called_at`.

4. Buffered rows drain every 30 seconds from SQLite → TSDB.

### Monitoring Queries

```sql
-- Total calls by tool (last 24h)
SELECT tool_name, COUNT(*) as calls, AVG(duration_ms)::int as avg_ms
FROM tool_calls
WHERE called_at > NOW() - INTERVAL '24 hours'
GROUP BY tool_name
ORDER BY calls DESC;

-- Failure rate by agent
SELECT agent_id, COUNT(*) FILTER (WHERE NOT success) * 100.0 / COUNT(*) as failure_pct
FROM tool_calls
GROUP BY agent_id;
```

---

## Semantic Memory Setup

### Prerequisites

1. Start Qdrant:

   ```powershell
   docker compose -f docker-compose.telemetry.yml up -d qdrant
   ```

2. Set URL:

   ```powershell
   $env:QDRANT_URL = "http://localhost:6333"
   ```

3. **First use:** The embedding model (`Xenova/all-MiniLM-L6-v2`, ~40MB) downloads automatically on the first `store_memory` or `semantic_search` call. Cached at `~/.cache/Xenova/`.

### Collections

4 collections are created automatically on startup:

- `agent_notes` — handoff notes, decisions
- `code_snippets` — code fragments
- `project_docs` — specs, plans
- `issues` — bugs and resolutions

---

## Testing

```powershell
cd src/mcp-server

# Unit tests only
npm test

# Integration tests only
npm run test:integration

# All tests
npm run test:all

# Specific milestone
npx vitest run tests/integration/m4-qdrant.test.ts
```

### Milestone Gate

```powershell
pwsh scripts/integration-gate.ps1
```

The gate script runs:

1. TypeScript compilation check (production + test configs)
2. Unit tests
3. Integration tests

**Exit code 0 required before any milestone can be closed.**

Use `--SkipTsdb` to skip TimescaleDB-dependent tests:

```powershell
pwsh scripts/integration-gate.ps1 -SkipTsdb
```

---

## Troubleshooting

### TimescaleDB: "connection refused"

```powershell
# Check if container is running
docker compose -f docker-compose.telemetry.yml ps timescaledb

# Check logs
docker compose -f docker-compose.telemetry.yml logs timescaledb

# Wait for healthcheck
docker compose -f docker-compose.telemetry.yml up -d timescaledb
sleep 5
pg_isready -h localhost -p 5433
```

### Qdrant: "not configured" even with QDRANT_URL set

1. Verify Qdrant is healthy: `curl http://localhost:6333/healthz`
2. Ensure env var is set **before** MCP server starts
3. Check server logs for `[memory] Qdrant init failed` message

### Embedding model download hangs

- Check internet connectivity
- Set `TRANSFORMERS_CACHE` to a writable directory
- Download manually: `node -e "import('@xenova/transformers').then(m => m.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2'))"`

### Integration tests fail with "Unknown tool"

New tools must be registered in **both**:

1. `src/handlers/tool-definitions.ts` (schema)
2. `src/handlers/index.ts` (handler map)

### SQLite: "database is locked"

Reduce concurrent access. The `withManifestLock()` method uses SQLite's WAL mode, but heavy concurrent writes can still cause contention.
