import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
}

/**
 * Create parser configs for MCP tools dynamically.
 * Each MCP tool gets registered as an <mcp-toolname> tag.
 */
export function createMCPParserConfig(toolName: string, serverName: string): ActionParserConfig {
  const tagName = `mcp-${sanitizeToolName(toolName)}`;
  return {
    tags: [tagName],
    preStrip: true,
    parse(content): Action[] {
      const actions: Action[] = [];
      // Block form: <mcp-toolname>{json args}</mcp-toolname>
      const blockRegex = new RegExp(`<${tagName}\\s*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
      let match;
      while ((match = blockRegex.exec(content)) !== null) {
        let args: any = {};
        try {
          args = JSON.parse(match[1].trim());
        } catch {
          // If not valid JSON, pass as a string arg
          args = { input: match[1].trim() };
        }
        actions.push({
          type: 'mcp-tool',
          toolName,
          serverName,
          args,
        } as Action);
      }
      // Self-closing form: <mcp-toolname args='{"key":"val"}' />
      const selfClosingRegex = new RegExp(`<${tagName}\\s+([^>]*)\\/>`, 'gi');
      while ((match = selfClosingRegex.exec(content)) !== null) {
        const argsMatch = match[1].match(/args=["']([^"']+)["']/);
        let args: any = {};
        if (argsMatch) {
          try {
            args = JSON.parse(argsMatch[1]);
          } catch {
            args = { input: argsMatch[1] };
          }
        }
        actions.push({
          type: 'mcp-tool',
          toolName,
          serverName,
          args,
        } as Action);
      }
      return actions;
    },
  };
}
