import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { JsonValue, SlashbotPlugin, StructuredLogger } from '../../plugin-sdk/index.js';
import type { SlashbotKernel } from '@slashbot/core/kernel/kernel.js';
import type { EventBus } from '@slashbot/core/kernel/event-bus.js';
import type { ProviderRegistry } from '@slashbot/core/kernel/registries.js';
import type { LlmAdapter, TokenModeProxyAuthService } from '@slashbot/core/agentic/llm/index.js';
import { KernelLlmAdapter } from '@slashbot/core/agentic/llm/index.js';
import type { AuthProfileRouter } from '@slashbot/core/providers/auth-router.js';
import type { AgentRegistry } from '../agents/index.js';
import { asObject, asString } from '../utils.js';

// ---------------------------------------------------------------------------
// Event declarations
// ---------------------------------------------------------------------------

declare module '@slashbot/core/kernel/event-bus.js' {
  interface EventMap {
    'orchestrate:routed': { taskId: string; strategy: string; selectedAgents: string[] };
    'orchestrate:spawned': { runId: string; strategy: string; label: string; background: boolean };
    'orchestrate:completed': { runId: string; strategy: string; agentCount: number; durationMs: number; status: RunStatus };
    'orchestrate:killed': { runId: string; label: string };
  }
}

// ---------------------------------------------------------------------------
// Run Registry
// ---------------------------------------------------------------------------

type RunStatus = 'pending' | 'running' | 'completed' | 'error' | 'killed';

export interface RunRecord {
  runId: string;
  label: string;
  task: string;
  strategy: string;
  agents: string[];
  status: RunStatus;
  background: boolean;
  depth: number;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  outcome?: {
    ok: boolean;
    text?: string;
    error?: string;
    agentResults?: Array<{ agentId: string; text: string; steps: number; toolCalls: number; finishReason: string; durationMs: number }>;
  };
  abort?: AbortController;
}

const MAX_CONCURRENT_DEFAULT = 8;
const MAX_DEPTH_DEFAULT = 2;
const ARCHIVE_AFTER_MS = 60 * 60 * 1000; // 1 hour

export class RunRegistry {
  private runs = new Map<string, RunRecord>();
  maxConcurrent = MAX_CONCURRENT_DEFAULT;
  maxDepth = MAX_DEPTH_DEFAULT;

  create(record: RunRecord): void {
    this.runs.set(record.runId, record);
  }

