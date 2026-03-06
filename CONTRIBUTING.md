# Contributing to Agent Coordinator

## Prerequisites

- **Node.js 20+** and **npm**
- **Docker** (optional — for Part B integration tests with live backends)

## Dev Setup

```bash
cd src/mcp-server
npm ci
```

## Running Tests

```bash
# Unit tests (74 tests, no dependencies)
npm test

# Integration tests — Part A only (SQLite fallback, no Docker needed)
npm run test:integration

# Full suite (unit + integration)
npx vitest run --test-timeout=10000
```

### Part B Tests (Live Backends)

Part B tests require TimescaleDB and Qdrant. Start them with Docker:

```bash
docker compose -f docker-compose.test.yml up -d
TSDB_URL=postgres://test:test@localhost:5432/coordinator_test \
  QDRANT_URL=http://localhost:6333 \
  npm run test:integration
docker compose -f docker-compose.test.yml down
```

Or use the CI test runner:

```powershell
pwsh scripts/ci-test.ps1           # Runs Part A only
pwsh scripts/ci-test.ps1 -SkipPartB:$false  # Runs Part A + Part B (starts Docker)
```

## Type Checking

```bash
npx tsc --noEmit
```

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | When |
|--------|------|
| `feat(scope)` | New feature or tool |
| `fix(scope)` | Bug fix |
| `docs(scope)` | Documentation only |
| `ci(scope)` | CI/CD changes |
| `chore(scope)` | Maintenance (deps, cleanup) |
| `refactor(scope)` | Code restructure, no behavior change |

Examples:
```
feat(6C): temporal RAG tools (get_swarm_history, compare_models)
fix(6A): SQLite agent gap, agent_events hypertable
docs(7.1): ROADMAP deep rewrite — SpacetimeDB to SQLite
ci(7): GitHub Actions CI workflow
```

## Architecture

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — system design, data flow, backend architecture
- **[TOOL-REFERENCE.md](docs/TOOL-REFERENCE.md)** — all 41 MCP tools with parameters and examples
- **[ROADMAP.md](docs/ROADMAP.md)** — project phases, decisions, and future plans
- **[MCP-COVERAGE-GAPS.md](docs/MCP-COVERAGE-GAPS.md)** — gap analysis and resolution tracking

## Project Structure

```
src/mcp-server/
  src/
    handlers/        # 10 domain-specific handler modules
    storage/         # StorageAdapter (file + SQLite backends)
    telemetry/       # Dual-write telemetry (SQLite buffer + TSDB)
    memory/          # Qdrant semantic memory client
    utils/           # File mutex, manifest parser, swarm registry
    index.ts         # MCP server entry point + tool router
  tests/
    *.test.ts        # Unit tests
    integration/     # Integration tests (Part A + Part B)
```
