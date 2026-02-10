import type { ActionParserConfig, ParserUtils } from '../../core/actions/parser';
import { extractAttr, extractBoolAttr } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';
import { display } from '../../core/ui';

// Quote pattern: matches both single and double quotes
const Q = `["']`;
const NQR = `[^"']+`;

/** Decode HTML entities that LLM APIs may produce inside XML tag content */
function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * Detect if edit/write content is corrupted with raw LLM action tags.
 * This happens when the LLM malfunctions and dumps its own action syntax
 * (edit tags, end tags, search/replace blocks) as literal file content.
 *
 * Returns a reason string if corrupted, or null if clean.
 */
function detectContentCorruption(content: string, targetPath: string): string | null {
  // Signal 1: Nested edit tag targeting the same file — the LLM is recursively
  // emitting edit instructions inside its own edit content.
  const escaped = targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`<edit\\s+path\\s*=\\s*["']${escaped}["']`, 'i').test(content)) {
    return `nested <edit> targeting same file "${targetPath}"`;
  }

  // Signal 2: Multiple nested edit tags (3+) — retry/hallucination loop.
  const nestedEditCount = (content.match(/<edit\s+path\s*=/gi) || []).length;
  if (nestedEditCount >= 3) {
    return `${nestedEditCount} nested <edit> tags detected`;
  }

  // Signal 3: Slashbot control tags that are never valid file content.
  // Count distinct action tag patterns; 3+ different ones = corruption.
  const corruptionSignals = [
    /<edit\s+path\s*=/i,
    /<\/edit>/i,
    /<end>/i,
    /<\/end>/i,
    /<bash>/i,
    /<\/bash>/i,
    /<say>/i,
    /<\/say>/i,
    /<write\s+path\s*=/i,
    /<\/write>/i,
  ];
  let signalCount = 0;
  for (const pattern of corruptionSignals) {
    if (pattern.test(content)) signalCount++;
  }
  if (signalCount >= 3) {
    return `${signalCount} different action tag patterns in content`;
  }

  return null;
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
      tags: ['read', 'read_file'],
      selfClosingTags: ['read', 'read_file'],
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
      tags: ['edit', 'edit_file'],
      preStrip: true,
      protectedTags: ['edit', 'edit_file'],
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

          // Reject edits whose content is corrupted with raw action tags
          const corruption = detectContentCorruption(innerContent, path);
          if (corruption) {
            display.errorText(`Rejected corrupted edit for ${path}: ${corruption}`);
            continue;
          }

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
      tags: ['write', 'write_file'],
      preStrip: true,
      parse(content, { extractAttr: _extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = new RegExp(`<write\\s+path=${Q}(${NQR})${Q}\\s*>([\\s\\S]*?)</write>`, 'gi');
        let match;
        while ((match = regex.exec(content)) !== null) {
          const [, path, fileContent] = match;
          const decoded = decodeEntities(fileContent.trim());
          const corruption = detectContentCorruption(decoded, path);
          if (corruption) {
            display.errorText(`Rejected corrupted write for ${path}: ${corruption}`);
            continue;
          }
          actions.push({
            type: 'write',
            path,
            content: decoded,
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
          const decoded = decodeEntities(fileContent.trim());
          const corruption = detectContentCorruption(decoded, path);
          if (corruption) {
            display.errorText(`Rejected corrupted create for ${path}: ${corruption}`);
            continue;
          }
          actions.push({
            type: 'create',
            path,
            content: decoded,
          } as Action);
        }
        return actions;
      },
    },
  ];
}
