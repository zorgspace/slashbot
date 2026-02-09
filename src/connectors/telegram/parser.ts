import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getTelegramParserConfigs(): ActionParserConfig[] {
  return [
    {
      tags: ['telegram-config'],
      selfClosingTags: ['telegram-config'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<telegram-config\s+[^>]*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const botToken = extractAttr(fullTag, 'bot_token') || extractAttr(fullTag, 'token');
          const chatId = extractAttr(fullTag, 'chat_id');
          if (botToken) {
            actions.push({
              type: 'telegram-config',
              botToken,
              chatId: chatId || undefined,
            });
          }
        }
        return actions;
      },
    },
  ];
}
