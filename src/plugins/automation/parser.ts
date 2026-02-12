import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

function extractSelector(tag: string, extractAttr: (tag: string, attr: string) => string | undefined): string {
  return (
    extractAttr(tag, 'selector') ||
    extractAttr(tag, 'id') ||
    extractAttr(tag, 'name') ||
    ''
  ).trim();
}

function parseStatusActions(content: string): Action[] {
  const actions: Action[] = [];
  const regex = /<automation-status\s*[^>]*\/?>/gi;
  while (regex.exec(content) !== null) {
    actions.push({ type: 'automation-status' } as Action);
  }
  return actions;
}

function parseListActions(content: string): Action[] {
  const actions: Action[] = [];
  const regex = /<automation-list\s*[^>]*\/?>/gi;
  while (regex.exec(content) !== null) {
    actions.push({ type: 'automation-list' } as Action);
  }
  return actions;
}

function parseAddCronActions(
  content: string,
  extractAttr: (tag: string, attr: string) => string | undefined,
): Action[] {
  const actions: Action[] = [];

  const selfRegex = /<automation-add-cron\s+[^>]*\/>/gi;
  let selfMatch;
  while ((selfMatch = selfRegex.exec(content)) !== null) {
    const tag = selfMatch[0];
    const name = (extractAttr(tag, 'name') || '').trim();
    const expression = (extractAttr(tag, 'expression') || extractAttr(tag, 'cron') || '').trim();
    const prompt = (extractAttr(tag, 'prompt') || '').trim();
    if (!name || !expression || !prompt) continue;

    actions.push({
      type: 'automation-add-cron',
      name,
      expression,
      prompt,
      source: extractAttr(tag, 'source') || undefined,
      targetId:
        extractAttr(tag, 'target_id') || extractAttr(tag, 'targetId') || extractAttr(tag, 'target'),
    } as Action);
  }

  const pairedRegex = /<automation-add-cron\s+[^>]*>([\s\S]*?)<\/automation-add-cron>/gi;
  let pairedMatch;
  while ((pairedMatch = pairedRegex.exec(content)) !== null) {
    const full = pairedMatch[0];
    const openTag = full.match(/^<automation-add-cron\s+[^>]*>/i)?.[0] || full;
    const name = (extractAttr(openTag, 'name') || '').trim();
    const expression =
      (extractAttr(openTag, 'expression') || extractAttr(openTag, 'cron') || '').trim();
    const prompt = pairedMatch[1].trim() || (extractAttr(openTag, 'prompt') || '').trim();
    if (!name || !expression || !prompt) continue;

    actions.push({
      type: 'automation-add-cron',
      name,
      expression,
      prompt,
      source: extractAttr(openTag, 'source') || undefined,
      targetId:
        extractAttr(openTag, 'target_id') ||
        extractAttr(openTag, 'targetId') ||
        extractAttr(openTag, 'target'),
    } as Action);
  }

  return actions;
}

function parseAddWebhookActions(
  content: string,
  extractAttr: (tag: string, attr: string) => string | undefined,
): Action[] {
  const actions: Action[] = [];

  const selfRegex = /<automation-add-webhook\s+[^>]*\/>/gi;
  let selfMatch;
  while ((selfMatch = selfRegex.exec(content)) !== null) {
    const tag = selfMatch[0];
    const name = (extractAttr(tag, 'name') || '').trim();
    const webhookName = (
      extractAttr(tag, 'webhook') ||
      extractAttr(tag, 'webhook_name') ||
      extractAttr(tag, 'trigger') ||
      ''
    ).trim();
    const prompt = (extractAttr(tag, 'prompt') || '').trim();
    if (!name || !webhookName || !prompt) continue;

    actions.push({
      type: 'automation-add-webhook',
      name,
      webhookName,
      prompt,
      secret: extractAttr(tag, 'secret') || undefined,
      source: extractAttr(tag, 'source') || undefined,
      targetId:
        extractAttr(tag, 'target_id') || extractAttr(tag, 'targetId') || extractAttr(tag, 'target'),
    } as Action);
  }

  const pairedRegex = /<automation-add-webhook\s+[^>]*>([\s\S]*?)<\/automation-add-webhook>/gi;
  let pairedMatch;
  while ((pairedMatch = pairedRegex.exec(content)) !== null) {
    const full = pairedMatch[0];
    const openTag = full.match(/^<automation-add-webhook\s+[^>]*>/i)?.[0] || full;
    const name = (extractAttr(openTag, 'name') || '').trim();
    const webhookName = (
      extractAttr(openTag, 'webhook') ||
      extractAttr(openTag, 'webhook_name') ||
      extractAttr(openTag, 'trigger') ||
      ''
    ).trim();
    const prompt = pairedMatch[1].trim() || (extractAttr(openTag, 'prompt') || '').trim();
    if (!name || !webhookName || !prompt) continue;

    actions.push({
      type: 'automation-add-webhook',
      name,
      webhookName,
      prompt,
      secret: extractAttr(openTag, 'secret') || undefined,
      source: extractAttr(openTag, 'source') || undefined,
      targetId:
        extractAttr(openTag, 'target_id') ||
        extractAttr(openTag, 'targetId') ||
        extractAttr(openTag, 'target'),
    } as Action);
  }

  return actions;
}

