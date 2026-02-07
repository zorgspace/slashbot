import type { ActionParserConfig, ParserUtils } from '../../core/actions/parser';
import { extractAttr, extractBoolAttr } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

// Quote pattern: matches both single and double quotes
const Q = `["']`;
const NQR = `[^"']+`;

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
    // Edit action (post-strip) - unified diff format with line numbers
    {
      tags: ['edit'],
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
          const innerContent = outerMatch[2];

          // Find all hunk headers: @@ -startLine,count @@
          const hunkRegex = /@@ -(\d+),(\d+)(?:\s+\+\d+(?:,\d+)?)? @@/g;
          let hunkMatch;
          const headers: {
            startLine: number;
            lineCount: number;
            matchStart: number;
            matchEnd: number;
          }[] = [];

          while ((hunkMatch = hunkRegex.exec(innerContent)) !== null) {
            headers.push({
              startLine: parseInt(hunkMatch[1], 10),
              lineCount: parseInt(hunkMatch[2], 10),
              matchStart: hunkMatch.index,
              matchEnd: hunkMatch.index + hunkMatch[0].length,
            });
          }

          if (headers.length === 0) continue;

          const hunks: {
            startLine: number;
            lineCount: number;
            diffLines: { type: 'context' | 'add' | 'remove'; content: string }[];
          }[] = [];
          for (let i = 0; i < headers.length; i++) {
            const header = headers[i];
            const contentStart = header.matchEnd;
            const contentEnd =
              i + 1 < headers.length ? headers[i + 1].matchStart : innerContent.length;
            const hunkContent = innerContent.substring(contentStart, contentEnd);

            const diffLines: { type: 'context' | 'add' | 'remove'; content: string }[] = [];
            for (const line of hunkContent.split('\n')) {
              if (line.startsWith('-')) {
                diffLines.push({ type: 'remove', content: line.substring(1) });
              } else if (line.startsWith('+')) {
                diffLines.push({ type: 'add', content: line.substring(1) });
              } else if (line.startsWith(' ')) {
                diffLines.push({ type: 'context', content: line.substring(1) });
              } else if (line.trim().length > 0) {
                // No prefix - treat as context (LLM forgot the space prefix)
                diffLines.push({ type: 'context', content: line });
              }
            }

            hunks.push({
              startLine: header.startLine,
              lineCount: header.lineCount,
              diffLines,
            });
          }

          actions.push({
            type: 'edit',
            path,
            hunks,
          } as Action);
        }

        // Merge multiple <edit> blocks targeting the same file into one action
        // so all hunks are applied bottom-to-top in a single pass
        const byPath = new Map<string, Action>();
        const merged: Action[] = [];
        for (const action of actions) {
          const editAction = action as { type: string; path: string; hunks: any[] };
          const existing = byPath.get(editAction.path);
          if (existing) {
            (existing as any).hunks.push(...editAction.hunks);
          } else {
            byPath.set(editAction.path, action);
            merged.push(action);
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
            content: fileContent.trim(),
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
            content: fileContent.trim(),
          } as Action);
        }
        return actions;
      },
    },
  ];
}
