import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getDiscordParserConfigs(): ActionParserConfig[] {
  return [
    {
      tags: ['discord-config'],
      selfClosingTags: ['discord-config'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<discord-config\s+[^>]*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const botToken = extractAttr(fullTag, 'bot_token') || extractAttr(fullTag, 'token');
          const channelId = extractAttr(fullTag, 'channel_id');
          if (botToken && channelId) {
            actions.push({
              type: 'discord-config',
              botToken,
              channelId,
            });
          }
        }
        return actions;
      },
    },
  ];
}
