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
const BLOCKED_TOOLS = new Set([
  'spawn',
  'spawn.status',
]);

/**
 * SubagentManager — runs independent background agent loops.
 *
 * Each spawned subagent gets its own LLM completion with a task-specific
 * prompt. On completion, results are delivered via channel or stored for
 * retrieval. Subagents cannot spawn further subagents to prevent recursion.
 */
export class SubagentManager {
  private readonly tasks = new Map<string, SubagentTask>();
  private readonly pendingResults = new Map<string, SubagentTask[]>();

  constructor(
    private readonly llm: LlmAdapter,
    private readonly assemblePrompt: () => Promise<string>,
    private readonly logger: StructuredLogger,
    private readonly deliveryChannel?: ChannelDefinition,
    /** Returns all registered tools — used to build allowlist and prompt. */
    private readonly getAvailableTools?: () => SubagentToolInfo[],
  ) {}

  async spawn(taskDescription: string, originSessionId?: string): Promise<SubagentTask> {
    const id = randomUUID().slice(0, 8);
    const task: SubagentTask = {
      id,
      task: taskDescription,
      status: 'running',
      startedAt: new Date().toISOString(),
      originSessionId,
    };
    this.tasks.set(id, task);

    // Run in background — don't await
    void this.runSubagent(task);

    return task;
  }

  list(): SubagentTask[] {
    return [...this.tasks.values()];
  }

  get(id: string): SubagentTask | undefined {
    return this.tasks.get(id);
  }

  /** Drain all pending results for a session (returns and clears). */
  drainPendingResults(sessionId: string): SubagentTask[] {
    const results = this.pendingResults.get(sessionId) ?? [];
    if (results.length > 0) {
      this.pendingResults.delete(sessionId);
    }
    return results;
  }

  /** Check if there are pending results for a session. */
  hasPendingResults(sessionId: string): boolean {
    return (this.pendingResults.get(sessionId)?.length ?? 0) > 0;
  }

  private buildToolAllowlist(): string[] | undefined {
    const allTools = this.getAvailableTools?.();
    if (!allTools) return undefined;
    return allTools
      .map((t) => t.id)
      .filter((id) => !BLOCKED_TOOLS.has(id));
  }

  private buildToolCatalog(): string {
    const allTools = this.getAvailableTools?.();
    if (!allTools || allTools.length === 0) return '';
    const allowed = allTools.filter((t) => !BLOCKED_TOOLS.has(t.id));
    const catalog = allowed
      .map((t) => `- ${t.id}${t.title ? ` (${t.title})` : ''}: ${t.description}`)
      .join('\n');
    return `\n\nAvailable tools (${allowed.length}):\n${catalog}`;
  }

  private async runSubagent(task: SubagentTask): Promise<void> {
    try {
      const systemPrompt = await this.assemblePrompt();
      const toolCatalog = this.buildToolCatalog();

      const subagentDirective = [
        '## Subagent Directive',
        '',
        'You are an autonomous background subagent with full tool access.',
        'Your job is to complete the task below using the tools at your disposal.',
        '',
        '### Execution rules',
        '- Use tools for EVERY action: run commands with shell.exec, read files with fs.read, search the web with web.search/web.fetch, manage memory with memory.*, send messages with the message tool.',
        '- Chain multiple tool calls when needed — you can call tools repeatedly across multiple turns.',
        '- NEVER fabricate output. If you need data, fetch it with a tool.',
        '- If a tool call fails, try an alternative approach.',
        '',
        '### Delivery',
        task.originSessionId
          ? `Your results will be injected into the next message of session "${task.originSessionId}". Write a clear, actionable summary.`
          : 'Your results will be available via spawn.status. Write a clear, actionable summary.',
        toolCatalog,
      ].join('\n');

      const messages: AgentMessage[] = [
        { role: 'system', content: `${systemPrompt}\n\n${subagentDirective}` },
        { role: 'user', content: task.task },
      ];

      const toolAllowlist = this.buildToolAllowlist();

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

      // Push to pending results for the origin session
      if (task.originSessionId) {
        const pending = this.pendingResults.get(task.originSessionId) ?? [];
        pending.push(task);
        this.pendingResults.set(task.originSessionId, pending);
      }

      // Deliver result via channel if available
      if (this.deliveryChannel) {
        try {
          await this.deliveryChannel.send(`[Subagent ${task.id}] Task: ${task.task}\n\nResult: ${result.text}` as JsonValue);
        } catch (err) {
          this.logger.warn('Failed to deliver subagent result via channel', { taskId: task.id, error: String(err) });
        }
      }
    } catch (err) {
      task.status = 'error';
      task.error = err instanceof Error ? err.message : String(err);
      task.completedAt = new Date().toISOString();
      this.logger.warn('Subagent failed', { taskId: task.id, error: task.error });

      // Also push errors to pending results
      if (task.originSessionId) {
        const pending = this.pendingResults.get(task.originSessionId) ?? [];
        pending.push(task);
        this.pendingResults.set(task.originSessionId, pending);
      }
    }
  }
}
