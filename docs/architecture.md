# Slashbot Architecture

## Layers

1. `core/kernel`
- Registry ownership and lifecycle orchestration.
- Hook dispatching and prompt assembly.
- Failure isolation and diagnostics.

2. `core/gateway`
- HTTP + WS control plane.
- Token auth.
- Extensible plugin RPC and route registration.

3. `core/plugins`
- Manifest validation.
- Discovery precedence: config paths -> workspace -> user-global -> bundled.
- Safe loader that isolates plugin registration failures.

4. `core/providers`
- Provider registry and auth profile router.
- Stickiness + deterministic profile rotation + fallback.

5. `ui`
- Ink TUI and non-interactive CLI path share one kernel.
- Agent-first execution with macro planning in a single bounded execution loop.

6. `core/agentic`
- LLM orchestration through `ai` SDK adapters.
- Tool-planning JSON loop with subprocess + file-edit actions.
- Completion gate: `done` + build pass + test pass.

## Hook domains

- Kernel: `startup/input/render/tabs/sidebar/shutdown`
- Lifecycle: `before_agent_start`, `agent_end`, `before_compaction`, `after_compaction`, `message_received`, `message_sending`, `message_sent`, `before_tool_call`, `after_tool_call`, `tool_result_persist`, `session_start`, `session_end`, `gateway_start`, `gateway_stop`

All hooks are priority ordered (`lower` first), timeout guarded, and isolated.
