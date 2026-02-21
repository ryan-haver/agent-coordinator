# Agent Prompt Templates

The `templates/agent-prompts/` directory contains ready-to-use prompt templates for each agent role. The `/swarm` and `/swarm-auto` workflows populate these templates and present them as copy-paste-ready prompts for dispatch via Agent Manager.

## Template Variables

Each prompt template uses placeholder variables that get filled in by the coordinator:

| Variable | Description | Filled By |
|----------|-------------|-----------|
| `$MISSION` | The original user task description | Coordinator (from `/swarm` arguments) |
| `$AGENT_ID` | Greek letter identifier (α, β, γ, etc.) | Coordinator (from agent plan) |
| `$SCOPE` | Directories/files this agent may edit | Coordinator (from scope analysis) |

## Prompt Structure

All agent prompts follow a consistent structure:

```
# Swarm Agent Prompt: [Role]

[One-line role summary]

## Your Mission
$MISSION

## Before You Start
1. Read swarm-manifest.md
2. Find your agent row and update status
3. Read any prerequisite documents (plan.md, etc.)
4. Read coordination rules from agent-coordination skill

## Your Scope
- What you MAY edit
- What you MAY NOT edit
- What you MAY read

## Your Task
1-N numbered steps specific to this role

## Rules
- Follow coordination rules
- Role-specific constraints
- Context limit handling (agent-coordination)
```

## Available Prompts

### Core Roles (used in every swarm)

| Prompt | Role | Key Constraint |
|--------|------|---------------|
| `project-manager.md` | Coordination | Scopes, plans, enforces spec — does NOT write code |
| `architect.md` | Planning | May NOT edit source code — only `plan.md` and docs |
| `developer.md` | Implementation | Must stay within `$SCOPE`, must claim files first |
| `qa.md` | Verification | May NOT edit production code — only tests and manifest |

### Optional Roles

| Prompt | Role | When to Use |
|--------|------|-------------|
| `explorer.md` | Codebase discovery | Unfamiliar codebases, pre-architecture research |
| `code-reviewer.md` | Diff review | Code quality and security review post-implementation |
| `debugger.md` | Root cause analysis | Targeted bug investigation and fixes |
| `devops.md` | Build/CI verification | Build checks, linting, CI/CD pipeline issues |
| `researcher.md` | Research & knowledge | Web/drive research, source curation, NLM queries |

## Customizing Prompts

You can customize the prompt templates for your project:

1. **Adjust model recommendations** — The coordinator suggests models, but you can override when dispatching via Agent Manager
2. **Add project-specific context** — Add a section to the prompt with project conventions, tech stack details, or coding standards
3. **Modify scope definitions** — The `$SCOPE` variable is filled by the coordinator, but you can manually adjust before dispatching
4. **Create new roles** — Copy an existing prompt and modify it. Follow the standard structure above so it integrates with the manifest

## How Prompts Are Used

### In `/swarm` (supervised mode)

Prompts are generated one phase at a time:
1. Coordinator generates the Architect prompt → you dispatch → wait for completion
2. Coordinator generates Developer prompts → you dispatch in parallel → wait
3. Coordinator generates QA prompt → you dispatch → wait
4. Coordinator reads final manifest and generates a report

### In `/swarm-auto` (rapid mode)

All prompts are generated upfront in one output:
1. Coordinator generates ALL prompts at once
2. You dispatch them in phase order (Architect → Developers → QA)
3. When all agents are done, return for the final report

### Dispatch Process

For each agent prompt:
1. Open Agent Manager (`Ctrl+E`)
2. Create a new task
3. Paste the populated prompt
4. Select the recommended model from the dropdown
5. Start the task
