import type { MCPToolInfo } from './types';
import { sanitizeToolName } from './parser';

/**
 * Generate MCP tool documentation for the system prompt
 */
export function buildMCPPrompt(tools: MCPToolInfo[]): string {
  if (tools.length === 0) return '';

  const lines: string[] = ['External tools are available via MCP (Model Context Protocol):', ''];

  // Group by server
  const byServer = new Map<string, MCPToolInfo[]>();
  for (const tool of tools) {
    const serverTools = byServer.get(tool.serverName) || [];
    serverTools.push(tool);
    byServer.set(tool.serverName, serverTools);
  }

  for (const [server, serverTools] of byServer) {
    lines.push(`## ${server}`);
    for (const tool of serverTools) {
      const tag = `mcp-${sanitizeToolName(tool.name)}`;
      lines.push(`- \`<${tag}>{json args}</${tag}>\` — ${tool.description}`);
      if (tool.inputSchema?.properties) {
        const props = Object.entries(tool.inputSchema.properties)
          .map(([k, v]: [string, any]) => `${k}: ${v.type || 'any'}`)
          .join(', ');
        lines.push(`  Args: {${props}}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
