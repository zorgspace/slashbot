import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getGitParserConfigs(): ActionParserConfig[] {
  return [
    {
      tags: ['git-status', 'git_status'],
      selfClosingTags: ['git-status', 'git_status'],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<git-status\s*\/?>/gi;
        if (regex.test(content)) {
          actions.push({ type: 'git-status' } as Action);
        }
        return actions;
      },
    },
    {
      tags: ['git-diff', 'git_diff'],
      selfClosingTags: ['git-diff', 'git_diff'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<git-diff\s*[^>]*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const ref = extractAttr(fullTag, 'ref');
          const staged = extractAttr(fullTag, 'staged');
          actions.push({
            type: 'git-diff',
            ref: ref || undefined,
            staged: staged === 'true' || undefined,
          } as Action);
        }
        return actions;
      },
    },
    {
      tags: ['git-log', 'git_log'],
      selfClosingTags: ['git-log', 'git_log'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<git-log\s*[^>]*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const count = extractAttr(fullTag, 'count');
          actions.push({
            type: 'git-log',
            count: count ? parseInt(count, 10) : undefined,
          } as Action);
        }
        return actions;
      },
    },
    {
      tags: ['git-commit', 'git_commit'],
      preStrip: true,
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        // Self-closing with message attribute
        const selfClosingRegex = /<git-commit\s+[^>]*\/>/gi;
        let match;
        while ((match = selfClosingRegex.exec(content)) !== null) {
          const fullTag = match[0];
          const message = extractAttr(fullTag, 'message');
          const files = extractAttr(fullTag, 'files');
          if (message) {
            actions.push({
              type: 'git-commit',
              message,
              files: files ? files.split(',').map(f => f.trim()) : undefined,
            } as Action);
          }
        }
        // Block form: <git-commit files="...">message</git-commit>
        const blockRegex = /<git-commit\s*([^>]*)>([\s\S]*?)<\/git-commit>/gi;
        while ((match = blockRegex.exec(content)) !== null) {
          const attrs = match[1];
          const message = match[2].trim();
          const filesMatch = attrs.match(/files=["']([^"']+)["']/);
          const files = filesMatch ? filesMatch[1].split(',').map(f => f.trim()) : undefined;
          if (message) {
            actions.push({ type: 'git-commit', message, files } as Action);
          }
        }
        return actions;
      },
    },
  ];
}
