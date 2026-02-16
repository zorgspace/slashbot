import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { JsonValue, PathResolver, SlashbotPlugin, StructuredLogger } from '@slashbot/plugin-sdk';
import type { SlashbotKernel } from '../../core/kernel/kernel.js';
import type { EventBus } from '../../core/kernel/event-bus.js';
import type { ProviderRegistry } from '../../core/kernel/registries.js';
import type { LlmAdapter, TokenModeProxyAuthService } from '../../core/agentic/llm/index.js';
import { KernelLlmAdapter } from '../../core/agentic/llm/index.js';
import type { AuthProfileRouter } from '../../core/providers/auth-router.js';
import { asObject, asString } from '../utils.js';

declare module '../../core/kernel/event-bus.js' {
  interface EventMap {
    'agents:registered': { agentId: string; name: string; action: string };
    'agents:removed': { agentId: string; name: string };
    'agents:invoked': { agentId: string; name: string; promptLength: number };
    'agents:completed': { agentId: string; name: string; steps: number; toolCalls: number; durationMs: number; finishReason: string };
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const AgentSpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1),
  role: z.string().default(''),
  systemPrompt: z.string().default(''),
  provider: z.string().optional(),
  model: z.string().optional(),
  enabled: z.boolean().default(true),
  toolAllowlist: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

interface AgentSpec {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  provider?: string;
  model?: string;
  enabled: boolean;
  toolAllowlist?: string[];
  createdAt: string;
  updatedAt: string;
}

const TeamSpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1),
  leaderAgentId: z.string(),
  memberAgentIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

interface TeamSpec {
  id: string;
  name: string;
  leaderAgentId: string;
  memberAgentIds: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// AgentRegistry
// ---------------------------------------------------------------------------

export class AgentRegistry {
  private agents = new Map<string, AgentSpec>();
  private teams = new Map<string, TeamSpec>();
  private readonly agentsPath: string;
  private readonly teamsPath: string;

  constructor(private readonly homeDir: string) {
    this.agentsPath = join(homeDir, 'agents.json');
    this.teamsPath = join(homeDir, 'teams.json');
  }

  // ── Persistence ──────────────────────────────────────────────────

  async load(): Promise<void> {
    await this.loadAgents();
    await this.loadTeams();
  }

  private async loadAgents(): Promise<void> {
    try {
      const data = await fs.readFile(this.agentsPath, 'utf8');
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return;
      for (const raw of parsed) {
        const result = AgentSpecSchema.safeParse(raw);
        if (result.success) {
          this.agents.set(result.data.id, result.data as AgentSpec);
        }
      }
    } catch { /* no file or invalid JSON — start empty */ }
  }

  private async loadTeams(): Promise<void> {
    try {
      const data = await fs.readFile(this.teamsPath, 'utf8');
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return;
      for (const raw of parsed) {
        const result = TeamSpecSchema.safeParse(raw);
        if (result.success) {
          this.teams.set(result.data.id, result.data as TeamSpec);
        }
      }
    } catch { /* no file or invalid JSON — start empty */ }
  }

  private async saveAgents(): Promise<void> {
    await fs.mkdir(this.homeDir, { recursive: true });
    const data = JSON.stringify([...this.agents.values()], null, 2);
    await fs.writeFile(this.agentsPath, `${data}\n`, 'utf8');
  }

  private async saveTeams(): Promise<void> {
    await fs.mkdir(this.homeDir, { recursive: true });
    const data = JSON.stringify([...this.teams.values()], null, 2);
    await fs.writeFile(this.teamsPath, `${data}\n`, 'utf8');
  }

  // ── Agent CRUD ───────────────────────────────────────────────────

  list(): AgentSpec[] {
    return [...this.agents.values()];
  }

  get(id: string): AgentSpec | undefined {
    return this.agents.get(id);
  }

  async register(spec: AgentSpec): Promise<AgentSpec> {
    this.agents.set(spec.id, spec);
    await this.saveAgents();
    return spec;
  }

