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
          const ownerId = extractAttr(fullTag, 'owner_id');
          const channelIds = (extractAttr(fullTag, 'channel_ids') || '')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean);
          if (botToken && channelId) {
            actions.push({
              type: 'discord-config',
              botToken,
              channelId,
              ...(channelIds.length > 0 ? { channelIds } : {}),
              ...(ownerId ? { ownerId } : {}),
            });
          }
        }
        return actions;
      },
    },
    {
      tags: ['discord-status'],
      selfClosingTags: ['discord-status'],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<discord-status\s*\/?>/gi;
        while (regex.exec(content) !== null) {
          actions.push({ type: 'discord-status' });
        }
        return actions;
      },
    },
    {
      tags: ['discord-add'],
      selfClosingTags: ['discord-add'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<discord-add\s+[^>]*\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const channelId = extractAttr(fullTag, 'channel_id') || extractAttr(fullTag, 'channel');
          if (!channelId) continue;
          actions.push({ type: 'discord-add', channelId });
        }
        return actions;
      },
    },
    {
      tags: ['discord-remove'],
      selfClosingTags: ['discord-remove'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<discord-remove\s+[^>]*\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const channelId = extractAttr(fullTag, 'channel_id') || extractAttr(fullTag, 'channel');
          if (!channelId) continue;
          actions.push({ type: 'discord-remove', channelId });
        }
        return actions;
      },
    },
    {
      tags: ['discord-primary'],
      selfClosingTags: ['discord-primary'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<discord-primary\s+[^>]*\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const channelId = extractAttr(fullTag, 'channel_id') || extractAttr(fullTag, 'channel');
          if (!channelId) continue;
          actions.push({ type: 'discord-primary', channelId });
        }
        return actions;
      },
    },
    {
      tags: ['discord-owner'],
      selfClosingTags: ['discord-owner'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<discord-owner\s+[^>]*\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const ownerId = extractAttr(fullTag, 'owner_id') || extractAttr(fullTag, 'user_id');
          if (!ownerId) continue;
          actions.push({ type: 'discord-owner', ownerId });
        }
        return actions;
      },
    },
    {
      tags: ['discord-owner-clear'],
      selfClosingTags: ['discord-owner-clear'],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<discord-owner-clear\s*\/?>/gi;
        while (regex.exec(content) !== null) {
          actions.push({ type: 'discord-owner-clear' });
        }
        return actions;
      },
    },
    {
      tags: ['discord-clear'],
      selfClosingTags: ['discord-clear'],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<discord-clear\s*\/?>/gi;
        while (regex.exec(content) !== null) {
          actions.push({ type: 'discord-clear' });
        }
        return actions;
      },
    },
    {
      tags: ['discord-send'],
      selfClosingTags: [],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<discord-send\s*([^>]*)>([\s\S]*?)<\/discord-send>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const message = match[2]?.trim() || '';
          if (!message) continue;
          const channelId = extractAttr(fullTag, 'channel_id') || extractAttr(fullTag, 'channel');
          actions.push({
            type: 'discord-send',
            message,
            channelId: channelId || undefined,
          });
        }
        return actions;
      },
    },
  ];
}
