import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getBashParserConfigs(): ActionParserConfig[] {
  return [
    {
      tags: ['bash'],
      selfClosingTags: [],
      parse(content, { extractAttr, extractBoolAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<bash(?:\s+[^>]*)?\s*>([\s\S]+?)<\/bash>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const command = match[1].trim();
          const timeout = extractAttr(fullTag, 'timeout');
          const description = extractAttr(fullTag, 'description');
          const runInBackground = extractBoolAttr(fullTag, 'background');
          actions.push({
            type: 'bash',
            command,
            timeout: timeout ? parseInt(timeout, 10) : undefined,
            description: description || undefined,
            runInBackground: runInBackground || undefined,
          } as Action);
        }
        return actions;
      },
    },
    {
      tags: ['exec'],
      selfClosingTags: [],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<exec\s*>([\s\S]+?)<\/exec>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const command = match[1].trim();
          actions.push({
            type: 'exec',
            command,
          } as Action);
        }
        return actions;
      },
    },
  ];
}
