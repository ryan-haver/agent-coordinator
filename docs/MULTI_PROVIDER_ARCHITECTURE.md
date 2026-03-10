# Multi-Provider Architecture

> **Status**: Phase 8 (Planned)  
> **Priority**: Foundation laid now, full implementation after Antigravity integration is proven  
> **Decision Date**: 2026-03-10

## Problem Statement

The Agent Coordinator is currently hardcoded to spawn agents through a single backend: the Antigravity IDE via the Agent Bridge extension on `localhost:9090`. This creates three limitations:

1. **Model selection is global** — Antigravity's active model applies to all conversations. You can't run agent α on Claude and agent β on Gemini simultaneously within the same IDE instance.

2. **IDE lock-in** — The system only works inside Antigravity. Users who prefer Claude Code, Cursor, Windsurf, or headless operation are excluded.

3. **Single point of failure** — If the Antigravity Bridge goes down, all agent spawning stops. There's no fallback to a different provider.

## Vision

A **provider-agnostic orchestrator** where the MCP server doesn't know or care _how_ agents run — it specifies _what_ needs to happen, and a provider registry routes to the best available backend.

```
MCP Server (50 tools — the brain)
  │
  ├── ProviderRegistry
  │     ├── AntigravityProvider (:9090) → Gemini Pro, Flash
  │     ├── ClaudeCodeProvider (CLI)    → Claude Opus, Sonnet
  │     ├── CodexProvider (CLI)         → OpenAI Codex, o3
  │     ├── OhMyAgProvider (CLI)        → Multi-vendor via oh-my-ag
  │     └── HeadlessProvider (HTTP)     → vLLM, Ollama, OpenClaw
  │
  └── Dashboard (config + monitoring)
        ├── VS Code Extension webview
        └── Standalone web UI (for headless deployments)
```

## Provider Interface

Every backend implements this contract:

```typescript
interface AgentProvider {
  /** Provider identifier */
  readonly name: string;
  
  /** Models this provider can serve */
  readonly models: string[];
  
  /** Capabilities: "file-edit", "terminal", "browser", "mcp", "git" */
  readonly capabilities: string[];
  
  /** Whether this provider is currently available */
  ping(): Promise<ProviderHealth>;
  
  /** Spawn a new agent with the given prompt */
  spawn(prompt: string, opts: SpawnOptions): Promise<SpawnResult>;
  
  /** Get status of a running agent */
  getAgentStatus(conversationId: string): Promise<AgentStatus>;
  
  /** List active conversations/sessions */
  listSessions(): Promise<SessionInfo[]>;
  
  /** Stop an agent */
  stop(conversationId: string): Promise<void>;
}
```

## Provider Implementations

| Provider | Spawn Mechanism | MCP Support | Model Access | Status |
|----------|---------------|-------------|-------------|--------|
| **Antigravity** | HTTP POST to `:9090` bridge | ✅ Native | Gemini, Claude*, GPT* | ✅ Implemented |
| **Claude Code** | `claude --print --allowedTools` | ✅ Via `--mcp-config` | Claude family | 🔜 Next |
| **Codex** | `codex --approval-mode full-auto` | ❌ Not yet | OpenAI family | 📋 Planned |
| **oh-my-ag** | `oh-my-ag --approval-mode=yolo` | ✅ Via config | Multi-vendor | 📋 Planned |
| **Headless/vLLM** | Raw HTTP API | Via agent loop | Any local model | 📋 Planned |

*Antigravity provides access to multiple vendors but with global model selection.

## Routing Strategy

The existing `get_routing_recommendation` tool returns a model name. This needs to become provider-aware:

```typescript
// Before (current)
{ model: "gemini-3-pro-high" }

// After (multi-provider)
{ 
  model: "claude-sonnet-4.5",
  provider: "claude-code",       // which backend to use
  fallback: {
    model: "gemini-3-pro-high",
    provider: "antigravity"
  }
}
```

## Deployment Modes

### 1. VS Code Extension (Primary)
- Agent Coordinator runs as a VS Code extension
- Providers discovered via extension settings
- Dashboard rendered in webview panel
- Best for single-developer use

### 2. Standalone Server
- MCP server runs as a standalone Node.js process
- Providers configured via `providers.json`
- Dashboard served via embedded HTTP server
- Best for CI/CD, headless operations, team use

### 3. Hybrid
- VS Code extension for the PM agent (interactive)
- Standalone providers for worker agents (headless)
- Mixed provider fleet

## Configuration

### Global Dashboard Settings

A unified configuration that works in both VS Code and standalone modes:

```json
{
  "providers": {
    "antigravity": {
      "enabled": true,
      "type": "http",
      "endpoint": "http://127.0.0.1:9090",
      "models": ["gemini-3-pro", "gemini-3-flash"],
      "maxConcurrent": 3,
      "priority": 1
    },
    "claude-code": {
      "enabled": true,
      "type": "cli",
      "command": "claude",
      "args": ["--print", "--allowedTools", "*", "--mcp-config", "./mcp.json"],
      "models": ["claude-opus-4.5", "claude-sonnet-4.5"],
      "maxConcurrent": 2,
      "priority": 2
    },
    "codex": {
      "enabled": false,
      "type": "cli",
      "command": "codex",
      "args": ["--approval-mode", "full-auto"],
      "models": ["codex", "o3"],
      "maxConcurrent": 1,
      "priority": 3
    }
  },
  "routing": {
    "strategy": "cost-optimized",
    "fallbackChain": ["antigravity", "claude-code", "codex"]
  },
  "rateLimits": {
    "globalMaxConcurrent": 5,
    "globalMaxPerHour": 50,
    "cooldownMs": 5000
  }
}
```

### Per-Workspace Overrides

```json
// .agent/providers.json in workspace root
{
  "providers": {
    "antigravity": { "maxConcurrent": 1 },
    "claude-code": { "enabled": false }
  }
}
```

## Implementation Phases

### Phase 8A: Provider Interface Extraction (Now)
- Extract `AgentProvider` interface from existing `BridgeClient`
- Create `ProviderRegistry` with register/discover/route
- Refactor `BridgeClient` → `AntigravityProvider`
- Update `spawn_agent` to accept optional `provider` field
- **Zero behavior change** — Antigravity remains the only and default provider

### Phase 8B: Claude Code Provider
- Add `ClaudeCodeProvider` (subprocess-based)
- Test with `claude --print` CLI
- Multi-provider routing in `spawn_agent`

### Phase 8C: Dashboard
- VS Code webview for provider management
- Standalone web UI option
- Per-workspace configuration

### Phase 8D: Additional Providers
- Codex CLI provider
- oh-my-ag provider
- Headless/vLLM HTTP provider
- Community provider SDK

## Key Design Decisions

1. **Provider as a runtime concept, not a build dependency** — Providers are registered at startup, not compiled in. A user with only Claude Code installed shouldn't need Antigravity packages.

2. **Rate limiting is per-provider AND global** — Each provider has its own `maxConcurrent`, plus there's a `globalMaxConcurrent` across all providers.

3. **Backward compatible** — `spawn_agent` without a `provider` field uses the default provider (Antigravity). All existing workflows continue to work unchanged.

4. **Configuration hierarchy** — Global defaults → per-provider settings → per-workspace overrides. VS Code settings or standalone `providers.json` are both valid sources.

5. **The MCP server is the brain, not the providers** — Providers are dumb execution backends. All coordination logic (manifest, file claims, phase gates, verification) stays in the MCP server regardless of which provider spawned the agent.
