# Slashbot

CLI assistant powered by Grok API - lightweight Claude Code alternative.

## Stack

- TypeScript

## Structure

```
slashbot/
├── .claude/
├── src/
│   └── ... (CLI logic)
├── package.json
└── README.md
```

## Quick Start

### Prerequisites

- Bun (Node.js alternative)

### Installation

```bash
git clone <repo-url>
cd slashbot
bun install
```

### Development

```bash
bun run dev
```

### Build

```bash
bun run build
```

## Conventions

- Consistent TypeScript usage
- Factorize code
- Minimal token usage in prompts

## Notes

Autonomous CLI code editor with actions for grep, read, edit, create, exec, etc.
