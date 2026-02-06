import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getSayParserConfigs(): ActionParserConfig[] {
  return [
    // Say action (pre-strip to preserve message content)
    {
      tags: ['say'],
      preStrip: true,
      stripAfterParse: ['say'],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<say\s*>([\s\S]+?)<\/say>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const message = match[1].trim();
          if (message) {
            actions.push({
              type: 'say',
              message,
            } as Action);
          }
        }
        return actions;
      },
    },
    // Continue action (pre-strip)
    {
      tags: ['continue'],
      preStrip: true,
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<continue\s*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          actions.push({
            type: 'continue',
          } as Action);
        }
        return actions;
      },
    },
  ];
}
