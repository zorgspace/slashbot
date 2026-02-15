---
name: ink-cli-plugin-architecture
description: Design and implement Ink-based terminal UIs with a modular architecture for plugins and external tool integrations. Use when building or refactoring Node.js/TypeScript CLIs that need robust input handling, composable commands, extensibility points, and maintainable plugin/tool boundaries.
---

# Ink CLI Plugin Architecture

## Overview

Build production-oriented Ink CLIs with a stable extension model.
Favor a small core shell, explicit plugin contracts, and isolated tool adapters.

## Workflow

1. Confirm runtime and framework baseline.
2. Model CLI capabilities as commands, views, and tool adapters.
3. Implement a minimal kernel that owns plugin registration and command dispatch.
4. Keep Ink components focused on rendering and interaction state.
5. Delegate side effects and external binaries to tool adapters.
6. Validate behavior with deterministic tests and non-interactive snapshots.

## Runtime Baseline

- Use Node.js `>=20`.
- Use React `>=19` with Ink `^5`.
- Use ESM (`"type": "module"`) unless the host project requires CJS.

## Read Only What You Need

- Read `references/ink-capabilities.md` when deciding which Ink APIs to use.
- Read `references/plugin-tool-architecture.md` when designing extension points and plugin lifecycle.
- Read `references/ecosystem-components.md` when selecting third-party Ink components/hooks.

## Build or Refactor an Ink CLI

1. Run `scripts/scaffold-app.sh <target-project-root>` to copy `assets/plugin-ready-template/`.
2. Keep the core kernel in `src/core` and treat it as the only module allowed to mutate registries.
3. Put UI-only code in `src/app.tsx` and call core services through typed interfaces.
4. Register plugins through `loadPlugins()` and avoid ad-hoc imports inside UI components.
5. Implement each external integration as a `ToolAdapter` under `src/tools`.
6. Route command handlers through adapter interfaces, never through raw shell calls in components.

## Add a New Plugin

1. Run `scripts/scaffold-plugin.sh <target-project-root> <plugin-id>`.
2. Review generated plugin metadata, command id, and description.
3. Register the plugin in `src/plugins/index.ts`.
4. Add tests for plugin command behavior and adapter error paths.

## Quality Gates

- Keep command ids unique and stable.
- Return structured errors from tools (`code`, `stdout`, `stderr`, `hint`).
- Allow UI render even if a plugin fails to register; isolate plugin failures.
- Support non-TTY flows for CI and scripted runs.
