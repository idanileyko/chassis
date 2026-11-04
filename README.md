# CHASSIS

Agent-operations console. CHASSIS doesn't trust agents — it *instruments* them: profile-driven
expectation sweeps against the rooms agents operate in, a policy spine that only a human can
override, and an audit trail that never forgets.

## Architecture

```
 Room A (readers)        The Wall (policy)        Room B (advisors)      Oracle
┌────────────────┐   ┌──────────────────────┐   ┌──────────────────┐   ┌────────────┐
│ http · sql     │──▶│ severity tiers       │──▶│ scoped,          │──▶│ A–F report │
│ cli · file     │   │ dual-signal gates    │   │ display-only,    │   │ cards per  │
│ metric · canary│   │ kill switch          │   │ maxTools ≤ 8     │   │ expectation│
└────────────────┘   │ dead-man scheduler   │   │ budget caps      │   └────────────┘
                     └──────────┬───────────┘   └──────────────────┘
                                ▼
                        Gate Inbox (human authority) → append-only JSONL audit
```

- **Profile store** — one JSON per project (`profiles/`): expectations, schedules, advisor policy, oracle rubrics.
- **Expectation primitives** — `http`, `sql`, `cli`, `file`, `metric` (memory or real `statfs` disk headroom), plus a **canary** self-test in every sweep (a probe guaranteed to fail; if it passes, the runner is lying → META gate).
- **Dual-signal rule** — CRITICAL gates require ≥2 consecutive failed sweeps before firing; streaks persist to disk.
- **Dead-man's switch** — a profile silent beyond 2× its schedule window raises a gate (suppressed while the kill switch is armed).
- **MCP handshake** — connects to MCP servers, sha256-hashes tool schemas to detect rug pulls.
- **State** — gates, kill switch, fail streaks, last-run times persist in `chassis-state.json` (gitignored); audit is append-only `chassis-audit.jsonl` (gitignored).

## Run

```bash
npm install
npm run build       # tsc -b && vite build
npm start           # node server.mjs  → http://localhost:4173
```

Node 20+, no frameworks on the backend (plain `node:http`), SSE-streamed sweeps.

## Layout

```
server.mjs        backend: static host + JSON API + SSE sweeps + scheduler
profiles/         one JSON per watched project
src/              React console (3 themes: intelligence / tactical / light)
docs/             architecture spec (archify JSON)
```

Machine map: laptop `idani` = dev, desktop `idanileykoBAD` = scheduled sweeps,
Kimi sandbox = build/preview bench. Runtime state never crosses machines via git.
