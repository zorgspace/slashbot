/**
 * Tool Registry - Bridges AI SDK native tool calling with Slashbot's action system.
 * Collects ToolContributions from plugins, builds AI SDK tools map,
 * and maps tool call results back to Action objects.
 */

import type { Tool } from 'ai';
import type { ToolContribution } from '../../plugins/types';
import type { Action } from '../actions/types';

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
   * Build the AI SDK `tools` parameter for generateText().
   * Returns a record of tool definitions keyed by tool name.
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
   * Get the number of registered tools
   */
  get size(): number {
    return this.contributions.size;
  }
}
