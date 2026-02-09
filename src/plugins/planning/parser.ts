/**
 * Planning Plugin Parser — <plan-ready> tag
 */

import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getPlanningParserConfigs(): ActionParserConfig[] {
  return [
    {
      tags: ['plan-ready'],
      selfClosingTags: ['plan-ready'],
      preStrip: true,
      stripAfterParse: ['plan-ready'],
      parse(content, utils): Action[] {
        const actions: Action[] = [];

        // Self-closing: <plan-ready path="..."/>
        const selfClosingRegex = /<plan-ready\s+([^>]*?)\/>/gi;
        let match;
        while ((match = selfClosingRegex.exec(content)) !== null) {
          const path = utils.extractAttr(match[0], 'path');
          if (path) {
            actions.push({ type: 'plan-ready', path } as Action);
          }
        }

        // Block form: <plan-ready path="...">...</plan-ready>
        const blockRegex = /<plan-ready\s+([^>]*)>([\s\S]*?)<\/plan-ready>/gi;
        while ((match = blockRegex.exec(content)) !== null) {
          const path = utils.extractAttr(match[0], 'path');
          if (path) {
            actions.push({ type: 'plan-ready', path } as Action);
          }
        }

        return actions;
      },
    },
  ];
}
