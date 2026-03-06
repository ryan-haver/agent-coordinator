# Developer Guide

> How to extend, test, and maintain the Agent Coordinator MCP server.

---

## Adding a New MCP Tool

Follow these 4 steps to add a new tool:

### 1. Define the Schema

Add your tool schema to `src/mcp-server/src/handlers/tool-definitions.ts`:

```typescript
{
    name: "my_new_tool",
    description: "What this tool does — shown to agents in tool listing",
    inputSchema: {
        type: "object",
        properties: {
            required_arg: { type: "string", description: "What this arg does" },
            optional_arg: { type: "number", description: "Optional description" },
            workspace_root: { type: "string", description: "Optional workspace root override" }
        },
        required: ["required_arg"]
    }
}
```

### 2. Write the Handler

Create or extend a handler file in `src/mcp-server/src/handlers/`:

```typescript
import type { ToolResponse } from "./context.js";
import { resolveWorkspaceRoot } from "./context.js";
import { getStorage } from "../storage/singleton.js";

export async function handleMyNewTool(args: Record<string, unknown>): Promise<ToolResponse> {
    const required_arg = args?.required_arg as string;
    if (!required_arg) throw new Error("Missing required argument: required_arg");

    const wsRoot = resolveWorkspaceRoot(args);
    const storage = getStorage();

    // Your logic here...

    return {
        content: [{ type: "text", text: "Result message shown to agent" }]
    };
}
```

### 3. Register in the Handler Map

Add to `src/mcp-server/src/handlers/index.ts`:

```typescript
import { handleMyNewTool } from "./my-module.js";

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
    // ... existing tools ...
    my_new_tool: handleMyNewTool,
};
```

### 4. Add Integration Test

Add a test in the appropriate `tests/integration/` file:

```typescript
it("my_new_tool does something useful", async () => {
    const result = await server.callTool("my_new_tool", {
        required_arg: "test value",
        workspace_root: fixture.tmpDir
    });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("expected output");
});
```

### Verify

```powershell
npx tsc --noEmit                    # Types check
npm test                            # Unit tests
npm run test:integration            # Integration tests
pwsh scripts/integration-gate.ps1   # Full gate
```

---

## Adding a Qdrant Collection

1. Edit `src/mcp-server/src/memory/collections.ts`:

```typescript
export type CollectionName =
    | "agent_notes"
    | "code_snippets"
    | "project_docs"
    | "issues"
    | "my_new_collection";    // ← add here

export const ALL_COLLECTIONS: CollectionName[] = [
    "agent_notes", "code_snippets", "project_docs", "issues",
    "my_new_collection"       // ← add here
];

export const COLLECTION_DESCRIPTIONS: Record<CollectionName, string> = {
    // ... existing ...
    my_new_collection: "Description of what goes here"
};
```

1. Update the `validCollections` array in `handleStoreMemory` (`handlers/memory.ts`).

2. Collections are auto-created on next server startup (idempotent).

No migrations needed. All collections share the same vector config (384-dim cosine).

---

## Storage Adapter Pattern

### Interface

`src/storage/adapter.ts` defines the `StorageAdapter` contract. All handler modules call `getStorage()` to get the active adapter.

### Adding a Storage Method

1. Add the method signature to the `StorageAdapter` interface
2. Implement in `FileStorageAdapter` (`file-adapter.ts`)
3. Implement in `SqliteStorageAdapter` (`sqlite-adapter.ts`)
4. If SQLite: add migration in `migrations.ts` and bump version in `schema.ts`

### Singleton

```typescript
import { initStorage, getStorage, resetStorage } from "../storage/singleton.js";

initStorage("sqlite");           // Called once at startup
const storage = getStorage();    // Called in every handler
resetStorage();                  // Called in test cleanup
```

---

## Testing Conventions

### Structure

```
src/mcp-server/
├── tests/
│   ├── *.test.ts                    ← Unit tests
│   └── integration/
│       ├── helpers/
│       │   ├── server.ts            ← createTestServer() harness
│       │   └── fixtures.ts          ← createFixture() temp dirs
│       ├── m1-handlers.test.ts      ← M1: core handlers
│       ├── m2-sqlite.test.ts        ← M2: SQLite backend
│       ├── m3-telemetry.test.ts     ← M3: telemetry pipeline
│       └── m4-qdrant.test.ts        ← M4: semantic memory
```

### Test Harness

`createTestServer()` spins up a full MCP server + client in-process using `InMemoryTransport`:

```typescript
const server = await createTestServer(fixture.tmpDir, { backend: "file" });
const result = await server.callTool("tool_name", { arg: "value" });
expect(result.isError).toBe(false);
await server.close();
```

### Part A / Part B Pattern

For soft-dependency features (TimescaleDB, Qdrant), tests are split:

- **Part A (always runs):** Tests graceful degradation when the backend is unavailable
- **Part B (conditional):** Tests live functionality, skipped when env var not set

```typescript
const hasQdrant = !!process.env.QDRANT_URL;

describe("Part A — graceful no-op", () => {
    it("returns informational text, isError: false", async () => { ... });
});

describe.skipIf(!hasQdrant)("Part B — live Qdrant", () => {
    it("stores and retrieves vectors", async () => { ... });
});
```

### Running Tests

```powershell
npm test                      # Unit tests (excludes integration/)
npm run test:integration      # Integration tests only
npm run test:all              # Everything
```

---

## Integration Gate

`scripts/integration-gate.ps1` is the mandatory quality gate:

1. `npx tsc --noEmit` — prod config
2. `npx tsc -p tsconfig.test.json --noEmit` — test config
3. `npm test` — unit tests
4. `npm run test:integration` — integration tests

**Rule: No milestone ships until the gate exits 0.**

The gate script:

- Provides colored output (green pass, red fail)
- Supports `--SkipTsdb` flag for environments without TimescaleDB
- Exits with code 0 only if ALL checks pass

---

## Code Organization

### Handler Responsibilities

Each handler module owns a specific domain. Handlers should:

- Validate required args (throw on missing)
- Call `resolveWorkspaceRoot(args)` for workspace path
- Call `getStorage()` for the active storage adapter
- Return `ToolResponse` with `content` array
- Throw on errors (the router wraps in `isError: true`)
- For soft dependencies, return informational text (not throw)

### Shared Context (`context.ts`)

- `resolveWorkspaceRoot(args?)` — 4-strategy workspace resolution
- `ToolResponse` — standard response shape
- `ToolHandler` — handler function signature
- `globalConfigPath` — `~/.antigravity-configs/`

### Telemetry Instrumentation

The router in `src/index.ts` automatically instruments every tool call:

```
→ Record start time
→ Call handler
→ Record end time, success/failure, duration
→ Write to TelemetryClient (SQLite buffer + optional TSDB)
```

No handler needs to care about telemetry — it's automatic.
