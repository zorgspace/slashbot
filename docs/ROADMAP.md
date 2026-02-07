import useRoadmap

import useRoadmap

# Slashbot Roadmap

## Vision

Slashbot is a lightweight, extensible CLI coding assistant powered by Grok. The goal is to provide a fast, affordable alternative to existing AI coding tools with native crypto payments, multi-platform support, and a plugin ecosystem that lets anyone extend its capabilities.

---

## v2.0.0 — Architecture Overhaul (Current)

**Status: In Progress**

The v2.0.0 release is a complete rewrite of the internal architecture, moving from a monolithic design to a modular plugin system. Everything is a plugin.

### Completed

- Plugin system (registry, loader, dependency resolution, lifecycle hooks)
- 14 built-in plugins across 3 categories (core, feature, connector)
- Dependency injection with InversifyJS
- Event bus with typed core events and extensible plugin events
- PromptAssembler: system prompt built dynamically from plugin contributions
- Plugin-autonomous action parsing (each plugin owns its XML tags)
- Full-screen terminal UI with OpenTUI (header, chat, comm, input, command palette)
- Unified diff-based code editing system
- Wallet plugin with Solana integration, proxy billing, and real-time pricing
- Telegram and Discord connectors as plugins
- Heartbeat system (periodic AI reflection)
- Task scheduling with cron support
- Skills system (installable capabilities from URLs)
- Third-party plugin installation from GitHub URLs
- Cross-platform clipboard support
- Security: dangerous command blocking, permission system, encrypted wallet storage

### Remaining

- [ ] Stabilize and test all plugin interfaces
- [ ] Complete documentation (ARCHITECTURE.md, TOKEN_UTILITY.md, PLUGIN_GUIDE.md)
- [ ] Automated test coverage for core systems
- [ ] Polish the OpenTUI experience (scrollback, search, theming)
- [ ] Release v2.0.0 on npm / as standalone binary

---

## Near-Term (Post v2.0.0)

### Developer Experience

- **PLUGIN_GUIDE.md** — Complete plugin development documentation
- **Plugin template repo** — Scaffold for third-party plugin projects
- **Hot reload** — Reload plugins without restarting the app

### Token Economy

- **Multi-token support** — Accept other SPL tokens or stablecoins
- **Burn liquidity progressively** — Implement progressive liquidity burning mechanism

### Quality

- **Integration tests** — End-to-end tests for the agentic loop
- **CI/CD pipeline** — Automated builds, tests, and releases
- **Error reporting** — Opt-in crash/error telemetry

---

## Mid-Term

### Platform Expansion

- **Slack connector** — Plugin for Slack workspace integration

### AI Capabilities

- **Context management v2** — Smarter compression, retrieval-augmented context
- **Agent chains** — Multi-step autonomous workflows with checkpoints

### Wallet & Payments

- **On-chain analytics** — Token holder stats, usage metrics, burn tracking

---

## Long-Term Vision

### Protocol

- **On-chain governance** — Token holders vote on pricing, features, treasury allocation

---

## How to Contribute

1. Check the [issues](https://github.com/zorgspace/slashbot/issues) for tasks tagged `good first issue`
2. Read the [Plugin Guide](./PLUGIN_GUIDE.md) to build a plugin
3. Join the community and share feedback

---

_Last updated: February 2026_
