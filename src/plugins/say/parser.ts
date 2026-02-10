import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getSayParserConfigs(): ActionParserConfig[] {
  return [
    // Say action (pre-strip to preserve message content)
    {
      tags: ['say', 'say_message'],
      preStrip: true,
      stripAfterParse: ['say', 'say_message'],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<(?:say|say_message)\s*>([\s\S]+?)<\/(?:say|say_message)>/gi;
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
    // End action (pre-strip) — signals task completion with a final message
    {
      tags: ['end', 'end_task'],
      preStrip: true,
      stripAfterParse: ['end', 'end_task'],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<(?:end|end_task)\s*>([\s\S]+?)<\/(?:end|end_task)>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const message = match[1].trim();
          if (message) {
            actions.push({
              type: 'end',
              message,
            } as Action);
          }
        }
        return actions;
      },
    },
    // Continue action (pre-strip)
    {
      tags: ['continue', 'continue_task'],
      preStrip: true,
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<(?:continue|continue_task)\s*\/?>/gi;
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
