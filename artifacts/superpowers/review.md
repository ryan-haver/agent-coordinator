# Full Security Review — Agent Coordinator + Fusebase MCP

**Scope:** Entire `agent-coordinator` and `fusebase-mcp` codebases
**Auditor:** Claude (Architect)
**Date:** 2026-02-28

---

## Blockers

**None.**

---

## Majors

### J1 — Hardcoded WebSocket host `text.nimbusweb.me`
**File:** `fusebase-mcp/src/yjs-ws-writer.ts` lines 1103, 1282
**Severity:** Major
**Detail:** The Y.js WebSocket writer hardcodes `text.nimbusweb.me` as the WebSocket host. If Fusebase changes this endpoint or if the user is on a different Nimbusweb instance, the write functionality breaks silently. This also makes the WebSocket connection non-configurable.
**Recommendation:** Extract to a config constant or derive from the API host.

### J2 — `fusebase_accounts.json` emails committed to git
**File:** `agent-coordinator/src/fusebase_accounts.json`
**Severity:** Major (informational)
**Detail:** The file contains all 11 agent email addresses in plaintext and IS tracked in git. While emails alone aren't secrets, they reveal the `coordinationagents@gmail.com` alias pattern. An attacker who sees this could attempt password reset attacks.
**Recommendation:** Consider moving emails to the encrypted credential store instead, or accept the risk since these are single-purpose alias accounts with no personal data.

---

## Minors

### M1 — `$MISSION`, `$SCOPE`, `$AGENT_ID` injected into prompts without sanitization
**File:** `agent-coordinator/src/mcp-server/src/index.ts` lines 907-910
**Severity:** Minor
**Detail:** User-provided `mission`, `scope`, and `agent_id` values are injected into prompt templates via `split+join`. While this avoids regex special char issues, a malicious `mission` string could include prompt injection text. However, since the caller is always a trusted PM agent (not an external user), this is low risk.

### M2 — `execSync` calls in scripts use template literals with profile names
**File:** `fusebase-mcp/scripts/setup-agent-profiles.mjs` line 108, `auth-all.mjs` line 120
**Severity:** Minor
**Detail:** `execSync(\`npx tsx scripts/auth.ts --profile=${info.profile}\`)` injects `info.profile` from JSON config. A maliciously crafted `fusebase_accounts.json` could inject shell commands via the profile name. Mitigated by: (1) the JSON file is under source control, (2) only the user can modify it.
**Recommendation:** Add a profile name validation regex (e.g., `/^[a-z0-9-]+$/`) before use in `execSync`.

### M3 — No rate limiting on Fusebase API calls
**File:** `fusebase-mcp/src/client.ts`, `fusebase-mcp/src/index.ts`
**Severity:** Minor
**Detail:** During batch operations (auth-all, multi-agent swarms), many API calls fire in quick succession. Fusebase could rate-limit or ban the IP. The `auth-all.mjs` has a 2-second delay, but `client.ts` has no throttling.

### M4 — Agent progress files written with default permissions
**File:** `agent-coordinator/src/mcp-server/src/utils/agent-progress.ts` line 39
**Severity:** Minor
**Detail:** `swarm-agent-*.json` files are written with default permissions. These aren't secrets, but on shared systems they could be read by other users. Low risk since these are in the project workspace.

---

## Nits

### N1 — `.env` not in `agent-coordinator/.gitignore`
**File:** `agent-coordinator/.gitignore`
**Detail:** The `.env` pattern isn't in agent-coordinator's gitignore (it IS in fusebase-mcp's). No `.env` file currently exists in agent-coordinator, but if one is created it would be tracked. Add `.env` as a precaution.

### N2 — `spy-comment.mjs` and `brute-comment.mjs` exist in scripts
**File:** `fusebase-mcp/scripts/spy-comment.mjs`, `brute-comment.mjs`
**Detail:** These sound like debug/reverse-engineering scripts. They are in the repo and could contain API exploration code. Not a security risk per se, but should be cleaned up or moved to a `dev-scripts/` directory before publishing.

---

## Security Audit Checklist

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | **Encryption at rest** | ✅ | AES-256-GCM, PBKDF2 100k iterations, machine-scoped key |
| 2 | **No plaintext secrets in git** | ✅ | `*.enc`, `data/`, `.env`, `.browser-data*` all gitignored |
| 3 | **Path traversal protection** | ✅ | Role name validated with `/^[a-z0-9-]+$/i` at line 900 |
| 4 | **No `eval()` with user input** | ✅ | Only `regex.exec()` on manifest strings (safe) |
| 5 | **No command injection** | ⚠️ | `execSync` uses profile names from JSON — low risk (M2) |
| 6 | **HTTPS everywhere** | ✅ | All API calls use `https://`, WebSocket uses `wss://` |
| 7 | **Regex injection protection** | ✅ | `escapeRegex()` used for manifest parsing |
| 8 | **Agent ID sanitization** | ✅ | Hex-encoded for filename safety |
| 9 | **File permissions** | ✅ | `0o600` on `credentials.enc` and `cookie_*.enc` |
| 10 | **Cookie expiry warning** | ✅ | 20h age warning in `loadEncryptedCookie()` |
| 11 | **Password not logged** | ✅ | Only email logged, never password |
| 12 | **Graceful auth fallback** | ✅ | Missing profile → empty `$PROFILE` → Fusebase calls skipped |

---

## Summary

The codebase is **fundamentally sound** from a security perspective. Encryption is solid (AES-256-GCM with machine-scoped key derivation), no plaintext secrets touch disk or git, and input validation is present at the critical path traversal vector (role name loading).

**0 Blockers, 2 Majors (informational), 4 Minors, 2 Nits.**

The two majors are low-risk: J1 is a hardcoded host (operational not security), J2 is email exposure (accepted by design for alias accounts).

## Next Actions
1. **M2 fix (recommended):** Add profile name validation regex before `execSync` calls
2. **N1 fix (quick):** Add `.env` to `agent-coordinator/.gitignore`
3. **J1 consideration:** Consider extracting `text.nimbusweb.me` to config
4. **Live test:** Run credential setup + auth to validate end-to-end
