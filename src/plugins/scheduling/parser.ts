import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';
import type { ScheduleAction, NotifyAction } from './types';

export function getSchedulingParserConfigs(): ActionParserConfig[] {
  return [
    // Schedule action
    {
      tags: ['schedule'],
      selfClosingTags: [],
      parse(content, { extractAttr, extractBoolAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<schedule\s+[^>]*>([\s\S]+?)<\/schedule>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const body = match[1].trim();
          const cron = extractAttr(fullTag, 'cron');
          const name = extractAttr(fullTag, 'name');
          const typeAttr = extractAttr(fullTag, 'type');

          const isPromptTask =
            typeAttr === 'prompt' || typeAttr === 'llm' || extractBoolAttr(fullTag, 'prompt');

          if (cron) {
            actions.push({
              type: 'schedule',
              cron,
              name: name || 'Scheduled Task',
              command: isPromptTask ? undefined : body,
              prompt: isPromptTask ? body : undefined,
            } as Action);
          }
        }
        return actions;
      },
    },
    // Notify action
    {
      tags: ['notify'],
      selfClosingTags: [],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<notify(?:\s+to=["']([^"']+)["'])?\s*>([\s\S]+?)<\/notify>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const [, target, message] = match;
          actions.push({
            type: 'notify',
            message: message.trim(),
            target: target || undefined,
          } as Action);
        }
        return actions;
      },
    },
  ];
}
