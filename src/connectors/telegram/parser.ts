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
    {
      tags: ['telegram-status'],
      selfClosingTags: ['telegram-status'],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<telegram-status\s*\/?>/gi;
        while (regex.exec(content) !== null) {
          actions.push({ type: 'telegram-status' });
        }
        return actions;
      },
    },
    {
      tags: ['telegram-add'],
      selfClosingTags: ['telegram-add'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<telegram-add\s+[^>]*\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const chatId = extractAttr(fullTag, 'chat_id') || extractAttr(fullTag, 'chat');
          if (!chatId) continue;
          actions.push({ type: 'telegram-add', chatId });
        }
        return actions;
      },
    },
    {
      tags: ['telegram-remove'],
      selfClosingTags: ['telegram-remove'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<telegram-remove\s+[^>]*\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const chatId = extractAttr(fullTag, 'chat_id') || extractAttr(fullTag, 'chat');
          if (!chatId) continue;
          actions.push({ type: 'telegram-remove', chatId });
        }
        return actions;
      },
    },
    {
      tags: ['telegram-primary'],
      selfClosingTags: ['telegram-primary'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<telegram-primary\s+[^>]*\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const chatId = extractAttr(fullTag, 'chat_id') || extractAttr(fullTag, 'chat');
          if (!chatId) continue;
          actions.push({ type: 'telegram-primary', chatId });
        }
        return actions;
      },
    },
    {
      tags: ['telegram-clear'],
      selfClosingTags: ['telegram-clear'],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<telegram-clear\s*\/?>/gi;
        while (regex.exec(content) !== null) {
          actions.push({ type: 'telegram-clear' });
        }
        return actions;
      },
    },
    {
      tags: ['telegram-send'],
      selfClosingTags: [],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<telegram-send\s*([^>]*)>([\s\S]*?)<\/telegram-send>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const message = match[2]?.trim() || '';
          if (!message) continue;
          const chatId = extractAttr(fullTag, 'chat_id') || extractAttr(fullTag, 'chat');
          actions.push({
            type: 'telegram-send',
            message,
            chatId: chatId || undefined,
          });
        }
        return actions;
      },
    },
  ];
}
