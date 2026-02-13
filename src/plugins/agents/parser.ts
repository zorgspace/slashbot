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
            systemPrompt:
              extractAttr(fullTag, 'systemPrompt') || extractAttr(fullTag, 'prompt') || undefined,
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
            systemPrompt:
              extractAttr(fullTag, 'systemPrompt') || extractAttr(fullTag, 'prompt') || undefined,
            enabled: enabledRaw === 'true' ? true : enabledRaw === 'false' ? false : undefined,
            autoPoll: autoPollRaw === 'true' ? true : autoPollRaw === 'false' ? false : undefined,
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
      tags: ['agent-tasks', 'agents-tasks', 'agent_tasks', 'agents_tasks'],
      selfClosingTags: ['agent-tasks', 'agents-tasks', 'agent_tasks', 'agents_tasks'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<agents?[-_]tasks(?:\s+[^>]*)?\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const limitRaw = extractAttr(fullTag, 'limit');
          const parsedLimit =
            typeof limitRaw === 'string' && limitRaw.trim() ? Number(limitRaw) : undefined;
          const status = extractAttr(fullTag, 'status') || undefined;
          actions.push({
            type: 'agent-tasks',
            agent: extractAttr(fullTag, 'agent') || undefined,
            limit:
              parsedLimit !== undefined && Number.isFinite(parsedLimit)
                ? Math.max(1, Math.floor(parsedLimit))
                : undefined,
            status,
          });
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
    {
      tags: ['agent-verify', 'agents-verify', 'agent_verify', 'agents_verify'],
      selfClosingTags: ['agent-verify', 'agents-verify', 'agent_verify', 'agents_verify'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<agents?[-_]verify\s+[^>]*\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const taskId = extractAttr(fullTag, 'task') || extractAttr(fullTag, 'taskId');
          const rawStatus = (extractAttr(fullTag, 'status') || '').toLowerCase();
          const status =
            rawStatus === 'changes_requested' || rawStatus === 'changes'
              ? 'changes_requested'
              : rawStatus === 'verified' || rawStatus === 'approved' || rawStatus === 'pass'
                ? 'verified'
                : undefined;
          if (!taskId || !status) continue;
          actions.push({
            type: 'agent-verify',
            taskId,
            status,
            notes: extractAttr(fullTag, 'notes') || undefined,
          });
        }
        return actions;
      },
    },
    {
      tags: ['agent-recall', 'agents-recall', 'agent_recall', 'agents_recall'],
      selfClosingTags: ['agent-recall', 'agents-recall', 'agent_recall', 'agents_recall'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<agents?[-_]recall\s+[^>]*\/?>/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const taskId = extractAttr(fullTag, 'task') || extractAttr(fullTag, 'taskId');
          const reason = extractAttr(fullTag, 'reason') || '';
          if (!taskId || !reason.trim()) continue;
          actions.push({
            type: 'agent-recall',
            taskId,
            reason: reason.trim(),
            title: extractAttr(fullTag, 'title') || undefined,
          });
        }
        return actions;
      },
    },
  ];
}
