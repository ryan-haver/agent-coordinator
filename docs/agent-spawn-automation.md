# Antigravity Agent Spawn Automation — Implementation Reference

> **Goal:** Enable the Agent Coordinator's `/swarm` workflow to programmatically spawn agents in Google Antigravity, eliminating the manual "open Agent Manager → paste prompt" step.

---

## Discovered API Surface

Extension: `google.geminicodeassist-2.74.0-universal` (14.6 MB compiled bundle)

### VS Code Commands (Key Subset of 45 Total)

| Command | Title |
|---------|-------|
| `geminicodeassist.startagent` | Start Agent |
| `geminicodeassist.stopagent` | Stop Agent |
| `geminicodeassist.chat.new` | New Chat |
| `geminicodeassist.chat.resume` | Resume Previous Chat |
| `geminicodeassist.chat.fork` | Fork Chat |
| `cloudcode.gemini.chatView.focus` | Open Chats |
| `gemini-cli.runGeminiCLI` | Run Gemini CLI |

### Internal Context Keys

- `newChatIsAgent` — New chats should use agent mode
- `lastChatModeWasAgent` — Last chat was agent mode

### Language Server RPC Endpoints (JSON-RPC over HTTPS)

| Method | Purpose |
|--------|---------|
| `conversation/startSession` | Start a new session |
| `conversation/agent/chat` | Send a message in agent mode |
| `conversation/agent/confirmToolCall` | Approve a tool call |
| `conversation/agent/executeCommand` | Execute a command within agent |
| `conversation/chat` | Regular chat message |
| `conversation/chat/getHistory` | Retrieve chat history |
| `conversation/chat/getA2aTaskId` | Agent-to-Agent task ID |
| `conversation/chat/updateHistory` | Update history |
| `conversation/fork` | Fork a conversation |
| `conversation/resume` | Resume a conversation |
| `conversation/startSession` | Create a new session |
| `conversation/suggestions` | Suggestion chips |

### Language Server HTTP API (Already Used)

URL pattern: `https://127.0.0.1:{PORT}/exa.language_server_pb.LanguageServerService/{METHOD}`

Auth: `X-Codeium-Csrf-Token` header (extracted from process command line)

Known working: `GetUserStatus` (used by `quota_check.ps1`)

---

## Path 1: VS Code Command Bridge Extension

### Concept

A lightweight VS Code extension that watches for spawn requests from the MCP server and translates them into `vscode.commands.executeCommand()` calls.

### Architecture

```
MCP Server (spawn_agent tool)
    → writes spawn_request.json to ~/.antigravity-configs/spawn/
        → Bridge Extension (FileSystemWatcher)
            → vscode.commands.executeCommand('geminicodeassist.chat.new')
            → vscode.commands.executeCommand('geminicodeassist.startagent')
            → writes spawn_result.json
```

### Implementation Steps

1. **Scaffold Extension** — `npx -y yo code` → TypeScript extension
2. **FileSystemWatcher** — Watch `~/.antigravity-configs/spawn/*.json`
3. **Command Dispatch** — Parse request, call `executeCommand`
4. **Result Callback** — Write result JSON (success/failure/chat-id)
5. **MCP Integration** — Add `spawn_agent` tool to MCP server that writes the request file and polls for result

### Key Questions to Resolve

- Does `geminicodeassist.startagent` accept arguments (prompt text, workspace)?
- Does `geminicodeassist.chat.new` accept a pre-filled prompt?
- Can we get a session/chat ID back to track the spawned agent?

### Testing Plan

1. Open VS Code debug console (Ctrl+Shift+I)
2. Run: `vscode.commands.executeCommand('geminicodeassist.chat.new')`
3. Observe: does a new chat open? Does it accept args?
4. Run: `vscode.commands.executeCommand('geminicodeassist.startagent')`
5. Observe: does agent mode activate?

### Pros/Cons

- ✅ Uses official, stable command surface
- ✅ Future-proof — commands are part of the extension's public API
- ❌ Requires installing a separate bridge extension
- ❌ No guarantee commands accept prompt arguments (may need clipboard injection)
- ❌ File-based IPC adds latency (~500ms polling)

---

## Path 2: Direct JSON-RPC to Language Server

### Concept

Bypass the extension entirely. Talk directly to the Gemini language server process using the same HTTPS+CSRF pattern as `quota_check.ps1`, but send `conversation/startSession` and `conversation/agent/chat` RPC calls.

### Architecture