  async remove(id: string): Promise<boolean> {
    const existed = this.agents.delete(id);
    if (existed) await this.saveAgents();
    return existed;
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const agent = this.agents.get(id);
    if (!agent) return false;
    agent.enabled = enabled;
    agent.updatedAt = new Date().toISOString();
    await this.saveAgents();
    return true;
  }

  // ── Team CRUD ────────────────────────────────────────────────────

  listTeams(): TeamSpec[] {
    return [...this.teams.values()];
  }

  getTeam(id: string): TeamSpec | undefined {
    return this.teams.get(id);
  }

  async registerTeam(spec: TeamSpec): Promise<TeamSpec> {
    this.teams.set(spec.id, spec);
    await this.saveTeams();
    return spec;
  }

  async removeTeam(id: string): Promise<boolean> {
    const existed = this.teams.delete(id);
    if (existed) await this.saveTeams();
    return existed;
  }

  // ── Routing ──────────────────────────────────────────────────────

  resolveAgent(prefix: string): { agentId?: string; strippedMessage: string } {
    const match = prefix.match(/^@([a-z0-9_-]+)\s+([\s\S]+)$/i);
    if (!match) return { strippedMessage: prefix };

    const id = match[1].toLowerCase();
    const strippedMessage = match[2].trim();

    // Direct agent match
    if (this.agents.has(id)) {
      return { agentId: id, strippedMessage };
    }

    // Team match → route to leader
    const team = this.teams.get(id);
    if (team) {
      return { agentId: team.leaderAgentId, strippedMessage };
    }

    return { strippedMessage: prefix };
  }

  // ── Prompt formatting ────────────────────────────────────────────

