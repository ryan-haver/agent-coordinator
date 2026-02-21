---
description: Outputs a clean CLI-style progress dashboard for the current multi-agent swarm manifest.
metadata:
  name: "status"
  scope: global
---

# Swarm Progress Dashboard

Use the `get_swarm_status` MCP tool provided by `agent-coordinator` to read the current state of the swarm. 

Once you receive the parsed JSON status from the tool, format it precisely into a clean dashboard for the user. Do not add conversational fluff.

## Format Example

```
📊 Swarm Status: [Task or Mission Name]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phase: [Current Phase Number] of [Total Phases]

Agents:
  α [Role]       [Status: ✅ Complete / 🔄 Active / ⏳ Pending / 🔴 Blocked] │ [Model]
  β [Role]       [Status] │ [Model]
  ...

Phase Gates:
  [x] Phase 1 (Planning)
  [ ] Phase 2 (Implementation)
  [ ] Phase 3 (Verification)

Issues: [Count] 🔴 CONFLICT, [Count] 🟡 BUG, [Count] 🟠 BLOCKED

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
``` 

If there is no active manifest, politely inform the user that no swarm is currently active.
