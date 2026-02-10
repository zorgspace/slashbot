import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getSubagentParserConfigs(): ActionParserConfig[] {
  return [
    {
      tags: ['task'],
      preStrip: true,
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<task\s+([^>]*)>([\s\S]*?)<\/task>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const attrs = match[1];
          const prompt = match[2].trim();
          const agentTypeMatch = attrs.match(/type=["']([^"']+)["']/);
          const taskIdMatch = attrs.match(/id=["']([^"']+)["']/);
          const agentType = agentTypeMatch ? agentTypeMatch[1] : 'explore';

          if (prompt) {
            actions.push({
              type: 'task',
              prompt,
              agentType: agentType as 'explore' | 'general',
              taskId: taskIdMatch ? taskIdMatch[1] : undefined,
            } as Action);
          }
        }

        // Also support self-closing with prompt attribute
        const selfClosingRegex = /<task\s+[^>]*\/>/gi;
        while ((match = selfClosingRegex.exec(content)) !== null) {
          const fullTag = match[0];
          const prompt = extractAttr(fullTag, 'prompt');
          const agentType = extractAttr(fullTag, 'type') || 'explore';
          const taskId = extractAttr(fullTag, 'id');

          if (prompt) {
            actions.push({
              type: 'task',
              prompt,
              agentType: agentType as 'explore' | 'general',
              taskId: taskId || undefined,
            } as Action);
          }
        }
        return actions;
      },
    },
  ];
}