  get(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  /** Find a run by runId prefix, label, or numeric 1-based index of active runs. */
  resolve(target: string): RunRecord | undefined {
    // Exact runId
    const exact = this.runs.get(target);
    if (exact) return exact;

    // Numeric index (1-based) into active runs
    const idx = parseInt(target, 10);
    if (!isNaN(idx) && idx >= 1) {
      const active = this.active();
      if (idx <= active.length) return active[idx - 1];
    }

    // "last" keyword
    if (target === 'last') {
      const active = this.active();
      return active.length > 0 ? active[active.length - 1] : undefined;
    }

    // Label match
    const all = Array.from(this.runs.values());
    for (const r of all) {
      if (r.label === target) return r;
    }

    // RunId prefix match
    for (const r of all) {
      if (r.runId.startsWith(target)) return r;
    }

    // Label prefix match
    for (const r of all) {
      if (r.label.startsWith(target)) return r;
    }

    return undefined;
  }

  active(): RunRecord[] {
    return Array.from(this.runs.values()).filter((r) => r.status === 'pending' || r.status === 'running');
  }

  recent(limit = 20): RunRecord[] {
    return Array.from(this.runs.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  activeCount(): number {
    return this.active().length;
  }

  /** Sweep completed runs older than the archive threshold. */
  sweep(): number {
    const cutoff = Date.now() - ARCHIVE_AFTER_MS;
    let swept = 0;
    for (const [id, r] of Array.from(this.runs.entries())) {
      if ((r.status === 'completed' || r.status === 'error' || r.status === 'killed') && r.createdAt < cutoff) {
        this.runs.delete(id);
        swept++;
      }
    }
    return swept;
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const PLUGIN_ID = 'slashbot.orchestrator';

export function createOrchestratorPlugin(): SlashbotPlugin {
  let llm: LlmAdapter | null = null;
  const runRegistry = new RunRegistry();

  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Subagent Orchestrator',
      version: '0.2.0',
      main: 'bundled',
      description: 'Intelligent task delegation with auto-routing, fan-out, pipeline strategies, run tracking, and background execution',
      dependencies: ['slashbot.agents', 'slashbot.providers.auth'],
    },
    setup: (context) => {
      const kernel = context.getService<SlashbotKernel>('kernel.instance');
      const authRouter = context.getService<AuthProfileRouter>('kernel.authRouter');
      const providers = context.getService<ProviderRegistry>('kernel.providers.registry');
      const logger = context.getService<StructuredLogger>('kernel.logger') ?? context.logger;
      const events = kernel?.events as EventBus | undefined;
      const registry = context.getService<AgentRegistry>('agents.registry');

      if (authRouter && providers && kernel) {
        llm = new KernelLlmAdapter(
          authRouter,
          providers,
          logger,
          kernel,
          () => context.getService<TokenModeProxyAuthService>('wallet.proxyAuth'),
        );
      }

      // ── Service ──────────────────────────────────────────────────

      context.registerService({
        id: 'orchestrator.runs',
        pluginId: PLUGIN_ID,
        description: 'Orchestrator run registry — tracks active and completed orchestration runs',
        implementation: runRegistry,
      });

      // ── Helper: invoke a single agent ──────────────────────────────

      async function invokeAgent(
        agentId: string,
        task: string,
        extraContext?: string,
        signal?: AbortSignal,
      ): Promise<{ agentId: string; text: string; steps: number; toolCalls: number; finishReason: string; durationMs: number }> {
        if (!llm || !kernel) throw new Error('LLM adapter not available');
        if (!registry) throw new Error('Agent registry not available');
        signal?.throwIfAborted();

        const agent = registry.get(agentId);
        if (!agent) throw new Error(`Agent "${agentId}" not found`);
        if (!agent.enabled) throw new Error(`Agent "${agentId}" is disabled`);

        const requestId = randomUUID().slice(0, 8);
        const systemPrompt = await kernel.assemblePrompt();

        const parts: string[] = [systemPrompt];
        if (agent.systemPrompt) {
          parts.push(`\n\n## Agent Instructions (${agent.name})\n${agent.systemPrompt}`);
        }

        const userParts: string[] = [task];
        if (extraContext) {
          userParts.push(`\n\n## Additional Context\n${extraContext}`);
        }

        const startMs = Date.now();
        const result = await llm.complete({
          sessionId: `orchestrator-${agentId}-${requestId}`,
          agentId,
          pinnedProviderId: agent.provider,
          pinnedModelId: agent.model,
          toolAllowlist: agent.toolAllowlist,
          abortSignal: signal,
          messages: [
            { role: 'system', content: parts.join('') },
            { role: 'user', content: userParts.join('') },
          ],
        });

        return {
          agentId,
          text: result.text,
          steps: result.steps,
          toolCalls: result.toolCalls,
          finishReason: result.finishReason,
          durationMs: Date.now() - startMs,
        };
      }

      // ── Helper: generic spawn fallback ─────────────────────────────

      async function spawnFallback(
        task: string,
        extraContext?: string,
        signal?: AbortSignal,
      ): Promise<{ agentId: string; text: string; steps: number; toolCalls: number; finishReason: string; durationMs: number }> {
        if (!llm || !kernel) throw new Error('LLM adapter not available');
        signal?.throwIfAborted();

        const requestId = randomUUID().slice(0, 8);
        const systemPrompt = await kernel.assemblePrompt();

        const userParts: string[] = [task];
        if (extraContext) {
          userParts.push(`\n\n## Additional Context\n${extraContext}`);
        }

        const startMs = Date.now();
        const result = await llm.complete({
          sessionId: `orchestrator-spawn-${requestId}`,
          agentId: 'orchestrator-spawn',
          abortSignal: signal,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userParts.join('') },
          ],
        });

        return {
          agentId: '_spawn',
          text: result.text,
          steps: result.steps,
          toolCalls: result.toolCalls,
          finishReason: result.finishReason,
          durationMs: Date.now() - startMs,
        };
      }

      // ── Helper: LLM-based routing ─────────────────────────────────

      async function routeTask(task: string, signal?: AbortSignal): Promise<string | null> {
        if (!llm || !registry) return null;

        const agents = registry.list().filter((a) => a.enabled);
        if (agents.length === 0) return null;

        const roster = agents
          .map((a) => `- ${a.id}: ${a.name} — ${a.role || 'No role defined'}`)
          .join('\n');

        const routingPrompt = [
          'You are a task router. Given the agents below and a task, reply with ONLY the agent ID that best matches, or "none" if no agent fits.',
          '',
          'Agents:',
          roster,
          '',
          `Task: ${task}`,
          '',
          'Agent ID:',
        ].join('\n');

        try {
          const result = await llm.complete({
            sessionId: `orchestrator-router-${randomUUID().slice(0, 8)}`,
            agentId: 'orchestrator-router',
            noTools: true,
            maxTokens: 50,
            abortSignal: signal,
            messages: [
              { role: 'user', content: routingPrompt },
            ],
          });

          const picked = result.text.trim().toLowerCase();
          if (picked === 'none' || !picked) return null;

          const match = agents.find((a) => a.id === picked);
          return match ? match.id : null;
        } catch (err) {
          if (signal?.aborted) throw err;
          logger.warn('Orchestrator routing failed, falling back to spawn', { error: String(err) });
          return null;
        }
      }

      // ── Core: execute orchestration ────────────────────────────────

      type AgentResult = { agentId: string; text: string; steps: number; toolCalls: number; finishReason: string; durationMs: number };

      async function executeOrchestration(
        run: RunRecord,
        task: string,
        strategy: string,
        agentIds: string[],
        extraContext: string | undefined,
        signal?: AbortSignal,
      ): Promise<{ ok: boolean; output?: JsonValue; error?: { code: string; message: string } }> {
        run.status = 'running';
        run.startedAt = Date.now();

        // ── auto strategy ──────────────────────────────────────
        if (strategy === 'auto') {
          let targetId: string | null = null;

          if (agentIds.length === 1) {
            targetId = agentIds[0];
          } else if (agentIds.length === 0) {
            targetId = await routeTask(task, signal);
          } else {
            targetId = agentIds[0];
            if (registry) {
              const subset = agentIds.filter((id) => registry.get(id)?.enabled);
              if (subset.length > 0) targetId = subset[0];
            }
          }

          run.agents = targetId ? [targetId] : ['_spawn'];
          events?.publish('orchestrate:routed', { taskId: run.runId, strategy, selectedAgents: run.agents });

          const result = targetId
            ? await invokeAgent(targetId, task, extraContext, signal)
            : await spawnFallback(task, extraContext, signal);

          run.outcome = {
            ok: true,
            text: result.text,
            agentResults: [result],
          };

          return {
            ok: true,
            output: {
              runId: run.runId,
              strategy,
              routed: result.agentId,
              text: result.text,
              steps: result.steps,
              toolCalls: result.toolCalls,
              finishReason: result.finishReason,
              durationMs: result.durationMs,
            } as unknown as JsonValue,
          };
        }

        // ── fan-out strategy ───────────────────────────────────
        if (strategy === 'fan-out') {
          const targets = agentIds.length > 0
            ? agentIds
            : (registry?.list().filter((a) => a.enabled).map((a) => a.id) ?? []);

          if (targets.length < 2) {
            return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'fan-out strategy requires at least 2 agents (provide agent IDs or register more agents)' } };
          }

          run.agents = targets;
          events?.publish('orchestrate:routed', { taskId: run.runId, strategy, selectedAgents: targets });

          const results = await Promise.all(
            targets.map((id) => invokeAgent(id, task, extraContext, signal).catch((err): AgentResult => ({
              agentId: id,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
              steps: 0,
              toolCalls: 0,
              finishReason: 'error',
              durationMs: 0,
            }))),
          );

          run.outcome = { ok: true, agentResults: results };

          return {
            ok: true,
            output: {
              runId: run.runId,
              strategy,
              results: results.map((r) => ({
                agentId: r.agentId,
                text: r.text,
                steps: r.steps,
                toolCalls: r.toolCalls,
                finishReason: r.finishReason,
                durationMs: r.durationMs,
              })),
              durationMs: Date.now() - run.startedAt,
            } as unknown as JsonValue,
          };
        }

        // ── pipeline strategy ──────────────────────────────────
        if (strategy === 'pipeline') {
          const targets = agentIds.length > 0
            ? agentIds
            : (registry?.list().filter((a) => a.enabled).map((a) => a.id) ?? []);

          if (targets.length < 2) {
            return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'pipeline strategy requires at least 2 agents (provide agent IDs or register more agents)' } };
          }

          run.agents = targets;
          events?.publish('orchestrate:routed', { taskId: run.runId, strategy, selectedAgents: targets });

          const chain: AgentResult[] = [];
          let previousOutput = '';

          for (const id of targets) {
            signal?.throwIfAborted();
            const pipelineContext = previousOutput
              ? `${extraContext ? extraContext + '\n\n' : ''}## Previous Agent Output\n${previousOutput}`
              : extraContext;

            const result = await invokeAgent(id, task, pipelineContext, signal);
            chain.push(result);
            previousOutput = result.text;
          }

          const finalResult = chain[chain.length - 1];
          run.outcome = { ok: true, text: finalResult.text, agentResults: chain };

          return {
            ok: true,
            output: {
              runId: run.runId,
              strategy,
              finalAgent: finalResult.agentId,
              text: finalResult.text,
              steps: finalResult.steps,
              toolCalls: finalResult.toolCalls,
              finishReason: finalResult.finishReason,
              chain: chain.map((r) => ({
                agentId: r.agentId,
                text: r.text,
                steps: r.steps,
                toolCalls: r.toolCalls,
                durationMs: r.durationMs,
              })),
              durationMs: Date.now() - run.startedAt,
            } as unknown as JsonValue,
          };
        }