function parseRunActions(
  content: string,
  extractAttr: (tag: string, attr: string) => string | undefined,
): Action[] {
  const actions: Action[] = [];
  const regex = /<automation-run\s+[^>]*\/?>/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const selector = extractSelector(match[0], extractAttr);
    if (!selector) continue;
    actions.push({ type: 'automation-run', selector } as Action);
  }
  return actions;
}

function parseRemoveActions(
  content: string,
  extractAttr: (tag: string, attr: string) => string | undefined,
): Action[] {
  const actions: Action[] = [];
  const regex = /<automation-remove\s+[^>]*\/?>/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const selector = extractSelector(match[0], extractAttr);
    if (!selector) continue;
    actions.push({ type: 'automation-remove', selector } as Action);
  }
  return actions;
}

function parseSetEnabledActions(
  content: string,
  extractAttr: (tag: string, attr: string) => string | undefined,
  enabled: boolean,
): Action[] {
  const actions: Action[] = [];
  const tagName = enabled ? 'automation-enable' : 'automation-disable';
  const regex = new RegExp(`<${tagName}\\s+[^>]*\\/?>`, 'gi');
  let match;
  while ((match = regex.exec(content)) !== null) {
    const selector = extractSelector(match[0], extractAttr);
    if (!selector) continue;
    actions.push({ type: 'automation-set-enabled', selector, enabled } as Action);
  }
  return actions;
}

export function getAutomationParserConfigs(): ActionParserConfig[] {
  return [
    {
      tags: ['automation-status'],
      selfClosingTags: ['automation-status'],
      parse(content): Action[] {
        return parseStatusActions(content);
      },
    },
    {
      tags: ['automation-list'],
      selfClosingTags: ['automation-list'],
      parse(content): Action[] {
        return parseListActions(content);
      },
    },
    {
      tags: ['automation-add-cron'],
      preStrip: true,
      parse(content, { extractAttr }): Action[] {
        return parseAddCronActions(content, extractAttr);
      },
    },
    {
      tags: ['automation-add-webhook'],
      preStrip: true,
      parse(content, { extractAttr }): Action[] {
        return parseAddWebhookActions(content, extractAttr);
      },
    },
    {
      tags: ['automation-run'],
      selfClosingTags: ['automation-run'],
      parse(content, { extractAttr }): Action[] {
        return parseRunActions(content, extractAttr);
      },
    },
    {
      tags: ['automation-remove'],
      selfClosingTags: ['automation-remove'],
      parse(content, { extractAttr }): Action[] {
        return parseRemoveActions(content, extractAttr);
      },
    },
    {
      tags: ['automation-enable'],
      selfClosingTags: ['automation-enable'],
      parse(content, { extractAttr }): Action[] {
        return parseSetEnabledActions(content, extractAttr, true);
      },
    },
    {
      tags: ['automation-disable'],
      selfClosingTags: ['automation-disable'],
      parse(content, { extractAttr }): Action[] {
        return parseSetEnabledActions(content, extractAttr, false);
      },
    },
  ];
}
