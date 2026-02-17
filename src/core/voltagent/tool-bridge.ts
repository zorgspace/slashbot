/**
 * @module voltagent/tool-bridge
 *
 * Bridges kernel tool definitions to VoltAgent Tool instances using createTool().
 * Preserves callback lifecycle events, dual-track output (forUser/forLlm),
 * error formatting, and result truncation from the original tool bridge.
 *
 * @see {@link buildVoltAgentTools} — Main entry point
 */
import { createTool, type Tool } from '@voltagent/core';
import type { SlashbotKernel } from '../kernel/kernel.js';
import type { ToolCallContext, ToolResult } from '../kernel/contracts.js';
import type { ContextPipelineConfig } from '../agentic/context/types.js';
import { truncateToolResult } from '../agentic/context/tool-result-truncator.js';

/** Metadata for a tool, used in callback notifications. */
export interface ToolBridgeToolMeta {
  name: string;
  description: string;
}

/** Callbacks for observing tool execution lifecycle events. */
export interface ToolBridgeCallbacks {
  onToolStart?(toolId: string, args: Record<string, unknown>, meta?: ToolBridgeToolMeta): void;
  onToolEnd?(toolId: string, args: Record<string, unknown>, result: ToolResult, meta?: ToolBridgeToolMeta): void;
  onToolUserOutput?(toolId: string, content: string): void;
}

/**
 * Sanitize a tool ID for OpenAI-compatible APIs.
 * OpenAI requires function names to match ^[a-zA-Z0-9_-]+$ — no dots allowed.
 */
export function sanitizeToolName(id: string): string {
  return id.replace(/\./g, '_');
}

/**
 * Derives a human-readable display name for a tool.
 */
export function deriveToolDisplayName(id: string, title?: string): string {
  return title ?? id;
}

/**
 * Converts kernel ToolDefinition[] → VoltAgent Tool[] using createTool().
 * Only includes tools that have a Zod `parameters` schema.
 * Tool names are sanitized (dots → underscores) for OpenAI API compatibility.
 */
export function buildVoltAgentTools(
  kernel: SlashbotKernel,
  context: ToolCallContext,
  callbacks?: ToolBridgeCallbacks,
  contextConfig?: Pick<ContextPipelineConfig, 'contextLimit' | 'toolResultMaxContextShare' | 'toolResultHardMax' | 'toolResultMinKeep'>,
  toolFilter?: { allowlist?: string[]; denylist?: string[] },
): Tool<any, any>[] {
  const tools: Tool<any, any>[] = [];
  const allDefs = kernel.tools.list();

  for (const def of allDefs) {
    if (!def.parameters) continue;
    if (toolFilter?.allowlist && !toolFilter.allowlist.includes(def.id)) continue;
    if (toolFilter?.denylist && toolFilter.denylist.includes(def.id)) continue;

    const safeName = sanitizeToolName(def.id);
    const meta: ToolBridgeToolMeta = {
      name: deriveToolDisplayName(def.id, def.title),
      description: def.description,
    };

    tools.push(createTool({
      name: safeName,
      description: def.description,
      parameters: def.parameters,
      execute: async (args: Record<string, unknown>) => {
        callbacks?.onToolStart?.(def.id, args, meta);

        const result = await kernel.runTool(def.id, args as never, context);

        callbacks?.onToolEnd?.(def.id, args, result, meta);

        // Dual-track: send forUser content to user if present and not silent
        if (!result.silent && result.forUser != null) {
          const userContent = typeof result.forUser === 'string'
            ? result.forUser
            : JSON.stringify(result.forUser);
          callbacks?.onToolUserOutput?.(def.id, userContent);
        }

        if (!result.ok) {
          const errMsg = result.error?.message ?? 'Unknown tool error';
          const hint = result.error?.hint ? ` (hint: ${result.error.hint})` : '';
          const partial = result.output !== undefined && result.output !== null
            ? `\n\nTool output:\n${(typeof result.output === 'string' ? result.output : JSON.stringify(result.output)).slice(0, 4000)}`
            : '';
          return `ERROR [${result.error?.code ?? 'UNKNOWN'}]: ${errMsg}${hint}${partial}`;
        }

        // Dual-track: LLM sees forLlm when set, otherwise output
        const llmPayload = result.forLlm !== undefined ? result.forLlm : result.output;

        if (llmPayload === undefined || llmPayload === null) {
          return 'OK (no output)';
        }

        const raw = typeof llmPayload === 'string'
          ? llmPayload
          : JSON.stringify(llmPayload);

        return contextConfig ? truncateToolResult(raw, contextConfig) : raw;
      },
    }));
  }

  return tools;
}