```
MCP Server (spawn_agent tool)
    → Find language_server_windows_x64.exe (WMI)
    → Extract CSRF token + port (process command line + netstat)
    → POST https://127.0.0.1:{PORT}/... with JSON-RPC payload
        → conversation/startSession  (create session)
        → conversation/agent/chat    (send prompt)
    → Return session ID to caller
```

### Implementation Steps

1. **Extract Connection Details** — Reuse `quota_check.ps1` logic (PID → CSRF → port)
2. **Discover RPC Payload Format** — Intercept a real `startSession` call:
   - Use Fiddler/mitmproxy on the language server port
   - OR set a breakpoint in the extension's `sendRequest` path
   - OR try minimal payloads: `{ "prompt": "hello" }`, `{ "message": "hello", "isAgent": true }`
3. **Build `agent_spawn.ps1`** — PowerShell script that:
   - Finds the language server
   - Sends `conversation/startSession` with agent mode
   - Sends `conversation/agent/chat` with the swarm prompt
   - Returns the session ID
4. **MCP Integration** — Call the script from the `spawn_agent` tool handler
5. **Node.js Port** — Optionally rewrite in TypeScript for cross-platform

### Key Questions to Resolve

- What is the exact JSON payload shape for `conversation/startSession`?
- Does the language server accept unsolicited `startSession` calls (i.e., not originating from the extension)?
- How is agent mode flagged in the session creation request?

### Testing Plan

1. Start Fiddler → configure to decrypt HTTPS on localhost
2. Open Antigravity → start a new agent chat manually
3. Capture the `startSession` and `agent/chat` payloads
4. Replay them with `Invoke-RestMethod` from PowerShell

### Pros/Cons

- ✅ No extension needed — pure script
- ✅ Full control over session parameters
- ✅ Reuses proven `quota_check.ps1` connection pattern
- ❌ Undocumented protocol — could break on Antigravity updates
- ❌ Payload shapes must be reverse-engineered from traffic capture
- ❌ Language server may reject requests not originating from the extension

---

## Path 3: Gemini CLI Companion

### Concept

Use the `gemini-cli` tool (already installed as `google.gemini-cli-vscode-ide-companion-0.20.0`) to spawn agents via command-line.

### Architecture

```
MCP Server (spawn_agent tool)
    → exec('gemini', ['--prompt', 'swarm task...', '--agent-mode'])
    → Gemini CLI processes the request
    → Agent spawns in the IDE
```

### Implementation Steps

1. **Discover CLI Location** — Find the `gemini` binary (likely bundled in the extension)
2. **Test CLI Capabilities** — Run `gemini --help` to see available flags
3. **Test Agent Mode** — Try `gemini --prompt "test" --agent` or equivalent
4. **MCP Integration** — Shell out to the CLI from the tool handler

### Key Questions to Resolve

- Does the Gemini CLI support agent mode?
- Does it create a new chat in the IDE or run headlessly?
- Can it be given a workspace context?

### Testing Plan

1. Find the CLI binary: check the extension's `dist/` or `bin/` directory
2. Run it with `--help`
3. Try sending a simple prompt

### Pros/Cons

- ✅ Officially supported by Google
- ✅ Simplest integration if it works
- ❌ May not support agent mode
- ❌ May run headlessly (no IDE integration)
- ❌ Limited control over session parameters

---

## Recommendation: Pursue Path 2 First, Validate with Path 1

**Path 2 (Direct JSON-RPC)** is the highest-reward option because:
- We already have the connection pattern working (`quota_check.ps1`)
- It gives us full programmatic control (session creation, prompt injection, mode selection)
- No additional extensions to install or maintain

**But we need to validate one critical unknown:** the exact payload shapes. The fastest way to do this is:

1. **Step 1:** Use Fiddler or the VS Code Developer Tools Network tab to capture a real `startSession` + `agent/chat` exchange
2. **Step 2:** If the payloads are simple JSON, we're golden — build `agent_spawn.ps1`
3. **Step 3:** If the language server rejects external requests, fall back to **Path 1** (command bridge)

**Path 3** is the fallback of fallbacks — only if Google has shipped agent-mode CLI support.

### Execution Order

| Step | Action | Time |
|------|--------|------|
| 1 | Capture real RPC traffic via Dev Tools | ~15 min |
| 2 | Replay `startSession` + `agent/chat` from PowerShell | ~15 min |
| 3 | If works → build `agent_spawn.ps1` + MCP tool | ~30 min |
| 4 | If fails → build VS Code bridge extension (Path 1) | ~45 min |
| 5 | Integration test with `/swarm` workflow | ~15 min |
