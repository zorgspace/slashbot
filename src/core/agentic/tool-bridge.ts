import { tool, type ToolSet } from 'ai';
import { appendFileSync } from 'node:fs';
import type { SlashbotKernel } from '../kernel/kernel.js';
import type { ToolCallContext, ToolResult } from '../kernel/contracts.js';
import type { ContextPipelineConfig } from './context/types.js';
import { truncateToolResult } from './context/tool-result-truncator.js';

function debugLog(msg: string): void {
  try { appendFileSync('/tmp/slashbot-debug.log', `[tool-bridge ${new Date().toISOString()}] ${msg}\n`); } catch {}
}

export interface ToolBridgeToolMeta {
  name: string;
  description: string;
}

export interface ToolBridgeCallbacks {
  onToolStart?(toolId: string, args: Record<string, unknown>, meta?: ToolBridgeToolMeta): void;
  onToolEnd?(toolId: string, args: Record<string, unknown>, result: ToolResult, meta?: ToolBridgeToolMeta): void;
  onToolUserOutput?(toolId: string, content: string): void;
}

/**
 * Sanitize a tool ID for OpenAI-compatible APIs.
 * OpenAI requires function names to match ^[a-zA-Z0-9_-]+$ — no dots allowed.
 */
function sanitizeToolName(id: string): string {
  return id.replace(/\./g, '_');
}

function deriveToolDisplayName(id: string, title?: string): string {
  return title ?? id;
}

/**
 * Converts kernel ToolDefinition[] → AI SDK ToolSet.
 * Only includes tools that have a Zod `parameters` schema.
 * Tool names are sanitized (dots → underscores) for OpenAI API compatibility.
 */
export function buildToolSet(
  kernel: SlashbotKernel,
  context: ToolCallContext,
  callbacks?: ToolBridgeCallbacks,
  contextConfig?: Pick<ContextPipelineConfig, 'contextLimit' | 'toolResultMaxContextShare' | 'toolResultHardMax' | 'toolResultMinKeep'>,
  toolAllowlist?: string[],
): ToolSet {
  const tools: ToolSet = {};
  const allDefs = kernel.tools.list();
  const skippedNoParams: string[] = [];

  for (const def of allDefs) {
    if (!def.parameters) { skippedNoParams.push(def.id); continue; }
    if (toolAllowlist && !toolAllowlist.includes(def.id)) continue;

    const safeName = sanitizeToolName(def.id);
    const meta: ToolBridgeToolMeta = {
      name: deriveToolDisplayName(def.id, def.title),
      description: def.description,
    };

    tools[safeName] = tool({
      description: def.description,
      inputSchema: def.parameters,
      execute: async (args: Record<string, unknown>) => {
        const argsRecord = args as Record<string, unknown>;
        callbacks?.onToolStart?.(def.id, argsRecord, meta);

        const result = await kernel.runTool(def.id, argsRecord as never, context);

        callbacks?.onToolEnd?.(def.id, argsRecord, result, meta);

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
          // Preserve output when present so the LLM has context to decide next steps
          const partial = result.output !== undefined && result.output !== null
            ? `\n\nTool output:\n${(typeof result.output === 'string' ? result.output : JSON.stringify(result.output)).slice(0, 4000)}`
            : '';
          return `ERROR [${result.error?.code ?? 'UNKNOWN'}]: ${errMsg}${hint}${partial}`;
        }

        // Dual-track: LLM sees forLlm when set, otherwise output
        const llmPayload = result.forLlm !== undefined ? result.forLlm : result.output;

        if (llmPayload === undefined || llmPayload === null) {
          debugLog(`execute toolId=${def.id} → OK (no output)`);
          return 'OK (no output)';
        }

        const raw = typeof llmPayload === 'string'
          ? llmPayload
          : JSON.stringify(llmPayload);

        const final = contextConfig ? truncateToolResult(raw, contextConfig) : raw;
        debugLog(`execute toolId=${def.id} → len=${final.length} preview=${JSON.stringify(final.slice(0, 200))}`);
        return final;
      },
    });
  }

  const builtNames = Object.keys(tools);
  debugLog(`buildToolSet: ${builtNames.length} tools built [${builtNames.join(', ')}], ${skippedNoParams.length} skipped (no params) [${skippedNoParams.join(', ')}], session=${context.sessionId}`);

  return tools;
}
