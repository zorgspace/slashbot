import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type { MCPToolAction } from './types';
import type { MCPManager } from './manager';
import { display, formatToolAction } from '../../core/ui';

let mcpManager: MCPManager | null = null;

export function setMCPManager(manager: MCPManager): void {
  mcpManager = manager;
}

export async function executeMCPTool(
  action: MCPToolAction,
  _handlers: ActionHandlers,
): Promise<ActionResult | null> {
  if (!mcpManager) {
    return {
      action: `MCP: ${action.toolName}`,
      success: false,
      result: 'MCP not initialized',
      error: 'MCP manager not available',
    };
  }

  const { toolName, serverName, args } = action;
  const detail = `${serverName}/${toolName}`;

  try {
    const result = await mcpManager.callTool(serverName, toolName, args);

    let output = '';
    if (result.content) {
      for (const item of result.content as any[]) {
        if (item.type === 'text') {
          output += item.text + '\n';
        } else if (item.type === 'image') {
          output += `[Image: ${item.mimeType}, ${item.data?.length ?? 0} bytes]\n`;
        } else if (item.type === 'audio') {
          output += `[Audio: ${item.mimeType}, ${item.data?.length ?? 0} bytes]\n`;
        } else if (item.type === 'resource') {
          if (item.resource?.text) output += item.resource.text + '\n';
          else if (item.resource?.blob)
            output += `[Resource: ${item.resource.uri}, ${item.resource.mimeType}]\n`;
        } else if (item.type === 'resource_link') {
          output += `[Resource: ${item.name} - ${item.uri}]\n`;
        }
      }
    }
    output = output.trim() || JSON.stringify(result);

    if ((result as any).isError) {
      display.appendAssistantMessage(
        formatToolAction('MCP', detail, { success: false, summary: output.slice(0, 80) }),
      );
      return {
        action: `MCP: ${toolName}`,
        success: false,
        result: output,
        error: output || 'Tool error',
      };
    }

    // Truncate long results
    const truncated = output.length > 5000 ? output.slice(0, 5000) + '\n... (truncated)' : output;

    display.appendAssistantMessage(
      formatToolAction('MCP', detail, { success: true, summary: `${output.length} chars` }),
    );
    return {
      action: `MCP: ${toolName}`,
      success: true,
      result: truncated,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.appendAssistantMessage(
      formatToolAction('MCP', detail, { success: false, summary: errorMsg }),
    );
    return {
      action: `MCP: ${toolName}`,
      success: false,
      result: 'Failed',
      error: errorMsg,
    };
  }
}
