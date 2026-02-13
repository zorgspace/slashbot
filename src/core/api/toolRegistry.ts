/**
 * Tool Registry - Bridges AI SDK native tool calling with Slashbot's action system.
 * Collects ToolContributions from plugins, builds AI SDK tools map,
 * and maps tool call results back to Action objects.
 */

import type { Tool } from 'ai';
import type { ToolContribution } from '../../plugins/types';
import type { Action, ActionResult, ActionHandlers } from '../actions/types';
import { executeActions } from '../actions/executor';
import {
  detectEscapedNewlineCorruption,
  repairStructuralEscapedNewlines,
} from '../actions/contentGuards';
import { display } from '../ui';

/**
 * Execution context shared between tool execute callbacks and the agentic loop.
 * Signals are mutated by execute callbacks; the loop reads them after streamResponse().
 */
export interface ToolExecContext {
  actionHandlers: ActionHandlers;
  readFiles: Map<string, 'full' | 'partial'>;
  unresolvedEditPaths: Set<string>;
  outputTabId?: string;
  executionPolicy?: {
    blockedToolNames: Set<string>;
    blockedActionTypes: Set<string>;
    blockReason: string;
  };
  signals: {
    shouldBreak: boolean;
    shouldResetIteration: boolean;
    endMessage?: string;
    pendingSayMessages: string[];
    blockedEndCount: number;
    pendingVerificationFailure?: string;
  };
  maxBlockedEnds: number;
  cacheFileContents: boolean;
  fileContextCache: { set(key: string, value: string): void; has(key: string): boolean };
  onRead?: (path: string) => Promise<string>;
  /** Populated by execute callbacks for the agentic loop to inspect */
  actionResults: ActionResult[];
}

export class ToolRegistry {
  private contributions = new Map<string, ToolContribution>();

  /**
   * Register tool contributions from plugins
   */
  register(tools: ToolContribution[]): void {
    for (const t of tools) {
      this.contributions.set(t.name, t);
    }
  }

  /**
   * Build the AI SDK `tools` parameter for generateText() — bare definitions without execute.
   * Used as fallback for XML mode.
   */
  buildToolsParam(): Record<string, Tool> {
    const tools: Record<string, Tool> = {};
    for (const [name, contrib] of this.contributions) {
      tools[name] = {
        description: contrib.description,
        inputSchema: contrib.parameters,
      };
    }
    return tools;
  }

  /**
   * Build AI SDK tools with execute callbacks.
   * Each callback handles control flow, read tracking, edit validation,
   * action execution, and file caching — so the agentic loop doesn't need to.
   */
  buildExecutableTools(ctx: ToolExecContext): Record<string, Tool> {
    const tools: Record<string, Tool> = {};

    for (const [name, contrib] of this.contributions) {
      // Use inputSchema directly (not tool() helper) — Zod v4 schemas work
      // with inputSchema but tool()'s parameters conversion breaks them.
      tools[name] = {
        description: contrib.description,
        inputSchema: contrib.parameters,
        execute: async (args: Record<string, unknown>) => {
          return this.executeToolCallback(contrib, args, ctx);
        },
      } as Tool;
    }

    return tools;
  }

  /**
   * Map a single tool call from the AI SDK result to a Slashbot Action.
   * Returns null if the tool is unknown.
   */
  mapToolCallToAction(toolName: string, args: Record<string, unknown>): Action | null {
    const contrib = this.contributions.get(toolName);
    if (!contrib) return null;
    return contrib.toAction(args);
  }

  /**
   * Get the control-flow hint for a tool ('say', 'end', 'continue', or undefined).
   */
  getControlFlow(toolName: string): 'say' | 'end' | 'continue' | undefined {
    return this.contributions.get(toolName)?.controlFlow;
  }

  /**
   * Check if a tool name is registered
   */
  has(toolName: string): boolean {
    return this.contributions.has(toolName);
  }

  /**
   * Get all registered tool names
   */
  getToolNames(): string[] {
    return Array.from(this.contributions.keys());
  }

