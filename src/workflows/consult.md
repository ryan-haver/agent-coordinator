---
description: Lightweight cross-model consultation for stuck agents. Generates a 'consult_request.md' for another model to answer without requiring a full handoff.
metadata:
  name: "consult"
  scope: global
---

# Cross-Model Consultation

You have invoked the `/consult` workflow. As an agent, you should use this when you are stuck (e.g. 3+ attempts failed on the same task) but you don't want to lose your current context in a full handoff.

## Step 0: TRY NLM RESEARCH FIRST

Before consulting another model, try researching the answer yourself — it's cheaper and often sufficient:

1. Query the project notebook: `nlm notebook query <alias> "<your question>"`
2. If insufficient, initiate deep research: `nlm research start <notebook-id> "<topic>"`
3. If research resolves your blocker → **cancel consultation**, continue your task

Only proceed to Step 1 if NLM research didn't help.

## Step 1: CREATE CONSULT REQUEST

Write a file named `consult_request.md` in the project root containing:
1. **The Goal**: What you are trying to do.
2. **The Attempts**: What you've tried so far and why each attempt failed.
3. **The Question**: The specific, focused question you need the consultant model to answer.
4. **Context**: Minimal, relevant code snippets or error logs.

## Step 2: RECOMMEND A CONSULTANT

Read `config://models` via MCP to see the available models and their strengths. 

*   **Logic bugs / Deep reasoning** → Recommend Claude (The Architect)
*   **Large refactors / Broad context** → Recommend Gemini Pro (The Context King)
*   **Formatting / Docs** → Recommend Gemini Flash (The Speed Specialist)

## Step 3: DISPATCH

Prompt the user to dispatch the consult:

```
🟡 Stuck on [Task]. Requesting consultation.

1. I have written `consult_request.md`.
2. Please open a NEW chat window.
3. Select model: [Recommended Model Name]
4. Paste this prompt:

"Please read consult_request.md. Write your answer and advice into consult_response.md. Do not make any code changes yourself."

5. Once the consultant finishes, come back to this chat and tell me to proceed!
```

## Step 4: RESUME

Once the user returns and tells you to proceed, read `consult_response.md`, apply the consultant's advice, and continue your task with your full original context intact.
