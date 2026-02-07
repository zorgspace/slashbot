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
- **Plugin marketplace** — Browsable directory of community plugins
- **Hot reload** — Reload plugins without restarting the app

### Token Economy

- **Credit system refinement** — Smooth deposit-to-credit conversion flow
- **Usage dashboard** — Detailed per-session and per-model cost breakdown
- **Spending limits** — Configurable daily/weekly caps on token spend
- **Multi-token support** — Accept other SPL tokens or stablecoins

### Quality

- **Integration tests** — End-to-end tests for the agentic loop
- **CI/CD pipeline** — Automated builds, tests, and releases
- **Error reporting** — Opt-in crash/error telemetry

---

## Mid-Term

### Platform Expansion

- **Web interface** — Browser-based frontend for Slashbot
- **Slack connector** — Plugin for Slack workspace integration
- **GitHub connector** — PR reviews, issue triage, CI monitoring
- **API mode** — Run Slashbot as a headless API server

### AI Capabilities

- **Multi-model support** — Switch between Grok models, add support for other providers
- **Context management v2** — Smarter compression, retrieval-augmented context
- **Agent chains** — Multi-step autonomous workflows with checkpoints
- **Voice mode** — Real-time voice interaction via transcription plugin

### Wallet & Payments

- **On-chain analytics** — Token holder stats, usage metrics, burn tracking
- **Staking** — Stake $SLASHBOT for reduced pricing tiers
- **Referral system** — Earn tokens by referring users
- **Fiat on-ramp** — Buy $SLASHBOT directly with card/bank transfer

---

## Long-Term Vision

### Ecosystem

- **Plugin SDK** — Published npm package with types, testing utilities, and CLI scaffolding
- **Community marketplace** — Public plugin registry with ratings and reviews
- **Plugin revenue sharing** — Plugin authors earn $SLASHBOT when their plugins are used

### Enterprise

- **Team mode** — Shared context, audit logs, centralized billing
- **Self-hosted proxy** — Run your own billing proxy for org-level API key management
- **Compliance** — SOC2-ready logging, data residency controls

### Protocol

- **Decentralized proxy network** — Multiple proxy operators, user picks closest/cheapest
- **On-chain governance** — Token holders vote on pricing, features, treasury allocation
- **Open billing protocol** — Standard for AI tool payments with any SPL token

---

## How to Contribute

1. Check the [issues](https://github.com/zorgspace/slashbot/issues) for tasks tagged `good first issue`
2. Read the [Plugin Guide](./PLUGIN_GUIDE.md) to build a plugin
3. Join the community and share feedback

---

_Last updated: February 2026_
