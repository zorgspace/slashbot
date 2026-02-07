import type { ActionParserConfig, ParserUtils } from '../../core/actions/parser';
import { extractAttr, extractBoolAttr } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

// Quote pattern: matches both single and double quotes
const Q = `["']`;
const NQR = `[^"']+`;

/** Decode HTML entities that LLM APIs may produce inside XML tag content */
function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * Parse search/replace blocks from edit content.
 * Format:
 *   <<<<<<< SEARCH
 *   exact lines to find
 *   =======
 *   replacement lines
 *   >>>>>>> REPLACE
 */
function parseSearchReplaceBlocks(content: string): { search: string; replace: string }[] {
  const blocks: { search: string; replace: string }[] = [];
  const regex = /<<<<<<< SEARCH[ \t]*\n([\s\S]*?)\n[ \t]*=======[ \t]*\n([\s\S]*?)\n[ \t]*>>>>>>> REPLACE[ \t]*/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    blocks.push({
      search: match[1],
      replace: match[2],
    });
  }

  return blocks;
}

/**
 * Detect whether edit content uses search/replace mode or full-file mode.
 */
function detectEditMode(content: string): 'full' | 'search-replace' {
  return content.includes('<<<<<<< SEARCH') ? 'search-replace' : 'full';
}

export function getFilesystemParserConfigs(): ActionParserConfig[] {
  return [
    // Read action (post-strip)
    {
      tags: ['read'],
      selfClosingTags: ['read'],
      protectedTags: ['edit'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<read\s+[^>]*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const path = extractAttr(fullTag, 'path');
          const offset = extractAttr(fullTag, 'offset');
          const limit = extractAttr(fullTag, 'limit');
          if (path) {
            actions.push({
              type: 'read',
              path,
              offset: offset ? parseInt(offset, 10) : undefined,
              limit: limit ? parseInt(limit, 10) : undefined,
            } as Action);
          }
        }
        return actions;
      },
    },
    // Edit action - full file or search/replace blocks
    // preStrip: content-bearing tag — parsed first, then stripped so inner tags
    // (e.g. <bash> inside edit content) are not executed as actions.
    {
      tags: ['edit'],
      preStrip: true,
      protectedTags: ['edit'],
      fixups(content: string): string {
        let result = content;

        // Fix variations of edit tag: <edit file="..."> -> <edit path="...">
        result = result.replace(/<edit\s+file\s*=/gi, '<edit path=');

        // Fix unquoted paths in edit: <edit path=src/file.ts> -> <edit path="src/file.ts">
        result = result.replace(/<edit\s+path\s*=\s*([^"'\s>][^\s>]*)/gi, '<edit path="$1"');

        return result;
      },
      parse(content): Action[] {
        const actions: Action[] = [];
        // Match outer <edit path="...">...</edit> wrapper
        const outerRegex = /<edit\s+path\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/edit>/gi;
        let outerMatch;

        while ((outerMatch = outerRegex.exec(content)) !== null) {
          const path = outerMatch[1];
          const innerContent = decodeEntities(outerMatch[2]);

          const mode = detectEditMode(innerContent);

          if (mode === 'search-replace') {
            const blocks = parseSearchReplaceBlocks(innerContent);
            if (blocks.length > 0) {
              actions.push({
                type: 'edit',
                path,
                mode: 'search-replace',
                blocks,
              } as Action);
            }
          } else {
            // Full file mode: trim leading/trailing newline from content
            // (the content between <edit> tags often has a leading newline)
            let fullContent = innerContent;
            if (fullContent.startsWith('\n')) fullContent = fullContent.slice(1);
            if (fullContent.endsWith('\n')) fullContent = fullContent.slice(0, -1);

            actions.push({
              type: 'edit',
              path,
              mode: 'full',
              content: fullContent,
            } as Action);
          }
        }

        // Merge multiple <edit> blocks targeting the same file (search-replace mode)
        const byPath = new Map<string, Action>();
        const merged: Action[] = [];
        for (const action of actions) {
          const editAction = action as any;
          if (editAction.mode === 'search-replace') {
            const existing = byPath.get(editAction.path);
            if (existing && (existing as any).mode === 'search-replace') {
              (existing as any).blocks.push(...editAction.blocks);
            } else {
              byPath.set(editAction.path, action);
              merged.push(action);
            }
          } else {
            // Full mode: last one wins
            const existing = byPath.get(editAction.path);
            if (existing && (existing as any).mode === 'full') {
              // Replace the previous full edit
              const idx = merged.indexOf(existing);
              if (idx !== -1) merged[idx] = action;
              byPath.set(editAction.path, action);
            } else {
              byPath.set(editAction.path, action);
              merged.push(action);
            }
          }
        }
        return merged;
      },
    },
    // Write action (pre-strip to preserve code blocks inside write tags)
    {
      tags: ['write'],
      preStrip: true,
      parse(content, { extractAttr: _extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = new RegExp(`<write\\s+path=${Q}(${NQR})${Q}\\s*>([\\s\\S]*?)</write>`, 'gi');
        let match;
        while ((match = regex.exec(content)) !== null) {
          const [, path, fileContent] = match;
          actions.push({
            type: 'write',
            path,
            content: decodeEntities(fileContent.trim()),
          } as Action);
        }
        return actions;
      },
    },
    // Create action (pre-strip, legacy alias)
    {
      tags: ['create'],
      preStrip: true,
      parse(content, { extractAttr: _extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = new RegExp(
          `<create\\s+path=${Q}(${NQR})${Q}\\s*>([\\s\\S]*?)</create>`,
          'gi',
        );
        let match;
        while ((match = regex.exec(content)) !== null) {
          const [, path, fileContent] = match;
          actions.push({
            type: 'create',
            path,
            content: decodeEntities(fileContent.trim()),
          } as Action);
        }
        return actions;
      },
    },
  ];
}