  formatRoster(): string {
    const lines: string[] = [];
    const agents = this.list();
    const teams = this.listTeams();

    if (agents.length > 0) {
      lines.push('## Available Agents');
      lines.push('Use `agents.invoke` to delegate tasks to specialist agents.');
      for (const a of agents) {
        const model = a.provider
          ? `[${a.provider}${a.model ? `/${a.model}` : ''}]`
          : '[default provider]';
        const status = a.enabled ? '' : ' (disabled)';
        lines.push(`- **${a.id}** (${a.name}): ${a.role || 'No role defined'}${status} ${model}`);
      }
    }

    if (teams.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('## Teams');
      for (const t of teams) {
        lines.push(`- **${t.id}** (${t.name}): Leader: ${t.leaderAgentId}, Members: ${t.memberAgentIds.join(', ')}`);
      }
    }

    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const PLUGIN_ID = 'slashbot.agents';

export function createAgentsPlugin(): SlashbotPlugin {
  let registry: AgentRegistry;
  let llm: LlmAdapter | null = null;

  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Agent Registry',
      version: '0.1.0',
      main: 'bundled',
      description: 'Multi-agent management — CRUD, invoke, teams, and @agent routing',
      dependencies: ['slashbot.providers.auth'],
    },
    setup: (context) => {
      const kernel = context.getService<SlashbotKernel>('kernel.instance');
      const authRouter = context.getService<AuthProfileRouter>('kernel.authRouter');
      const providers = context.getService<ProviderRegistry>('kernel.providers.registry');
      const logger = context.getService<StructuredLogger>('kernel.logger') ?? context.logger;
      const paths = context.getService<PathResolver>('kernel.paths')!;
      const events = kernel?.events as EventBus | undefined;

      registry = new AgentRegistry(paths.home());

      if (authRouter && providers && kernel) {
        llm = new KernelLlmAdapter(
          authRouter,
          providers,
          logger,
          kernel,
          () => context.getService<TokenModeProxyAuthService>('wallet.proxyAuth'),
        );
      }

      // ── Service ────────────────────────────────────────────────────

      context.registerService({
        id: 'agents.registry',
        pluginId: PLUGIN_ID,
        description: 'Agent registry for multi-agent management',
        implementation: registry,
      });

      // ── Tools ──────────────────────────────────────────────────────

      context.registerTool({
        id: 'agents.list',
        title: 'List Agents',
        pluginId: PLUGIN_ID,
        description: 'List all registered agents and teams. Args: {}',
        parameters: z.object({}),
        execute: async () => {
          const agents = registry.list();
          const teams = registry.listTeams();
          return {
            ok: true,
            output: { agents, teams } as unknown as JsonValue,
          };
        },
      });

      context.registerTool({
        id: 'agents.register',
        title: 'Register Agent',
        pluginId: PLUGIN_ID,
        description: 'Create or update a named agent. Args: { id, name, role?, systemPrompt?, provider?, model?, toolAllowlist?, enabled? }',
        parameters: z.object({
          id: z.string().regex(/^[a-z0-9_-]+$/).describe('Unique agent identifier (lowercase, hyphens, underscores)'),
          name: z.string().min(1).describe('Human-readable agent name'),
          role: z.string().optional().describe('Short role description'),
          systemPrompt: z.string().optional().describe('Custom system prompt for this agent'),
          provider: z.string().optional().describe('Pinned provider ID (e.g. anthropic, openai)'),
          model: z.string().optional().describe('Pinned model ID (e.g. claude-sonnet-4-20250514)'),
          toolAllowlist: z.array(z.string()).optional().describe('Restrict agent to these tool IDs only'),
          enabled: z.boolean().optional().describe('Whether the agent is enabled (default true)'),
        }),
        execute: async (rawArgs) => {
          try {
            const args = asObject(rawArgs as JsonValue);
            const id = asString(args.id, 'id');
            const name = asString(args.name, 'name');
            const now = new Date().toISOString();

            const existing = registry.get(id);
            const action = existing ? 'updated' : 'created';

            const spec: AgentSpec = {
              id,
              name,
              role: typeof args.role === 'string' ? args.role : existing?.role ?? '',
              systemPrompt: typeof args.systemPrompt === 'string' ? args.systemPrompt : existing?.systemPrompt ?? '',
              provider: typeof args.provider === 'string' ? args.provider : existing?.provider,
              model: typeof args.model === 'string' ? args.model : existing?.model,
              enabled: typeof args.enabled === 'boolean' ? args.enabled : existing?.enabled ?? true,
              toolAllowlist: Array.isArray(args.toolAllowlist) ? (args.toolAllowlist as string[]) : existing?.toolAllowlist,
              createdAt: existing?.createdAt ?? now,
              updatedAt: now,
            };

            await registry.register(spec);
            events?.publish('agents:registered', { agentId: id, name, action });

            return { ok: true, output: `Agent "${id}" ${action}.` };
          } catch (err) {
            return { ok: false, error: { code: 'REGISTER_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'agents.invoke',
        title: 'Invoke Agent',
        pluginId: PLUGIN_ID,
        description: 'Invoke a named agent with a prompt. The agent runs a full agentic loop with tools. Args: { id, prompt, noTools? }',
        parameters: z.object({
          id: z.string().describe('Agent ID to invoke'),
          prompt: z.string().min(1).describe('Prompt to send to the agent'),
          noTools: z.boolean().optional().describe('When true, agent runs without tools'),
        }),
        execute: async (rawArgs) => {
          try {
            if (!llm || !kernel) {
              return { ok: false, error: { code: 'NO_LLM', message: 'LLM adapter not available' } };
            }

            const args = asObject(rawArgs as JsonValue);
            const id = asString(args.id, 'id');
            const prompt = asString(args.prompt, 'prompt');
            const noTools = args.noTools === true;

            const agent = registry.get(id);
            if (!agent) {
              return { ok: false, error: { code: 'NOT_FOUND', message: `Agent "${id}" not found` } };
            }
            if (!agent.enabled) {
              return { ok: false, error: { code: 'DISABLED', message: `Agent "${id}" is disabled` } };
            }

            events?.publish('agents:invoked', { agentId: id, name: agent.name, promptLength: prompt.length });

            const requestId = randomUUID().slice(0, 8);
            const systemPrompt = await kernel.assemblePrompt();

            const agentSystemParts: string[] = [systemPrompt];
            if (agent.systemPrompt) {
              agentSystemParts.push(`\n\n## Agent Instructions (${agent.name})\n${agent.systemPrompt}`);
            }

            const startMs = Date.now();
            const result = await llm.complete({
              sessionId: `agents-${id}-${requestId}`,
              agentId: id,
              pinnedProviderId: agent.provider,
              pinnedModelId: agent.model,
              toolAllowlist: noTools ? undefined : agent.toolAllowlist,
              noTools,
              messages: [
                { role: 'system', content: agentSystemParts.join('') },
                { role: 'user', content: prompt },
              ],
            });

            const durationMs = Date.now() - startMs;
            events?.publish('agents:completed', {
              agentId: id,
              name: agent.name,
              steps: result.steps,
              toolCalls: result.toolCalls,
              durationMs,
              finishReason: result.finishReason,
            });

            return {
              ok: true,
              output: {
                text: result.text,
                steps: result.steps,
                toolCalls: result.toolCalls,
                finishReason: result.finishReason,
                durationMs,
              } as unknown as JsonValue,
            };
          } catch (err) {
            return { ok: false, error: { code: 'INVOKE_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'agents.remove',
        title: 'Remove Agent',
        pluginId: PLUGIN_ID,
        description: 'Delete a registered agent. Args: { id }',
        parameters: z.object({
          id: z.string().describe('Agent ID to remove'),
        }),
        execute: async (rawArgs) => {
          try {
            const args = asObject(rawArgs as JsonValue);
            const id = asString(args.id, 'id');
            const agent = registry.get(id);
            if (!agent) {
              return { ok: false, error: { code: 'NOT_FOUND', message: `Agent "${id}" not found` } };
            }
            await registry.remove(id);
            events?.publish('agents:removed', { agentId: id, name: agent.name });
            return { ok: true, output: `Agent "${id}" removed.` };
          } catch (err) {
            return { ok: false, error: { code: 'REMOVE_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'agents.team.register',
        title: 'Register Team',
        pluginId: PLUGIN_ID,
        description: 'Create or update a team of agents. Args: { id, name, leaderAgentId, memberAgentIds }',
        parameters: z.object({
          id: z.string().regex(/^[a-z0-9_-]+$/).describe('Unique team identifier'),
          name: z.string().min(1).describe('Human-readable team name'),
          leaderAgentId: z.string().describe('Agent ID that leads the team'),
          memberAgentIds: z.array(z.string()).describe('Agent IDs in the team'),
        }),
        execute: async (rawArgs) => {
          try {
            const args = asObject(rawArgs as JsonValue);
            const id = asString(args.id, 'id');
            const name = asString(args.name, 'name');
            const leaderAgentId = asString(args.leaderAgentId, 'leaderAgentId');

            if (!Array.isArray(args.memberAgentIds)) {
              return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'memberAgentIds must be an array' } };
            }
            const memberAgentIds = args.memberAgentIds as string[];

            const now = new Date().toISOString();
            const existing = registry.getTeam(id);

            const spec: TeamSpec = {
              id,
              name,
              leaderAgentId,
              memberAgentIds,
              createdAt: existing?.createdAt ?? now,
              updatedAt: now,
            };

            await registry.registerTeam(spec);
            return { ok: true, output: `Team "${id}" ${existing ? 'updated' : 'created'}.` };
          } catch (err) {
            return { ok: false, error: { code: 'TEAM_REGISTER_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'agents.team.remove',
        title: 'Remove Team',
        pluginId: PLUGIN_ID,
        description: 'Delete a registered team. Args: { id }',
        parameters: z.object({
          id: z.string().describe('Team ID to remove'),
        }),
        execute: async (rawArgs) => {
          try {
            const args = asObject(rawArgs as JsonValue);
            const id = asString(args.id, 'id');
            if (!registry.getTeam(id)) {
              return { ok: false, error: { code: 'NOT_FOUND', message: `Team "${id}" not found` } };
            }
            await registry.removeTeam(id);
            return { ok: true, output: `Team "${id}" removed.` };
          } catch (err) {
            return { ok: false, error: { code: 'TEAM_REMOVE_ERROR', message: String(err) } };
          }
        },
      });

      // ── Command ───────────────────────────────────────────────────

      context.registerCommand({
        id: 'agents',
        pluginId: PLUGIN_ID,
        description: 'Agent registry management (list, register, remove, invoke, teams)',
        subcommands: ['list', 'register', 'remove', 'invoke', 'teams'],
        execute: async (args, commandContext) => {
          const sub = args[0] ?? 'list';

          if (sub === 'list') {
            const agents = registry.list();
            const teams = registry.listTeams();
            if (agents.length === 0 && teams.length === 0) {
              commandContext.stdout.write('No agents or teams registered.\n');
              return 0;
            }
            if (agents.length > 0) {
              commandContext.stdout.write('Agents:\n');
              for (const a of agents) {
                const model = a.provider
                  ? `${a.provider}${a.model ? `/${a.model}` : ''}`
                  : 'default';
                const status = a.enabled ? 'enabled' : 'disabled';
                commandContext.stdout.write(`  ${a.id} — ${a.name} [${model}] (${status})\n`);
                if (a.role) commandContext.stdout.write(`    Role: ${a.role}\n`);
                if (a.toolAllowlist) commandContext.stdout.write(`    Tools: ${a.toolAllowlist.join(', ')}\n`);
              }
            }
            if (teams.length > 0) {
              commandContext.stdout.write('Teams:\n');
              for (const t of teams) {
                commandContext.stdout.write(`  ${t.id} — ${t.name} (leader: ${t.leaderAgentId}, members: ${t.memberAgentIds.join(', ')})\n`);
              }
            }
            return 0;
          }

          if (sub === 'register') {
            const id = args[1];
            const name = args[2];
            if (!id || !name) {
              commandContext.stderr.write('Usage: agents register <id> <name> [role]\n');
              return 1;
            }
            const role = args.slice(3).join(' ') || '';
            const now = new Date().toISOString();
            const existing = registry.get(id);
            await registry.register({
              id,
              name,
              role,
              systemPrompt: existing?.systemPrompt ?? '',
              provider: existing?.provider,
              model: existing?.model,
              enabled: existing?.enabled ?? true,
              toolAllowlist: existing?.toolAllowlist,
              createdAt: existing?.createdAt ?? now,
              updatedAt: now,
            });
            events?.publish('agents:registered', { agentId: id, name, action: existing ? 'updated' : 'created' });
            commandContext.stdout.write(`Agent "${id}" ${existing ? 'updated' : 'registered'}.\n`);
            return 0;
          }

          if (sub === 'remove') {
            const id = args[1];
            if (!id) {
              commandContext.stderr.write('Usage: agents remove <id>\n');
              return 1;
            }
            const agent = registry.get(id);
            if (!agent) {
              commandContext.stderr.write(`Agent "${id}" not found.\n`);
              return 1;
            }
            await registry.remove(id);
            events?.publish('agents:removed', { agentId: id, name: agent.name });
            commandContext.stdout.write(`Agent "${id}" removed.\n`);
            return 0;
          }

          if (sub === 'invoke') {
            const id = args[1];
            const prompt = args.slice(2).join(' ');
            if (!id || !prompt) {
              commandContext.stderr.write('Usage: agents invoke <id> <prompt...>\n');
              return 1;
            }
            const agent = registry.get(id);
            if (!agent) {
              commandContext.stderr.write(`Agent "${id}" not found.\n`);
              return 1;
            }
            if (!agent.enabled) {
              commandContext.stderr.write(`Agent "${id}" is disabled.\n`);
              return 1;
            }
            if (!llm || !kernel) {
              commandContext.stderr.write('LLM adapter not available.\n');
              return 1;
            }

            events?.publish('agents:invoked', { agentId: id, name: agent.name, promptLength: prompt.length });
            commandContext.stdout.write(`Invoking agent "${id}"...\n`);

            const requestId = randomUUID().slice(0, 8);
            const systemPrompt = await kernel.assemblePrompt();
            const agentSystemParts: string[] = [systemPrompt];
            if (agent.systemPrompt) {
              agentSystemParts.push(`\n\n## Agent Instructions (${agent.name})\n${agent.systemPrompt}`);
            }

            const startMs = Date.now();
            try {
              const result = await llm.complete({
                sessionId: `agents-${id}-${requestId}`,
                agentId: id,
                pinnedProviderId: agent.provider,
                pinnedModelId: agent.model,
                toolAllowlist: agent.toolAllowlist,
                messages: [
                  { role: 'system', content: agentSystemParts.join('') },
                  { role: 'user', content: prompt },
                ],
              });

              const durationMs = Date.now() - startMs;
              events?.publish('agents:completed', {
                agentId: id,
                name: agent.name,
                steps: result.steps,
                toolCalls: result.toolCalls,
                durationMs,
                finishReason: result.finishReason,
              });

              commandContext.stdout.write(`${result.text}\n`);
              commandContext.stdout.write(`\n[steps: ${result.steps}, tools: ${result.toolCalls}, ${durationMs}ms]\n`);
              return 0;
            } catch (err) {
              commandContext.stderr.write(`Agent invocation failed: ${err instanceof Error ? err.message : String(err)}\n`);
              return 1;
            }
          }

          if (sub === 'teams') {
            const teamSub = args[1] ?? 'list';
            if (teamSub === 'list') {
              const teams = registry.listTeams();
              if (teams.length === 0) {
                commandContext.stdout.write('No teams registered.\n');
                return 0;
              }
              for (const t of teams) {
                commandContext.stdout.write(`${t.id} — ${t.name} (leader: ${t.leaderAgentId}, members: ${t.memberAgentIds.join(', ')})\n`);
              }
              return 0;
            }
            if (teamSub === 'register') {
              const id = args[2];
              const name = args[3];
              const leaderId = args[4];
              const memberIds = args.slice(5);
              if (!id || !name || !leaderId || memberIds.length === 0) {
                commandContext.stderr.write('Usage: agents teams register <id> <name> <leaderAgentId> <member1> [member2...]\n');
                return 1;
              }
              const now = new Date().toISOString();
              const existing = registry.getTeam(id);
              await registry.registerTeam({
                id,
                name,
                leaderAgentId: leaderId,
                memberAgentIds: memberIds,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
              });
              commandContext.stdout.write(`Team "${id}" ${existing ? 'updated' : 'registered'}.\n`);
              return 0;
            }
            if (teamSub === 'remove') {
              const id = args[2];
              if (!id) {
                commandContext.stderr.write('Usage: agents teams remove <id>\n');
                return 1;
              }
              if (!registry.getTeam(id)) {
                commandContext.stderr.write(`Team "${id}" not found.\n`);
                return 1;
              }
              await registry.removeTeam(id);
              commandContext.stdout.write(`Team "${id}" removed.\n`);
              return 0;
            }
            commandContext.stderr.write('Usage: agents teams [list|register|remove]\n');
            return 1;
          }

          commandContext.stderr.write(`Unknown subcommand: ${sub}\nUsage: agents [list|register|remove|invoke|teams]\n`);
          return 1;
        },
      });

      // ── Context Provider ───────────────────────────────────────────

      context.contributeContextProvider({
        id: 'agents.roster',
        pluginId: PLUGIN_ID,
        priority: 50,
        provide: () => {
          const roster = registry.formatRoster();
          return roster.length > 0 ? roster : '';
        },
      });

      // ── Startup Hook ───────────────────────────────────────────────

      context.registerHook({
        id: 'agents.startup',
        pluginId: PLUGIN_ID,
        domain: 'kernel',
        event: 'startup',
        priority: 55,
        handler: async () => {
          await registry.load();
          const agentCount = registry.list().length;
          const teamCount = registry.listTeams().length;
          logger.info('Agent registry loaded', { agents: agentCount, teams: teamCount });
        },
      });
    },
  };
}

export { createAgentsPlugin as createPlugin };
