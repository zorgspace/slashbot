import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  SidebarContribution,
  ToolContribution,
  KernelHookContribution,
} from '../types';
import { z } from 'zod/v4';
import type { CommandHandler } from '../../core/commands/registry';
import { registerActionParser } from '../../core/actions/parser';
import { TYPES } from '../../core/di/types';
import { buildDelegatedTaskPrompt, summarizeDelegatedTaskResult } from '../../core/app/delegation';
import { getAgentsParserConfigs } from './parser';
import {
  executeAgentStatus,
  executeAgentCreate,
  executeAgentUpdate,
  executeAgentDelete,
  executeAgentList,
  executeAgentTasks,
  executeAgentRun,
  executeAgentSend,
  executeAgentVerify,
  executeAgentRecall,
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
  private runtimeConfigured = false;
  private uiEventBindingsReady = false;

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
        type: 'agent-tasks',
        tagName: 'agent-tasks',
        handler: {
          onAgentTasks: async (input: {
            agent?: string;
            limit?: number;
            status?: 'queued' | 'running' | 'done' | 'failed';
          }) => {
            const allTasks = input.agent
              ? (() => {
                  const id = service.resolveAgentId(input.agent || '');
                  return id ? service.listTasksForAgent(id) : [];
                })()
              : service.listTasks();
            const filtered = input.status
              ? allTasks.filter(task => task.status === input.status)
              : allTasks;
            const limit =
              typeof input.limit === 'number' && Number.isFinite(input.limit)
                ? Math.max(1, Math.floor(input.limit))
                : 20;
            return filtered.slice(0, limit);
          },
        },
        execute: executeAgentTasks,
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
      {
        type: 'agent-send',
        tagName: 'agent-send',
        handler: {
          onAgentSend: async (action: { to: string; title: string; content: string }) => {
            const fromId = this.resolveSenderAgentId(service);
            const toId = service.resolveAgentId(action.to);
            if (!toId) return false;
            await service.sendTask({
              fromAgentId: fromId,
              toAgentId: toId,
              title: action.title,
              content: action.content,
            });
            return true;
          },
        },
        execute: executeAgentSend,
      },
      {
        type: 'agent-verify',
        tagName: 'agent-verify',
        handler: {
          onAgentVerify: async (action: {
            taskId: string;
            status: 'verified' | 'changes_requested';
            notes?: string;
          }) => {
            const verifierAgentId = this.resolveSenderAgentId(service);
            return await service.verifyTask({
              taskId: action.taskId,
              verifierAgentId,
              status: action.status,
              notes: action.notes,
            });
          },
        },
        execute: executeAgentVerify,
      },
      {
        type: 'agent-recall',
        tagName: 'agent-recall',
        handler: {
          onAgentRecall: async (action: { taskId: string; reason: string; title?: string }) => {
            const fromAgentId = this.resolveSenderAgentId(service);
            return await service.recallTask({
              taskId: action.taskId,
              fromAgentId,
              reason: action.reason,
              title: action.title,
            });
          },
        },
        execute: executeAgentRecall,
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
        name: 'agents_tasks',
        description: 'List tasks for verification and follow-up orchestration.',
        parameters: z.object({
          agent: z.string().optional().describe('Optional agent id/name filter'),
          status: z
            .enum(['queued', 'running', 'done', 'failed'])
            .optional()
            .describe('Optional task status filter'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe('Maximum number of tasks to return'),
        }),
        toAction: args => ({
          type: 'agent-tasks',
          agent: args.agent as string | undefined,
          status: args.status as 'queued' | 'running' | 'done' | 'failed' | undefined,
          limit: args.limit as number | undefined,
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
      {
        name: 'agents_verify',
        description:
          'Record verification decision for a completed task (approved or changes requested).',
        parameters: z.object({
          taskId: z.string().describe('Task id to verify'),
          status: z
            .enum(['verified', 'changes_requested'])
            .describe('Verification outcome'),
          notes: z.string().optional().describe('Optional verification notes'),
        }),
        toAction: args => ({
          type: 'agent-verify',
          taskId: args.taskId as string,
          status: args.status as 'verified' | 'changes_requested',
          notes: args.notes as string | undefined,
        }),
      },
      {
        name: 'agents_recall',
        description:
          'Queue a follow-up task for the same specialist when verification requires fixes/additions.',
        parameters: z.object({
          taskId: z.string().describe('Original task id'),
          reason: z.string().describe('What must be fixed or added'),
          title: z.string().optional().describe('Optional follow-up title'),
        }),
        toAction: args => ({
          type: 'agent-recall',
          taskId: args.taskId as string,
          reason: args.reason as string,
          title: args.title as string | undefined,
        }),
      },
    ];
  }

  getKernelHooks(): KernelHookContribution[] {
    return [
      {
        event: 'startup:after-grok-ready',
        order: 30,
        handler: payload => {
          if (this.runtimeConfigured) {
            return;
          }
          if (!this.service) {
            return;
          }
          const routeTaskWithLLM = payload.routeTaskWithLLM as
            | ((request: any) => Promise<any>)
            | undefined;
          const runDelegatedTask = payload.runDelegatedTask as
            | ((agent: any, taskText: string) => Promise<{ response: string; endMessage?: string }>)
            | undefined;
          const isOrchestratorAgent = payload.isOrchestratorAgent as
            | ((agent: any) => boolean)
            | undefined;
          if (!routeTaskWithLLM || !runDelegatedTask || !isOrchestratorAgent) {
            return;
          }

          this.runtimeConfigured = true;
          this.service.setTaskRouter(async request => routeTaskWithLLM(request));
          this.service.setTaskExecutor(async (agent, task) => {
            const taskPrompt = buildDelegatedTaskPrompt({
              agent,
              task,
              isOrchestrator: isOrchestratorAgent(agent),
            });
            const result = await runDelegatedTask(agent, taskPrompt);
            return { summary: summarizeDelegatedTaskResult(result) };
          });
        },
      },
      {
        event: 'startup:after-ui-ready',
        order: 60,
        handler: payload => {
          if (this.uiEventBindingsReady) {
            return;
          }
          const eventBus = this.context?.eventBus as
            | { on: (type: string, handler: (event: any) => void) => unknown }
            | undefined;
          const refreshTabs = payload.refreshTabs as (() => void) | undefined;
          const getActiveTabId = payload.getActiveTabId as (() => string) | undefined;
          const renderAgentsManagerTab = payload.renderAgentsManagerTab as (() => void) | undefined;
          const notifyAgentTab = payload.notifyAgentTab as ((agentId: string) => void) | undefined;
          const handleAgentTaskFailed = payload.handleAgentTaskFailed as
            | ((event: any) => void)
            | undefined;
          if (
            !eventBus ||
            !refreshTabs ||
            !getActiveTabId ||
            !renderAgentsManagerTab ||
            !notifyAgentTab ||
            !handleAgentTaskFailed
          ) {
            return;
          }

          this.uiEventBindingsReady = true;
          eventBus.on('agents:updated', () => {
            refreshTabs();
            if (getActiveTabId() === 'agents') {
              renderAgentsManagerTab();
            }
          });
          for (const eventName of [
            'agents:task-queued',
            'agents:task-running',
            'agents:task-done',
          ]) {
            eventBus.on(eventName, (event: any) => {
              const agentId = typeof event?.agentId === 'string' ? event.agentId : '';
              if (agentId) {
                notifyAgentTab(agentId);
              }
            });
          }
          eventBus.on('agents:task-failed', (event: any) => {
            const agentId = typeof event?.agentId === 'string' ? event.agentId : '';
            if (agentId) {
              notifyAgentTab(agentId);
            }
            handleAgentTaskFailed(event || {});
          });
        },
      },
      {
        event: 'input:after-command',
        order: 50,
        handler: async payload => {
          const source = String(payload.source || '');
          const command = String(payload.command || '').toLowerCase();
          if (source !== 'cli' || (command !== 'agent' && command !== 'agents')) {
            return;
          }

          const refreshTabs = payload.refreshTabs as (() => void) | undefined;
          const getActiveTabId = payload.getActiveTabId as (() => string) | undefined;
          const renderAgentsManagerTab = payload.renderAgentsManagerTab as (() => void) | undefined;
          const renderTabSession = payload.renderTabSession as
            | ((tabId: string) => void)
            | undefined;
          const hasAgentTab = payload.hasAgentTab as ((tabId: string) => boolean) | undefined;
          const hasConnectorTab = payload.hasConnectorTab as
            | ((tabId: string) => boolean)
            | undefined;
          const switchTab = payload.switchTab as ((tabId: string) => Promise<void>) | undefined;
          const getActiveAgentId = payload.getActiveAgentId as (() => string | null) | undefined;

          if (!refreshTabs || !getActiveTabId || !switchTab) {
            return;
          }

          const currentTab = getActiveTabId();
          refreshTabs();

          if (currentTab === 'agents') {
            renderAgentsManagerTab?.();
            return;
          }

          const shouldRenderCurrent =
            currentTab === 'main' ||
            hasAgentTab?.(currentTab) === true ||
            hasConnectorTab?.(currentTab) === true;
          if (shouldRenderCurrent) {
            renderTabSession?.(currentTab);
            return;
          }

          await switchTab(getActiveAgentId?.() || 'agents');
        },
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
          '- /agent tasks [agent|all] [limit]',
          '- /agent spawn <name> [responsibility]',
          '- /agent switch <agent-id|name>',
          '- /agent verify <task-id> <approved|changes_requested> [notes]',
          '- /agent recall <task-id> <follow-up request>',
          '- /agent history <agent-id> [limit]',
          '',
          'Native orchestration tools (preferred):',
          '- `agents_status`',
          '- `agents_list`',
          '- `agents_tasks`',
          '- `agents_create`',
          '- `agents_update`',
          '- `agents_delete`',
          '- `agents_run`',
          '- `agents_verify`',
          '- `agents_recall`',
          '- `sessions_usage`',
          '- `sessions_compaction`',
          '',
          'Coordination policy:',
          '- Architect/orchestrator agents must not implement directly; they plan/delegate/verify only.',
          '- Specialist agents should execute implementation tasks directly and report results back to the requester.',
          '- Verify delegated task results before closure; if needed, recall the specialist with explicit follow-up instructions.',
          '- For routing/coordination, use `agents_status`, `agents_list`, and `agents_tasks` when needed.',
          '',
          'Storage layout (OpenClaw-style, project-local):',
          '- .agents/agents.json',
          '- .agents/tasks.json',
          '- .agents/<agentId>/workspace/{AGENTS,SOUL,TOOLS,IDENTITY,USER,HEARTBEAT}.md',
          '- .agents/<agentId>/workspace/BOOTSTRAP.md (new workspace only)',
          '- .agents/<agentId>/agent/ (per-agent state dir)',

          '',
          'XML Tags (preferred for agent mgmt):',
          '- `<agent-create name="MyAgent" responsibility="Handle auth" systemPrompt="You are an auth specialist." autoPoll="true"/>`',
          '- `<agent-update agent="MyAgent" name="Updated" responsibility="New role"/>`',
          '- `<agent-delete agent="MyAgent"/>`',
          '- `<agent-list/>`',
          '- `<agent-status/>`',
          '- `<agent-tasks agent="Developer" status="done" limit="5"/>`',
          '- `<agent-run agent="MyAgent"/>`',
          '- `<agent-verify task="task-123" status="changes_requested" notes="Add missing test coverage"/>`',
          '- `<agent-recall task="task-123" reason="Add regression test and update docs"/>`',
          '',
          'Use XML tags directly for declarative agent management; fallback to tools (e.g., agents_create) if needed.',
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
