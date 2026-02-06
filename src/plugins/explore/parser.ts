import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';
import type { ExploreAction } from './types';

export function getExploreParserConfigs(): ActionParserConfig[] {
  return [
    {
      tags: ['explore'],
      selfClosingTags: ['explore'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<explore\s+[^>]*\/?>/gi;
        let match = regex.exec(content);
        while (match) {
          const fullTag = match[0];
          const query = extractAttr(fullTag, 'query');
          const path = extractAttr(fullTag, 'path');
          const depth = extractAttr(fullTag, 'depth');
          if (query) {
            const action: ExploreAction = {
              type: 'explore',
              query,
            };
            if (path) action.path = path;
            if (depth && ['quick', 'medium', 'deep', 'comprehensive'].includes(depth)) {
              action.depth = depth as ExploreAction['depth'];
            }
            actions.push(action as unknown as Action);
          }
          match = regex.exec(content);
        }
        return actions;
      },
    },
  ];
}
