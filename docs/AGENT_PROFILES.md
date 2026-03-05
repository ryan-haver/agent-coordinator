# Agent Profiles

> Fusebase identity configuration for multi-agent swarms.
> Each profile maps to a separate Fusebase account so comments, edits, and @mentions are attributable.

## Profile Registry

| # | Role | Profile | Email | Display Name |
|---|------|---------|-------|-------------|
| 1 | project-manager | `agent-pm` | `coordinationagents+pm@gmail.com` | 🎯 Agent PM |
| 2 | architect | `agent-architect` | `coordinationagents+architect@gmail.com` | 🏗️ Agent Architect |
| 3 | developer | `agent-dev` | `coordinationagents+dev@gmail.com` | 💻 Agent Dev |
| 4 | developer-β | `agent-dev-beta` | `coordinationagents+dev-beta@gmail.com` | 💻 Agent Dev β |
| 5 | developer-γ | `agent-dev-gamma` | `coordinationagents+dev-gamma@gmail.com` | 💻 Agent Dev γ |
| 6 | debugger | `agent-debug` | `coordinationagents+debug@gmail.com` | 🐛 Agent Debug |
| 7 | qa | `agent-qa` | `coordinationagents+qa@gmail.com` | 🧪 Agent QA |
| 8 | code-reviewer | `agent-review` | `coordinationagents+review@gmail.com` | 🔍 Agent Review |
| 9 | devops | `agent-devops` | `coordinationagents+devops@gmail.com` | ⚙️ Agent DevOps |
| 10 | explorer | `agent-explorer` | `coordinationagents+explorer@gmail.com` | 🔭 Agent Explorer |
| 11 | researcher | `agent-researcher` | `coordinationagents+researcher@gmail.com` | 📚 Agent Researcher |

## Role Details

### 🎯 Project Manager (`agent-pm`)
- **Prompt:** `project-manager.md`
- **Scope:** `spec.md`, documentation, manifest management
- **Does:** Analyzes requests, writes specs, sets up Fusebase/NLM, selects agents, monitors progress
- **Does NOT:** Write code, run tests, debug, make architecture decisions

### 🏗️ Architect (`agent-architect`)
- **Prompt:** `architect.md`
- **Scope:** `plan.md`, architecture documentation
- **Does:** Designs system architecture, writes implementation plans, makes trade-off decisions
- **Does NOT:** Write implementation code

### 💻 Developer (`agent-dev` / `agent-dev-beta` / `agent-dev-gamma`)
- **Prompt:** `developer.md`
- **Scope:** Assigned source files and tests
- **Does:** Implements planned changes, writes tests, claims/releases files
- **Does NOT:** Edit files outside assigned scope

### 🐛 Debugger (`agent-debug`)
- **Prompt:** `debugger.md`
- **Scope:** Bug-related files
- **Does:** Root cause analysis, writes fixes, adds regression tests
- **Does NOT:** Implement new features

### 🧪 QA (`agent-qa`)
- **Prompt:** `qa.md`
- **Scope:** Test files, verification reports
- **Does:** Runs tests, verifies acceptance criteria, reports bugs
- **Does NOT:** Write production code

### 🔍 Code Reviewer (`agent-review`)
- **Prompt:** `code-reviewer.md`
- **Scope:** Review reports
- **Does:** Assesses code quality, plan alignment, security, reports issues
- **Does NOT:** Write production code

### ⚙️ DevOps (`agent-devops`)
- **Prompt:** `devops.md`
- **Scope:** CI/CD, build configs, deployment scripts
- **Does:** Build pipelines, deployment automation, infrastructure
- **Does NOT:** Implement application logic

### 🔭 Explorer (`agent-explorer`)
- **Prompt:** `explorer.md`
- **Scope:** Read-only codebase access, documentation
- **Does:** Scans codebases, maps dependencies, documents structure
- **Does NOT:** Edit source code

### 📚 Researcher (`agent-researcher`)
- **Prompt:** `researcher.md`
- **Scope:** Research notes, documentation
- **Does:** Web research, API documentation, technology evaluation
- **Does NOT:** Edit source code

## Authentication Setup

Each profile requires a separate Fusebase account. Authenticate using:

```bash
cd fusebase-mcp

# One at a time:
npx tsx scripts/auth.ts --profile=agent-pm

# Or all at once (interactive):
node scripts/setup-agent-profiles.mjs
```

Credentials are stored as encrypted cookies in `fusebase-mcp/data/cookie_<profile>.enc`.

## How It Works

1. PM calls `get_agent_prompt(role: "developer")` to generate an agent's prompt
2. The MCP server reads `fusebase_accounts.json` and looks up `developer` → `agent-dev`
3. `$PROFILE` in the prompt template is replaced with `agent-dev`
4. The agent calls `fusebase_post_comment(..., profile: "agent-dev")` during work
5. Fusebase shows the comment as coming from the `agent-dev` account

If no profile is configured for a role, `$PROFILE` is empty and Fusebase communication is skipped gracefully.

## Config File

Source: `src/fusebase_accounts.json`
Deployed to: `~/.antigravity-configs/fusebase_accounts.json`

See [CUSTOMIZATION.md](./CUSTOMIZATION.md#agent-accounts-phase-2c) for editing instructions.
