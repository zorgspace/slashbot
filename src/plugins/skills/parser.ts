import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getSkillsParserConfigs(): ActionParserConfig[] {
  return [
    // Skill action
    {
      tags: ['skill'],
      selfClosingTags: ['skill'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<skill\s+[^>]*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const name = extractAttr(fullTag, 'name');
          const args = extractAttr(fullTag, 'args');
          if (name) {
            actions.push({
              type: 'skill',
              name,
              args: args || undefined,
            } as Action);
          }
        }
        return actions;
      },
    },
    // Skill-install action
    {
      tags: ['skill-install'],
      selfClosingTags: ['skill-install'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<skill-install\s+[^>]*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const url = extractAttr(fullTag, 'url');
          const name = extractAttr(fullTag, 'name');
          if (url) {
            actions.push({
              type: 'skill-install',
              url,
              name: name || undefined,
            } as Action);
          }
        }
        return actions;
      },
    },
  ];
}