        return { ok: false, error: { code: 'UNKNOWN_STRATEGY', message: `Unknown strategy: ${strategy}` } };
      }

      // ── Tool: orchestrate ──────────────────────────────────────────

      context.registerTool({
        id: 'orchestrate',
        title: 'Orchestrate',
        pluginId: PLUGIN_ID,
        description:
          'Intelligent task delegation with run tracking. Auto-routes to the best agent, or use fan-out/pipeline strategies. ' +
          'Set background=true to return immediately. Use orchestrate.list / orchestrate.kill to manage runs. ' +
          'Args: { task, strategy?, agents?, context?, background?, label? }',
        parameters: z.object({
          task: z.string().min(1).describe('Task description to delegate'),
          strategy: z.enum(['auto', 'fan-out', 'pipeline']).optional().default('auto').describe('Delegation strategy (default: auto)'),
          agents: z.array(z.string()).optional().describe('Explicit agent IDs to target'),
          context: z.string().optional().describe('Extra context injected into the subagent prompt'),
          background: z.boolean().optional().describe('When true, returns immediately with runId. Result available via orchestrate.list.'),
          label: z.string().optional().describe('Human-readable label for this run'),
        }),
        execute: async (rawArgs) => {
          try {
            if (!llm || !kernel) {
              return { ok: false, error: { code: 'NO_LLM', message: 'LLM adapter not available' } };
            }

            const args = asObject(rawArgs as JsonValue);
            const task = asString(args.task, 'task');
            const strategy = (typeof args.strategy === 'string' ? args.strategy : 'auto') as 'auto' | 'fan-out' | 'pipeline';
            const agentIds = Array.isArray(args.agents) ? (args.agents as string[]) : [];
            const extraContext = typeof args.context === 'string' ? args.context : undefined;
            const background = args.background === true;
            const label = typeof args.label === 'string' && args.label.length > 0 ? args.label : `${strategy}-${Date.now().toString(36)}`;

            // Concurrency check
            if (runRegistry.activeCount() >= runRegistry.maxConcurrent) {
              return { ok: false, error: { code: 'CONCURRENCY_LIMIT', message: `Max concurrent runs reached (${runRegistry.maxConcurrent}). Use orchestrate.list to check active runs or orchestrate.kill to stop one.` } };
            }

            // Create run record
            const abortController = new AbortController();
            const run: RunRecord = {
              runId: randomUUID().slice(0, 8),
              label,
              task,
              strategy,
              agents: agentIds,
              status: 'pending',
              background,
              depth: 0,
              createdAt: Date.now(),
              abort: abortController,
            };

            runRegistry.create(run);
            events?.publish('orchestrate:spawned', { runId: run.runId, strategy, label, background });

            // Sweep old runs opportunistically
            runRegistry.sweep();

            if (background) {
              // Non-blocking: run in background, return runId immediately
              void (async () => {
                try {
                  const result = await executeOrchestration(run, task, strategy, agentIds, extraContext, abortController.signal);
                  run.status = result.ok ? 'completed' : 'error';
                  if (!result.ok && result.error) {
                    run.outcome = { ok: false, error: result.error.message };
                  }
                } catch (err) {
                  if (abortController.signal.aborted) {
                    run.status = 'killed';
                  } else {
                    run.status = 'error';
                    run.outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
                  }
                } finally {
                  run.endedAt = Date.now();
                  run.durationMs = run.endedAt - (run.startedAt ?? run.createdAt);
                  events?.publish('orchestrate:completed', {
                    runId: run.runId,
                    strategy,
                    agentCount: run.agents.length,
                    durationMs: run.durationMs,
                    status: run.status,
                  });
                }
              })();

              return {
                ok: true,
                output: {
                  status: 'accepted',
                  runId: run.runId,
                  label,
                  strategy,
                  message: 'Running in background. Use orchestrate.list to check progress.',
                } as unknown as JsonValue,
              };
            }

            // Blocking: run and return result
            try {
              const result = await executeOrchestration(run, task, strategy, agentIds, extraContext, abortController.signal);
              run.status = result.ok ? 'completed' : 'error';
              if (!result.ok && result.error) {
                run.outcome = { ok: false, error: result.error.message };
              }
              run.endedAt = Date.now();
              run.durationMs = run.endedAt - (run.startedAt ?? run.createdAt);
              events?.publish('orchestrate:completed', {
                runId: run.runId,
                strategy,
                agentCount: run.agents.length,
                durationMs: run.durationMs,
                status: run.status,
              });
              return result;
            } catch (err) {
              run.status = 'error';
              run.outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
              run.endedAt = Date.now();
              run.durationMs = run.endedAt - (run.startedAt ?? run.createdAt);
              return { ok: false, error: { code: 'ORCHESTRATE_ERROR', message: String(err) } };
            }
          } catch (err) {
            return { ok: false, error: { code: 'ORCHESTRATE_ERROR', message: String(err) } };
          }
        },
      });

      // ── Tool: orchestrate.list ─────────────────────────────────────

      context.registerTool({
        id: 'orchestrate.list',
        title: 'List Orchestration Runs',
        pluginId: PLUGIN_ID,
        description: 'List active and recent orchestration runs with status, label, strategy, and outcome. Args: { active? }',
        parameters: z.object({
          active: z.boolean().optional().describe('When true, only show active (pending/running) runs'),
        }),
        execute: async (rawArgs) => {
          const args = asObject(rawArgs as JsonValue);
          const activeOnly = args.active === true;

          const runs = activeOnly ? runRegistry.active() : runRegistry.recent();

          if (runs.length === 0) {
            return { ok: true, output: activeOnly ? 'No active orchestration runs.' : 'No recent orchestration runs.' };
          }

          const entries = runs.map((r, i) => {
            const runtime = r.durationMs != null
              ? `${(r.durationMs / 1000).toFixed(1)}s`
              : r.startedAt
                ? `${((Date.now() - r.startedAt) / 1000).toFixed(1)}s (running)`
                : 'pending';

            return {
              index: i + 1,
              runId: r.runId,
              label: r.label,
              status: r.status,
              strategy: r.strategy,
              agents: r.agents,
              background: r.background,
              runtime,
              task: r.task.length > 80 ? r.task.slice(0, 80) + '…' : r.task,
              resultPreview: r.outcome?.text
                ? (r.outcome.text.length > 120 ? r.outcome.text.slice(0, 120) + '…' : r.outcome.text)
                : r.outcome?.error ?? null,
            };
          });

          return { ok: true, output: entries as unknown as JsonValue };
        },
      });

      // ── Tool: orchestrate.kill ─────────────────────────────────────

      context.registerTool({
        id: 'orchestrate.kill',
        title: 'Kill Orchestration Run',
        pluginId: PLUGIN_ID,
        description: 'Abort an active orchestration run. Target by runId, label, numeric index from orchestrate.list, or "all". Args: { target }',
        parameters: z.object({
          target: z.string().min(1).describe('Run identifier: runId, label, numeric index (1-based), or "all"'),
        }),
        execute: async (rawArgs) => {
          const args = asObject(rawArgs as JsonValue);
          const target = asString(args.target, 'target');

          if (target === 'all') {
            const active = runRegistry.active();
            if (active.length === 0) {
              return { ok: true, output: 'No active runs to kill.' };
            }
            let killed = 0;
            for (const run of active) {
              run.abort?.abort();
              run.status = 'killed';
              run.endedAt = Date.now();
              run.durationMs = run.endedAt - (run.startedAt ?? run.createdAt);
              events?.publish('orchestrate:killed', { runId: run.runId, label: run.label });
              killed++;
            }
            return { ok: true, output: `Killed ${killed} run(s).` };
          }

          const run = runRegistry.resolve(target);
          if (!run) {
            return { ok: false, error: { code: 'NOT_FOUND', message: `No run matching "${target}"` } };
          }

          if (run.status !== 'pending' && run.status !== 'running') {
            return { ok: false, error: { code: 'NOT_ACTIVE', message: `Run "${run.runId}" (${run.label}) is already ${run.status}` } };
          }

          run.abort?.abort();
          run.status = 'killed';
          run.endedAt = Date.now();
          run.durationMs = run.endedAt - (run.startedAt ?? run.createdAt);
          events?.publish('orchestrate:killed', { runId: run.runId, label: run.label });

          return { ok: true, output: `Killed run "${run.runId}" (${run.label}).` };
        },
      });

      // ── Context Provider ───────────────────────────────────────────

      context.contributeContextProvider({
        id: 'orchestrator.usage',
        pluginId: PLUGIN_ID,
        priority: 51,
        provide: () => {
          const agents = registry?.list().filter((a) => a.enabled) ?? [];
          if (agents.length === 0) return '';

          const active = runRegistry.active();
          const lines: string[] = [
            '## Orchestrator',
            'Use the `orchestrate` tool to delegate tasks to specialist agents.',
            '- **auto** (default): picks the best agent automatically. Use when unsure which agent fits.',
            '- **fan-out**: runs the task across multiple agents in parallel. Requires ≥2 agents.',
            '- **pipeline**: runs agents sequentially, each receiving the previous output. Requires ≥2 agents, ordered.',
            '',
            'Options:',
            '- `background: true` — returns immediately with a runId. Check progress with `orchestrate.list`.',
            '- `label` — human-readable name for the run.',
            '',
            'Management: `orchestrate.list` to see runs, `orchestrate.kill` to abort.',
          ];

          if (active.length > 0) {
            lines.push('');
            lines.push(`Active runs: ${active.length} / ${runRegistry.maxConcurrent}`);
          }

          return lines.join('\n');
        },
      });
    },
  };
}

export { createOrchestratorPlugin as createPlugin };
