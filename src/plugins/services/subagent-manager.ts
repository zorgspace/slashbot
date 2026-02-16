import { randomUUID } from 'node:crypto';
import type { LlmAdapter, LlmCompletionInput, AgentMessage } from '../../core/agentic/llm/types.js';
import type { AgentLoopResult } from '../../core/agentic/agent-loop.js';
import type { StructuredLogger, ChannelDefinition, JsonValue } from '../../core/kernel/contracts.js';

/** Minimal tool info for building the subagent prompt. */
export interface SubagentToolInfo {
  id: string;
  title?: string;
  description: string;
}

export interface SubagentTask {
  id: string;
  task: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
  /** Session ID of the caller that spawned this subagent. */
  originSessionId?: string;
}

/** Tool IDs that subagents must never use (prevents recursion / dangerous side-effects). */
const BLOCKED_TOOLS = new Set<string>([
]);

/** Maximum nesting depth for subagent spawns. */
const MAX_DEPTH = 3;

/** Tools removed from deep subagents to prevent further nesting. */
const SPAWN_TOOLS = new Set(['spawn', 'spawn.status']);

/**
 * SubagentManager — runs independent agent loops as subagents.
 *
 * Each spawned subagent gets its own LLM completion with a task-specific
 * prompt. Results are returned directly to the caller (synchronous).
 * Depth is enforced to prevent unbounded recursion.
 */
export class SubagentManager {
  private readonly tasks = new Map<string, SubagentTask>();

  constructor(
    private readonly llm: LlmAdapter,
    private readonly assemblePrompt: () => Promise<string>,
    private readonly logger: StructuredLogger,
    private readonly deliveryChannel?: ChannelDefinition,
    /** Returns all registered tools — used to build allowlist and prompt. */
    private readonly getAvailableTools?: () => SubagentToolInfo[],
  ) {}

  async spawn(taskDescription: string, originSessionId?: string, depth: number = 0): Promise<SubagentTask> {
    const id = randomUUID().slice(0, 8);
    const task: SubagentTask = {
      id,
      task: taskDescription,
      status: 'running',
      startedAt: new Date().toISOString(),
      originSessionId,
    };
    this.tasks.set(id, task);

    if (depth >= MAX_DEPTH) {
      task.status = 'error';
      task.error = `Maximum subagent nesting depth (${MAX_DEPTH}) exceeded.`;
      task.completedAt = new Date().toISOString();
      this.logger.warn('Subagent depth limit reached', { taskId: task.id, depth });
      return task;
    }

    await this.runSubagent(task, depth);

    return task;
  }

  list(): SubagentTask[] {
    return [...this.tasks.values()];
  }

  get(id: string): SubagentTask | undefined {
    return this.tasks.get(id);
  }

  private buildToolAllowlist(depth: number): string[] | undefined {
    const allTools = this.getAvailableTools?.();
    if (!allTools) return undefined;
    return allTools
      .map((t) => t.id)
      .filter((id) => depth >= 2 ? !SPAWN_TOOLS.has(id) : true);
  }

  private buildToolCatalog(depth: number): string {
    const allTools = this.getAvailableTools?.();
    if (!allTools || allTools.length === 0) return '';
    const allowed = allTools.filter((t) => {
      if (BLOCKED_TOOLS.has(t.id)) return false;
      if (depth >= 2 && SPAWN_TOOLS.has(t.id)) return false;
      return true;
    });
    const catalog = allowed
      .map((t) => `- ${t.id}${t.title ? ` (${t.title})` : ''}: ${t.description}`)
      .join('\n');
    return `\n\nAvailable tools (${allowed.length}):\n${catalog}`;
  }

  private async runSubagent(task: SubagentTask, depth: number): Promise<void> {
    try {
      const systemPrompt = await this.assemblePrompt();
      const toolCatalog = this.buildToolCatalog(depth);

      const subagentDirective = [
        '## Subagent Directive',
        '',
        'You are an autonomous subagent with full tool access.',
        'Your job is to complete the task below using the tools at your disposal.',
        '',
        '### Execution rules',
        '- Use tools for EVERY action: run commands with shell.exec, read files with fs.read, search the web with web.search/web.fetch, manage memory with memory.*, send messages with the message tool.',
        '- Chain multiple tool calls when needed — you can call tools repeatedly across multiple turns.',
        '- NEVER fabricate output. If you need data, fetch it with a tool.',
        '- If a tool call fails, try an alternative approach.',
        '',
        '### Delivery',
        'Your result will be returned directly to the parent agent.',
        toolCatalog,
      ].join('\n');

      const messages: AgentMessage[] = [
        { role: 'system', content: `${systemPrompt}\n\n${subagentDirective}` },
        { role: 'user', content: task.task },
      ];

      const toolAllowlist = this.buildToolAllowlist(depth);

      const input: LlmCompletionInput = {
        sessionId: `subagent-${task.id}`,
        agentId: 'subagent',
        messages,
        toolAllowlist,
      };

      const result: AgentLoopResult = await this.llm.complete(input);

      task.status = 'done';
      task.result = result.text;
      task.completedAt = new Date().toISOString();

      this.logger.info('Subagent completed', { taskId: task.id, steps: result.steps, toolCalls: result.toolCalls });
    } catch (err) {
      task.status = 'error';
      task.error = err instanceof Error ? err.message : String(err);
      task.completedAt = new Date().toISOString();
      this.logger.warn('Subagent failed', { taskId: task.id, error: task.error });
    }
  }
}
