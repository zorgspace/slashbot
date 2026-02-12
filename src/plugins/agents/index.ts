import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  SidebarContribution,
  ToolContribution,
} from '../types';
import { z } from 'zod/v4';
import type { CommandHandler } from '../../core/commands/registry';
import { registerActionParser } from '../../core/actions/parser';
import { TYPES } from '../../core/di/types';
import { getAgentsParserConfigs } from './parser';
import {
  executeAgentStatus,
  executeAgentCreate,
  executeAgentUpdate,
  executeAgentDelete,
  executeAgentList,
  executeAgentRun,
} from './executors';
import type { AgentOrchestratorService } from './services';
import { createAgentOrchestratorService } from './services';
import { agentCommands } from './commands';

export class AgentsPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.agents',
    name: 'Agents',
    version: '1.0.0',
    category: 'feature',
    description: 'Multi-agent tabs, sessions, and task orchestration',
  };

  private context!: PluginContext;
  private service!: AgentOrchestratorService;

  private resolveSenderAgentId(service: AgentOrchestratorService): string {
    const fallback = service.getActiveAgentId() || service.listAgents()[0]?.id || '';
    const client = this.context?.getGrokClient?.() as { getSessionId?: () => string } | null;
    const sessionId = client?.getSessionId?.();
    if (!sessionId) {
      return fallback;
    }
    const fromAgent = service.listAgents().find(agent => agent.sessionId === sessionId);
    return fromAgent?.id || fallback;
  }

  async init(context: PluginContext): Promise<void> {
    this.context = context;

    if (!context.container.isBound(TYPES.AgentOrchestratorService)) {
      context.container
        .bind(TYPES.AgentOrchestratorService)
        .toDynamicValue(() => {
          const eventBus = context.container.get<any>(TYPES.EventBus);
          return createAgentOrchestratorService(eventBus);
        })
        .inSingletonScope();
    }

    this.service = context.container.get<AgentOrchestratorService>(TYPES.AgentOrchestratorService);
    if (context.workDir) {
      this.service.setWorkDir(context.workDir);
    }
    await this.service.init();
    await this.service.start();

    for (const config of getAgentsParserConfigs()) {
      registerActionParser(config);
    }
  }

  async destroy(): Promise<void> {
    this.service?.stop();
  }

  getActionContributions(): ActionContribution[] {
    const service = this.service;
    return [
      {
        type: 'agent-status',
        tagName: 'agent-status',
        handler: {
          onAgentStatus: async () => ({
            summary: service.getSummary(),
            agents: service.listAgents(),
          }),
        },
        execute: executeAgentStatus,
      },
      {
        type: 'agent-create',
        tagName: 'agent-create',
        handler: {
          onAgentCreate: async (input: {
            name: string;
            responsibility?: string;
            systemPrompt?: string;
            autoPoll?: boolean;
          }) =>
            await service.createAgent({
              name: input.name,
              responsibility: input.responsibility,
              systemPrompt: input.systemPrompt,
              autoPoll: input.autoPoll,
            }),
        },
        execute: executeAgentCreate,
      },
      {
        type: 'agent-update',
        tagName: 'agent-update',
        handler: {
          onAgentUpdate: async (input: {
            agent: string;
            name?: string;
            responsibility?: string;
            systemPrompt?: string;
            enabled?: boolean;
            autoPoll?: boolean;
          }) => {
            const id = service.resolveAgentId(input.agent);
            if (!id) return null;
            return await service.updateAgent(id, {
              name: input.name,
              responsibility: input.responsibility,
              systemPrompt: input.systemPrompt,
              enabled: input.enabled,
              autoPoll: input.autoPoll,
            });
          },
        },
        execute: executeAgentUpdate,
      },
      {
        type: 'agent-delete',
        tagName: 'agent-delete',
        handler: {
          onAgentDelete: async (agent: string) => {
            const id = service.resolveAgentId(agent);
            if (!id) return false;
            return await service.deleteAgent(id);
          },
        },
        execute: executeAgentDelete,
      },
      {
        type: 'agent-list',
        tagName: 'agent-list',
        handler: {
          onAgentList: async () => service.listAgents(),
        },
        execute: executeAgentList,
      },
      {
        type: 'agent-run',
        tagName: 'agent-run',
        handler: {
          onAgentRun: async (agent: string) => {
            const id = service.resolveAgentId(agent);
            if (!id) return false;
            return await service.runNextForAgent(id);
          },
        },
        execute: executeAgentRun,
      },
    ];
  }

  getToolContributions(): ToolContribution[] {
    return [
      {
        name: 'agents_status',
        description:
          'Get multi-agent orchestration status: active agent, queue counts, and known agents.',
        parameters: z.object({}),
        toAction: () => ({
          type: 'agent-status',
        }),
      },
      {
        name: 'agents_list',
        description: 'List agents with current status fields for UI/RPC orchestration.',
        parameters: z.object({}),
        toAction: () => ({
          type: 'agent-list',
        }),
      },
      {
        name: 'agents_create',
        description: 'Create a new agent profile.',
        parameters: z.object({
          name: z.string().describe('Human-readable name'),
          responsibility: z.string().optional().describe('Role/responsibility'),
          systemPrompt: z.string().optional().describe('Optional full system prompt'),
          autoPoll: z.boolean().optional().describe('Whether to auto-run queued tasks'),
        }),
        toAction: args => ({
          type: 'agent-create',
          name: args.name as string,
          responsibility: args.responsibility as string | undefined,
          systemPrompt: args.systemPrompt as string | undefined,
          autoPoll: args.autoPoll as boolean | undefined,
        }),
      },
      {
        name: 'agents_update',
        description: 'Update an existing agent by id or name.',
        parameters: z.object({
          agent: z.string().describe('Agent id or name to update'),
          name: z.string().optional().describe('New display name'),
          responsibility: z.string().optional().describe('Updated role'),
          systemPrompt: z.string().optional().describe('Updated system prompt'),
          enabled: z.boolean().optional().describe('Enable/disable agent'),
          autoPoll: z.boolean().optional().describe('Enable/disable autopoll'),
        }),
        toAction: args => ({
          type: 'agent-update',
          agent: args.agent as string,
          name: args.name as string | undefined,
          responsibility: args.responsibility as string | undefined,
          systemPrompt: args.systemPrompt as string | undefined,
          enabled: args.enabled as boolean | undefined,
          autoPoll: args.autoPoll as boolean | undefined,
        }),
      },
      {
        name: 'agents_delete',
        description: 'Delete an agent by id or name.',
        parameters: z.object({
          agent: z.string().describe('Agent id or name to delete'),
        }),
        toAction: args => ({
          type: 'agent-delete',
          agent: args.agent as string,
        }),
      },
      {
        name: 'agents_run',
        description: 'Run one queued task immediately for a target agent.',
        parameters: z.object({
          agent: z.string().describe('Agent id or name'),
        }),
        toAction: args => ({
          type: 'agent-run',
          agent: args.agent as string,
        }),
      },
    ];
  }

  getCommandContributions(): CommandHandler[] {
    return agentCommands;
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'feature.agents.docs',
        title: 'Agents - Multi-Agent Orchestration',
        priority: 135,
        content: [
          'Use specialized agents with isolated sessions and filesystem task orchestration.',
          '',
          'Commands:',
          '- /agent status',
          '- /agent spawn <name> [responsibility]',
          '- /agent switch <agent-id|name>',
          '- /agent history <agent-id> [limit]',
          '',
          'Native orchestration tools (preferred):',
          '- `agents_status`',
          '- `agents_list`',
          '- `agents_create`',
          '- `agents_update`',
          '- `agents_delete`',
          '- `agents_run`',
          '- `sessions_usage`',
          '- `sessions_compaction`',
          '',
          'Coordination policy:',
          '- For routing/coordination, use `agents_status` and `agents_list` when needed.',
          '- Prefer direct execution tools for implementation tasks; coordinate only when blocked or delegating.',
          '',
          'Storage layout (OpenClaw-style, project-local):',
          '- .agents/agents.json',
          '- .agents/tasks.json',
          '- .agents/<agentId>/workspace/{AGENTS,SOUL,TOOLS,IDENTITY,USER,HEARTBEAT}.md',
          '- .agents/<agentId>/workspace/BOOTSTRAP.md (new workspace only)',
          '- .agents/<agentId>/agent/ (per-agent state dir)',
        ].join('\n'),
      },
    ];
  }

  getSidebarContributions(): SidebarContribution[] {
    const service = this.service;
    return [
      {
        id: 'agents',
        label: 'Agents',
        order: 19,
        getStatus: () => service.getSummary().polling,
      },
    ];
  }
}
