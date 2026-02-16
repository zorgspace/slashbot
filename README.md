# Slashbot

Local‑first AI assistant platform with:
- A small, extensible kernel
- Deterministic hooks
- Plugin‑first runtime registration
- Shared CLI/TUI and gateway surfaces

Slashbot runs agents locally and lets them plan and execute using tools like `shell.exec`, `fs.read`, `fs.write`, `fs.patch`, `web.fetch`, and `web.search` in a bounded loop (typically until build/tests pass or a goal is reached).

The main agent is **agent‑first**: it creates a macro plan before acting and executes directly in a single bounded loop.

---

## Features

- **Local‑first**: runs on your machine; you control configuration and providers
- **Plugin‑based runtime**: core kept small, behavior extended via plugins
- **Deterministic hooks**: predictable execution flow and lifecycle points
- **Unified surfaces**: same core for CLI, TUI, and gateway/server
- **Tool‑driven execution**: controlled toolset for safe automation
- **Agentic planning**: macro‑planning and bounded loops

---

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Run TUI locally

```bash
npm run dev
```

This starts the interactive TUI so you can chat with Slashbot and run agents locally.

---

## Development

- **Build**: `npm run build`
- **Tests**: `npm test`
- **Watch mode**: `npm run dev`

Slashbot is written in TypeScript and built with a plugin‑first architecture. New connectors, tools, and skills are registered via plugins.

---

## Architecture overview

Slashbot is organized around a small kernel and an extensible plugin system:

- **Kernel**: core agent loop, planning, tool execution, history, and logging
- **Plugins**: register tools, connectors (Discord, Telegram, etc.), skills, and hooks
- **Connectors**: bridge external surfaces (CLI/TUI, HTTP gateway, chat apps)
- **Skills**: higher‑level automations implemented as scripts or workflows

Execution is driven by deterministic hooks and a bounded agent loop:

1. The agent receives a user request and current context
2. It creates a macro plan (high‑level steps)
3. It executes the plan using tools, updating history and state
4. It stops when the goal is reached or a safety bound is hit

---

## Heartbeat module

The heartbeat module periodically:

- Checks that Slashbot is running correctly
- Summarizes recent activity in this workspace
- Sends a short status message to configured connectors (e.g., Telegram)

It uses the shared system prompt so it can:

- Understand how to format summaries
- Decide when to send messages
- Trigger basic actions (like tests or health checks) if configured

Configuration is stored in `HEARTBEAT.md` and related plugin settings.

---

