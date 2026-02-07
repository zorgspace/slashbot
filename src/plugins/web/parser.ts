import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getWebParserConfigs(): ActionParserConfig[] {
  return [
    // Fetch action
    {
      tags: ['fetch'],
      selfClosingTags: ['fetch'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<fetch\s+[^>]*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const url = extractAttr(fullTag, 'url');
          const prompt = extractAttr(fullTag, 'prompt');
          if (url) {
            actions.push({
              type: 'fetch',
              url,
              prompt: prompt || undefined,
            } as Action);
          }
        }
        return actions;
      },
    },
    // Search action
    {
      tags: ['search'],
      selfClosingTags: ['search'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<search\s+[^>]*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const query = extractAttr(fullTag, 'query');
          const allowedDomainsStr =
            extractAttr(fullTag, 'allowed_domains') || extractAttr(fullTag, 'domains');
          const blockedDomainsStr =
            extractAttr(fullTag, 'blocked_domains') || extractAttr(fullTag, 'exclude');
          if (query) {
            actions.push({
              type: 'search',
              query,
              allowedDomains: allowedDomainsStr
                ? allowedDomainsStr.split(',').map(s => s.trim())
                : undefined,
              blockedDomains: blockedDomainsStr
                ? blockedDomainsStr.split(',').map(s => s.trim())
                : undefined,
            } as Action);
          }
        }
        return actions;
      },
    },
  ];
}