  /**
   * Get registered tool definitions for prompt/runtime introspection.
   */
  getToolDefinitions(): Array<{ name: string; description: string }> {
    return Array.from(this.contributions.values())
      .map(contrib => ({
        name: contrib.name,
        description: contrib.description || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get the number of registered tools
   */
  get size(): number {
    return this.contributions.size;
  }

  // ===== Private =====

  /**
   * Execute callback for a single tool. Handles control flow, read tracking,
   * edit validation, action execution, unresolved edit tracking, and file caching.
   */
  private async executeToolCallback(
    contrib: ToolContribution,
    args: Record<string, unknown>,
    ctx: ToolExecContext,
  ): Promise<string> {
    return display.withOutputTab(ctx.outputTabId, async () => {
      const controlFlow = contrib.controlFlow;

      // --- Control flow: end ---
      if (controlFlow === 'end') {
        if (ctx.unresolvedEditPaths.size > 0 && ctx.signals.blockedEndCount < ctx.maxBlockedEnds) {
          ctx.signals.blockedEndCount++;
          const failedList = Array.from(ctx.unresolvedEditPaths).join(', ');
          return `BLOCKED: Cannot finish \u2014 unresolved edit failures: ${failedList}. Fix them first.`;
        }
        if (
          ctx.signals.pendingVerificationFailure &&
          ctx.signals.blockedEndCount < ctx.maxBlockedEnds
        ) {
          ctx.signals.blockedEndCount++;
          return `BLOCKED: Cannot finish \u2014 verification command failed: ${ctx.signals.pendingVerificationFailure}. Fix the issue and rerun verification until it passes.`;
        }
        const action = contrib.toAction(args);
        const message = (action as any).message || '';
        ctx.signals.shouldBreak = true;
        ctx.signals.endMessage = message || undefined;
        return 'Task ended';
      }

      // --- Control flow: say ---
      if (controlFlow === 'say') {
        const action = contrib.toAction(args);
        const message = (action as any).message || '';
        if (message) {
          ctx.signals.pendingSayMessages.push(message);
        }
        return 'Message displayed';
      }

      // --- Control flow: continue ---
      if (controlFlow === 'continue') {
        ctx.signals.shouldResetIteration = true;
        return 'Iteration counter reset';
      }

      const normalizedToolName = contrib.name.trim().toLowerCase();
      if (ctx.executionPolicy?.blockedToolNames.has(normalizedToolName)) {
        const msg = `${ctx.executionPolicy.blockReason} Blocked tool: ${contrib.name}.`;
        ctx.actionResults.push({
          action: contrib.name,
          success: false,
          result: 'Blocked',
          error: msg,
        });
        return msg;
      }

      // --- Regular action tools ---
      const action = contrib.toAction(args);
      const normalizedActionType = String(action.type ?? '')
        .trim()
        .toLowerCase();
      if (ctx.executionPolicy?.blockedActionTypes.has(normalizedActionType)) {
        const msg = `${ctx.executionPolicy.blockReason} Blocked action: ${normalizedActionType}.`;
        ctx.actionResults.push({
          action: String(action.type ?? contrib.name),
          success: false,
          result: 'Blocked',
          error: msg,
        });
        return msg;
      }

      // Reject malformed escaped-newline payloads (e.g. literal "\n" used for indentation).
      if (action.type === 'edit') {
        const path = action.path as string | undefined;
        const newString = action.newString;
        if (typeof newString === 'string') {
          let corruption = detectEscapedNewlineCorruption(newString);
          if (corruption) {
            const repaired = repairStructuralEscapedNewlines(newString);
            if (repaired.changed) {
              const repairedCorruption = detectEscapedNewlineCorruption(repaired.content);
              if (!repairedCorruption) {
                (action as any).newString = repaired.content;
                corruption = null;
              } else {
                corruption = repairedCorruption;
              }
            }
          }
          if (corruption) {
            const target = path || 'unknown file';
            const errorMsg = `Cannot edit ${target} — ${corruption}. Use REAL new lines in newString, not literal "\\n".`;
            ctx.actionResults.push({
              action: `Edit: ${target}`,
              success: false,
              result: 'Blocked',
              error: errorMsg,
            });
            return errorMsg;
          }
        }
      }
      if (action.type === 'write' || action.type === 'create') {
        const path = action.path as string | undefined;
        const content = action.content;
        if (typeof content === 'string') {
          let corruption = detectEscapedNewlineCorruption(content);
          if (corruption) {
            const repaired = repairStructuralEscapedNewlines(content);
            if (repaired.changed) {
              const repairedCorruption = detectEscapedNewlineCorruption(repaired.content);
              if (!repairedCorruption) {
                (action as any).content = repaired.content;
                corruption = null;
              } else {
                corruption = repairedCorruption;
              }
            }
          }
          if (corruption) {
            const target = path || 'unknown file';
            const verb = action.type === 'write' ? 'write' : 'create';
            const errorMsg = `Cannot ${verb} ${target} — ${corruption}. Use REAL new lines in content, not literal "\\n".`;
            ctx.actionResults.push({
              action: `Write: ${target}`,
              success: false,
              result: 'Blocked',
              error: errorMsg,
            });
            return errorMsg;
          }
        }
      }

      // Read tracking
      if (action.type === 'read') {
        const path = action.path as string | undefined;
        if (path) {
          const hasOffset = action.offset !== undefined;
          const hasLimit = action.limit !== undefined;
          const coverage = hasOffset || hasLimit ? 'partial' : 'full';
          if (ctx.readFiles.get(path) !== 'full') {
            ctx.readFiles.set(path, coverage);
          }
        }
      }

      // Edit validation: reject edits on files not fully read
      if (action.type === 'edit') {
        const path = action.path as string | undefined;
        if (path && ctx.readFiles.get(path) !== 'full') {
          const wasPartial = ctx.readFiles.get(path) === 'partial';
          const errorMsg = wasPartial
            ? `Cannot edit ${path} \u2014 you only read part of this file. Use read_file (without offset/limit) to read the entire file first, then retry.`
            : `Cannot edit ${path} \u2014 you have not read this file yet. Use read_file first, then retry the edit.`;
          ctx.actionResults.push({
            action: `Edit: ${path}`,
            success: false,
            result: 'Blocked',
            error: errorMsg,
          });
          return errorMsg;
        }
      }

      // Execute the action
      const results = await executeActions([action], ctx.actionHandlers);
      const result = results[0];

      if (!result) {
        ctx.actionResults.push({
          action: contrib.name,
          success: false,
          result: 'No result',
        });
        return 'No result';
      }

      // Track in actionResults
      ctx.actionResults.push(result);

      // Track unresolved edit failures
      const actionStr = String(result.action ?? '');
      if (actionStr.startsWith('Edit:')) {
        const path = actionStr.replace(/^Edit:\s*/, '').trim();
        if (result.success) ctx.unresolvedEditPaths.delete(path);
        else ctx.unresolvedEditPaths.add(path);
      } else if (actionStr.startsWith('Write:') && result.success) {
        const path = actionStr.replace(/^Write:\s*/, '').trim();
        ctx.unresolvedEditPaths.delete(path);
      }
      this.trackVerificationFailure(action, result, ctx);

      // Cache file contents
      if (ctx.cacheFileContents) {
        await this.cacheFileContent(action, actionStr, result, ctx);
      }

      // Format result for the LLM
      const status = result.success ? '\u2713' : '\u2717';
      const errorNote = result.error ? `\nError: ${result.error}` : '';
      return `[${status}] ${result.result}${errorNote}`;
    });
  }

  private trackVerificationFailure(
    action: Action,
    result: ActionResult,
    ctx: ToolExecContext,
  ): void {
    const actionType = String(action.type || '')
      .trim()
      .toLowerCase();
    if (actionType !== 'bash' && actionType !== 'exec') {
      return;
    }
    const command =
      typeof (action as any).command === 'string' ? (action as any).command.trim() : '';
    if (!command || !this.isVerificationCommand(command)) {
      return;
    }
    if (result.success) {
      ctx.signals.pendingVerificationFailure = undefined;
      return;
    }
    ctx.signals.pendingVerificationFailure = command;
  }

  private isVerificationCommand(command: string): boolean {
    const normalized = command.toLowerCase();
    const patterns = [
      /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|build|typecheck|check)\b/,
      /\bgo\s+test\b/,
      /\bcargo\s+(?:test|check|clippy|build)\b/,
      /\b(?:pytest|vitest|jest|mocha|ava)\b/,
      /\btsc\b/,
      /\b(?:eslint|ruff|mypy)\b/,
      /\b(?:gradle|mvn|dotnet)\b.*\b(?:test|build|check)\b/,
      /\bmake\s+(?:test|lint|build|check)\b/,
    ];
    return patterns.some(pattern => pattern.test(normalized));
  }

  private async cacheFileContent(
    action: Action,
    actionStr: string,
    result: ActionResult,
    ctx: ToolExecContext,
  ): Promise<void> {
    if (action.type === 'read' && result.success && result.result) {
      const filePath = typeof action.path === 'string' ? action.path.trim() : '';
      const isPartial = action.offset !== undefined || action.limit !== undefined;
      if (filePath && result.result.length < 50000) {
        // Always preserve the latest full read as canonical context for the file.
        // Partial windows should not override a previously cached full file.
        if (!isPartial || !ctx.fileContextCache.has(filePath)) {
          ctx.fileContextCache.set(filePath, result.result);
        }
      }
    }
    if (actionStr.startsWith('Edit:') && result.success && ctx.onRead) {
      const filePath = actionStr.replace(/^Edit: /, '').trim();
      try {
        const newContent = await ctx.onRead(filePath);
        if (newContent && newContent.length < 50000) {
          ctx.fileContextCache.set(filePath, newContent);
        }
      } catch {
        /* ignore */
      }
    }
    if (actionStr.startsWith('Write:') && result.success && ctx.onRead) {
      const filePath = actionStr.replace('Write: ', '').trim();
      try {
        const newContent = await ctx.onRead(filePath);
        if (newContent && newContent.length < 50000) {
          ctx.fileContextCache.set(filePath, newContent);
        }
      } catch {
        /* ignore */
      }
    }
  }
}
