# Brainstorm: Reliable Password Masking on Windows Terminal

## Goal
Mask password input in `setup-credentials.mjs` so plaintext is never visible on screen.

## Constraints
- Must work in **Windows Terminal + PowerShell 7**
- Must handle **paste** (Ctrl+V / right-click), not just typing
- Node.js `process.stdin.setRawMode(true)` does **not** suppress echo on Windows Terminal
- Node.js `readline` with muted output still echoes via the terminal emulator
- Must also work on Linux/Mac (cross-platform)

## Known Context
- Windows Terminal echoes paste content at the terminal emulator level, **before** Node.js sees it
- Node.js `setRawMode(true)` only controls the Node stream, not the terminal emulator's paste behavior
- This is a known Node.js limitation on Windows — not a bug in our code
- Tried: raw mode, ANSI clear, readline `_writeToOutput` hook, `readline.clearLine` — all fail

## Risks
- Using external processes (PowerShell) adds startup latency (~500ms per prompt)
- Env var approach skips masking entirely — password visible in shell history
- Third-party npm packages add dependency risk

## Options

### Option A — PowerShell `Read-Host -AsSecureString` (just pushed ✅)
Delegate to PowerShell's native masked input via `execSync`. Guaranteed to work.
- **Pro:** OS-native masking, handles paste correctly, works immediately
- **Con:** ~500ms latency per prompt, Windows-only (needs Linux/Mac fallback)
- **Complexity:** Low — already implemented

### Option B — Environment variable / `.env` file
Skip interactive prompt entirely. User sets `FUSEBASE_PASSWORD` and `PIA_PROXY_USER`/`PIA_PROXY_PASS` as env vars or in a `.env` file, then runs the script.
- **Pro:** Zero masking issues, scriptable, works everywhere
- **Con:** Password in shell history (`$env:FUSEBASE_PASSWORD="..."`) or in `.env` file on disk
- **Complexity:** Very low

### Option C — Read from file
User writes password to a temp file, script reads it, script deletes the file.
- **Pro:** No echo issue, no shell history
- **Con:** Plaintext on disk briefly, awkward UX
- **Complexity:** Low

### Option D — `@anthropic/prompt-secrets` or `read-password` npm package
Use a battle-tested npm package designed for this exact problem.
- **Pro:** Cross-platform, well-tested
- **Con:** New dependency, may have same underlying issue
- **Complexity:** Low

## Recommendation
**Option A** (PowerShell `Read-Host`) — already implemented and pushed. Try it first. It delegates masking to the OS shell, which is the only layer that can truly control terminal echo on Windows. Linux/Mac fallback uses raw mode which works fine there.

## Acceptance Criteria
1. Password never visible in plaintext during entry
2. Paste works correctly (masked)
3. Works in Windows Terminal + PowerShell
4. Credentials encrypt and save successfully
