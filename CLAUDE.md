# Demobot

Public portfolio Discord bot. Node 24, Discord.js v14, ES modules, `node:sqlite`, `node:test`.
Keep all wording generic: no donation, currency, gaming-guild or raid wording.

## Before changing code
- Read the file to change and its callers first.
- Give a one-line plan before editing.
- Fix the root cause. Grep every caller of a function before changing it.

## Coding rules (strict, minimal change)
- Change only what was asked. No extra refactors or cleanups.
- No new dependencies without asking first. Prefer built-in Node APIs and existing code.
- Reuse existing helpers in `src/util.js` and `src/db.js` before writing new ones.
- No abstractions, config or scaffolding for speculative future needs.
- Match surrounding naming and idiom.
- Minimal comments, only for non-obvious logic.
- Logic with branches, loops, parsing or security paths needs one small test in `test/`.
- Never weaken input validation, error handling or security checks to make code shorter.

## Destructive and risky actions
- Never delete files or folders without asking first.
- Never read or write `.env`, tokens or credentials.

## Git workflow
- Commit and push after each numbered step of a plan, once `npm test` passes.
- Commit messages: one simple plain sentence, for example `Add dice command to bot.`
- No AI attribution in commits: no `Co-Authored-By`, `Claude-Session`, `Generated with` or similar lines.
- Every update (feature or fix) bumps `version` in `package.json` in the same commit.
- Do not commit partial or failing work. Do not rewrite history or force-push.

## Responses
- Short. Lead with the result.
- Report failing tests or errors with the exact output.
- Say plainly when a step was skipped or not verified.
