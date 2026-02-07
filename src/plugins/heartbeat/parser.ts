import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getHeartbeatParserConfigs(): ActionParserConfig[] {
  return [
    // Heartbeat action
    {
      tags: ['heartbeat'],
      selfClosingTags: ['heartbeat'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<heartbeat(?:\s+[^>]*)?\s*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const prompt = extractAttr(fullTag, 'prompt');
          actions.push({
            type: 'heartbeat',
            prompt: prompt || undefined,
          } as Action);
        }
        return actions;
      },
    },
    // Heartbeat-update action
    {
      tags: ['heartbeat-update'],
      selfClosingTags: [],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<heartbeat-update\s*>([\s\S]+?)<\/heartbeat-update>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const body = match[1].trim();
          if (body) {
            actions.push({
              type: 'heartbeat-update',
              content: body,
            } as Action);
          }
        }
        return actions;
      },
    },
  ];
}
