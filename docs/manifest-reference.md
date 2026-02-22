# Manifest Reference

The `swarm-manifest.md` file lives in the **project root** and is the single source of truth for all agents in a swarm. Every agent reads it before starting and updates it when finishing.

## Lifecycle

```
/swarm or /swarm-auto creates manifest
        ↓
Architect reads → updates status → writes plan → marks Phase 1 done
        ↓
Developer(s) read → claim files → implement → mark Phase 2 done
        ↓
QA reads → runs tests → reports issues → marks Phase 3 done
        ↓
User reviews final manifest state
```

---

## Sections

### `## Mission`

The original user request, copied verbatim from the `/swarm` or `/swarm-auto` command arguments.

```markdown
## Mission
Refactor the billing module to support multi-currency payments
```

---

### `## Quota Check`

Snapshot of Antigravity Cockpit quotas at swarm start. Used for model routing decisions.

```markdown
| Model | Quota (%) |
|-------|-----------|
| Claude (Tier 1) | 72% |
| Gemini Pro (Tier 2) | 95% |
| Gemini Flash (Tier 3) | 100% |
```

---

### `## Notebook`

Tracks the project's NotebookLM notebook for agent research queries.

| Field | Description |
|-------|-------------|
| **Notebook ID** | The NLM notebook ID |
| **Alias** | Short alias for `nlm notebook query <alias>` |
| **Plan Limit** | Source limit (300 for Pro, 50 for free) |
| **Current Sources** | Number of sources added so far |
| **Headroom** | Remaining source capacity |

---

### `## Fusebase`

Tracks the project's Fusebase workspace for dual-write deliverables. Agents check this section on start — if populated, they dual-write to Fusebase; if empty, local-only.

| Field | Description |
|-------|-------------|
| **Workspace URL** | Fusebase workspace URL |
| **Project Folder ID** | Folder containing all deliverable pages |
| **Task Board URL** | Kanban board for tracking progress |

---

### `## Agents`

Roster of all agents in the swarm with their assignments and current status.

| Column | Description |
|--------|-------------|
| **ID** | Greek letter identifier (α, β, γ, δ, ε, ζ) |
| **Role** | Architect, Developer, QA, Explorer, Code Reviewer, or Debugger |
| **Model** | AI model assigned to this agent |
| **Scope** | Directories/files this agent is allowed to edit |
| **Status** | `⏳ Pending`, `🔄 Active`, `✅ Complete`, or `❌ Failed` |
| **Phase** | Which phase this agent belongs to (1, 2, or 3) |

**Example:**
```markdown
| ID | Role | Model | Scope | Status | Phase |
|----|------|-------|-------|--------|-------|
| α  | Architect | Claude (Tier 1) | plan.md, docs/ | ✅ Complete | 1 |
| β  | Developer | Gemini Pro (Tier 2) | src/backend/** | 🔄 Active | 2 |
| γ  | Developer | Gemini Pro (Tier 2) | src/frontend/** | ⏳ Pending | 2 |
| δ  | QA | Gemini Flash (Tier 3) | read-only | ⏳ Pending | 3 |
```

---

### `## File Claims`

File-level locks that prevent edit conflicts between agents. An agent **must** add a claim row before editing any file.

| Column | Description |
|--------|-------------|
| **File** | Path to the file being claimed |
| **Claimed By** | Agent ID and role |
| **Status** | `🔄 Active` (in progress) or `✅ Done` (completed) |

**Example:**
```markdown
| File | Claimed By | Status |
|------|-----------|--------|
| src/api/billing.ts | β (Developer) | 🔄 Active |
| src/api/currency.ts | β (Developer) | ✅ Done |
| src/ui/checkout.tsx | γ (Developer) | 🔄 Active |
```

**Rules:**
- If a file is claimed by another agent → **do not edit it**
- If you need a file that's claimed → add to `## Issues` with severity `🟠 BLOCKED`
- Update claim status to `✅ Done` when you're finished with the file

---

### `## Phase Gates`

Sequential checkboxes that track overall swarm progress. An agent checks their phase's box when they are the last agent in that phase to complete.

```markdown
## Phase Gates
- [x] Phase 1 (Planning) complete — Architect finished, user approved `plan.md`
- [ ] Phase 2 (Implementation) complete — all Developer agents done
- [ ] Phase 3 (Verification) complete — QA agent signed off
```

---

### `## Handoff Notes`

Free-form section where agents leave context for successor agents or for recovery after context limits. Critical for continuity when agents are replaced mid-task.

**Example:**
```markdown
## Handoff Notes

### α (Architect) → Phase 2 agents
- The billing module has a hidden dependency on `src/utils/format.ts` — be careful with currency formatting
- I recommend implementing the Currency class first (β) before the UI components (γ)

### β (Developer) → δ (QA)
- Added 12 unit tests for the Currency class in `tests/currency.test.ts`
- The exchange rate API mock is in `tests/mocks/exchange.ts`
- Known gap: no integration tests yet for the checkout flow
```

---

### `## Issues`

Structured table for problems discovered during execution. Any agent can add entries.

| Column | Description |
|--------|-------------|
| **Severity** | `🔴 CONFLICT`, `🟡 BUG`, `🟠 DESIGN`, `🟠 BLOCKED`, or `🟢 NITPICK` |
| **File/Area** | Which file or area is affected |
| **Description** | What the problem is |
| **Reported By** | Agent ID |

**Example:**
```markdown
| Severity | File/Area | Description | Reported By |
|----------|-----------|-------------|-------------|
| 🟡 BUG | src/api/billing.ts | Missing null check on exchange rate response | δ |
| 🟠 DESIGN | src/ui/checkout.tsx | Currency selector doesn't match the Figma mockup | δ |
| 🟢 NITPICK | src/api/currency.ts | Inconsistent naming: `getRate` vs `fetchExchangeRate` | δ |
```

**Severity guide:**
| Level | Meaning | Action |
|-------|---------|--------|
| `🔴 CONFLICT` | File edited by multiple agents or plan violation | Must resolve before proceeding |
| `🟡 BUG` | Functional bug that breaks behavior | Should fix before shipping |
| `🟠 DESIGN` | Architectural or design deviation from plan | Needs discussion or plan update |
| `🟠 BLOCKED` | Agent can't proceed without another agent's work | Coordination needed |
| `🟢 NITPICK` | Minor style or quality issue | Nice to fix, not blocking |
