import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getAgentsParserConfigs(): ActionParserConfig[] {
  return [
    {
      tags: ['agent-create', 'agents-create', 'agent_create', 'agents_create'],
      selfClosingTags: ['agent-create', 'agents-create', 'agent_create', 'agents_create'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<agents?[-_]create\s+[^>]*\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const name = extractAttr(fullTag, 'name');
          if (!name) continue;
          actions.push({
            type: 'agent-create',
            name,
            responsibility: extractAttr(fullTag, 'responsibility') || undefined,
            systemPrompt: extractAttr(fullTag, 'prompt') || undefined,
            autoPoll:
              extractAttr(fullTag, 'autopoll') === 'true'
                ? true
                : extractAttr(fullTag, 'autopoll') === 'false'
                  ? false
                  : undefined,
            removable: extractAttr(fullTag, 'removable') === 'true',
          });
        }
        return actions;
      },
    },
    {
      tags: ['agent-update', 'agents-update', 'agent_update', 'agents_update'],
      selfClosingTags: ['agent-update', 'agents-update', 'agent_update', 'agents_update'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<agents?[-_]update\s+[^>]*\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const agent = extractAttr(fullTag, 'agent') || extractAttr(fullTag, 'id');
          if (!agent) continue;
          const enabledRaw = extractAttr(fullTag, 'enabled');
          const autoPollRaw = extractAttr(fullTag, 'autopoll');
          actions.push({
            type: 'agent-update',
            agent,
            name: extractAttr(fullTag, 'name') || undefined,
            responsibility: extractAttr(fullTag, 'responsibility') || undefined,
            systemPrompt: extractAttr(fullTag, 'prompt') || undefined,
            enabled:
              enabledRaw === 'true' ? true : enabledRaw === 'false' ? false : undefined,
            autoPoll:
              autoPollRaw === 'true' ? true : autoPollRaw === 'false' ? false : undefined,
          });
        }
        return actions;
      },
    },
    {
      tags: ['agent-delete', 'agents-delete', 'agent_delete', 'agents_delete'],
      selfClosingTags: ['agent-delete', 'agents-delete', 'agent_delete', 'agents_delete'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<agents?[-_]delete\s+[^>]*\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const agent = extractAttr(fullTag, 'agent') || extractAttr(fullTag, 'id');
          if (!agent) continue;
          actions.push({ type: 'agent-delete', agent });
        }
        return actions;
      },
    },
    {
      tags: ['agent-list', 'agents-list', 'agent_list', 'agents_list'],
      selfClosingTags: ['agent-list', 'agents-list', 'agent_list', 'agents_list'],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<agents?[-_]list\s*\/?>/gi;
        while (regex.exec(content) !== null) {
          actions.push({ type: 'agent-list' });
        }
        return actions;
      },
    },
    {
      tags: ['agent-status', 'agents-status', 'agent_status', 'agents_status'],
      selfClosingTags: ['agent-status', 'agents-status', 'agent_status', 'agents_status'],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<agents?[-_]status\s*\/?>/gi;
        while (regex.exec(content) !== null) {
          actions.push({ type: 'agent-status' });
        }
        return actions;
      },
    },
    {
      tags: ['agent-run', 'agents-run', 'agent_run', 'agents_run'],
      selfClosingTags: ['agent-run', 'agents-run', 'agent_run', 'agents_run'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<agents?[-_]run\s+[^>]*\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const agent = extractAttr(fullTag, 'agent') || extractAttr(fullTag, 'id');
          if (!agent) continue;
          actions.push({ type: 'agent-run', agent });
        }
        return actions;
      },
    },
    {
      tags: ['agent-send', 'agents-send', 'agent_send', 'agents_send'],
      selfClosingTags: ['agent-send', 'agents-send', 'agent_send', 'agents_send'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<agents?[-_]send\s+[^>]*\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const to = extractAttr(fullTag, 'to') || extractAttr(fullTag, 'agent');
          const title = extractAttr(fullTag, 'title') || 'Status Update';
          const contentText = extractAttr(fullTag, 'content') || '';
          if (!to) continue;
          actions.push({
            type: 'agent-send',
            to,
            title,
            content: contentText,
          });
        }
        return actions;
      },
    },
  ];
}
