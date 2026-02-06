import type { ActionParserConfig, ParserUtils } from '../../core/actions/parser';
import { extractAttr, extractBoolAttr } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

// Quote pattern: matches both single and double quotes
const Q = `["']`;
const NQR = `[^"']+`;

/**
 * Try to reconstruct malformed edit tags that LLM might produce
 */
function tryReconstructMalformedEdits(content: string): string {
  let result = content;

  // Pattern 1: LLM outputs <edit path="..."> then code directly then </edit>
  const brokenEditPattern =
    /<edit\s+path\s*=\s*["']([^"']+)["'][^>]*>(?![\s\S]*?<search>)([\s\S]*?)<\/edit>/gi;
  result = result.replace(brokenEditPattern, (match, _path, codeContent) => {
    const trimmed = codeContent.trim();
    if (trimmed && !trimmed.includes('<search>') && !trimmed.includes('<replace>')) {
      return match;
    }
    return match;
  });

  // Pattern 2: Missing opening <edit>
  const missingOpenPattern =
    /(?<!<edit[^>]*>)((?:^|\n)[\w/.]+\.(?:ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|md|json|yaml|yml)\s*\n\s*<search>[\s\S]*?<\/search>\s*<replace>[\s\S]*?<\/replace>\s*<\/edit>)/gi;
  result = result.replace(missingOpenPattern, (match, content) => {
    const pathMatch = content.match(
      /^[\s\n]*([\w/.]+\.(?:ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|md|json|yaml|yml))/i,
    );
    if (pathMatch) {
      const path = pathMatch[1];
      const rest = content.slice(pathMatch[0].length);
      return `<edit path="${path}">${rest}`;
    }
    return match;
  });

  // Pattern 3: <edit> without path attribute but path mentioned in content
  const editWithoutPathPattern =
    /<edit\s*>[\s\n]*([\w/.]+\.(?:ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|md|json|yaml|yml))[\s\n]*<search>/gi;
  result = result.replace(editWithoutPathPattern, '<edit path="$1"><search>');

  return result;
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
    // Edit action (post-strip)
    {
      tags: ['edit', 'replace', 'search'],
      fixups(content: string): string {
        let result = content;

        // Fix malformed inner tags like <search"> or <replace"> (stray quotes)
        result = result.replace(/<search["'\s]*>/gi, '<search>');
        result = result.replace(/<replace["'\s]*>/gi, '<replace>');
        result = result.replace(/<\/search["'\s]*>/gi, '</search>');
        result = result.replace(/<\/replace["'\s]*>/gi, '</replace>');

        // Fix extra </search> after </replace> (common LLM mistake)
        result = result.replace(/<\/replace>\s*<\/search>\s*<\/edit/gi, '</replace></edit');

        // Fix </search> used instead of </replace> at end of replace block
        result = result.replace(
          /<replace>([\s\S]*?)<\/search>\s*<\/replace>/gi,
          '<replace>$1</replace></edit>',
        );
        result = result.replace(
          /<replace>([\s\S]*?)<\/search>\s*<\/edit/gi,
          '<replace>$1</replace></edit',
        );

        // Fix <replace>...</search> -> <replace>...</replace>
        result = result.replace(
          /<replace>((?:(?!<\/replace>|<\/edit>)[\s\S])*?)<\/search>/gi,
          '<replace>$1</replace>',
        );

        // Fix variations of edit tag: <edit file="..."> -> <edit path="...">
        result = result.replace(/<edit\s+file\s*=/gi, '<edit path=');

        // Fix unquoted paths in edit: <edit path=src/file.ts> -> <edit path="src/file.ts">
        result = result.replace(/<edit\s+path\s*=\s*([^"'\s>][^\s>]*)/gi, '<edit path="$1"');

        return result;
      },
      parse(content): Action[] {
        // Apply malformed edit reconstruction
        const fixedContent = tryReconstructMalformedEdits(content);

        const actions: Action[] = [];
        const editPatterns = [
          new RegExp(
            `<edit\\s+path=${Q}(${NQR})${Q}[^>]*>\\s*<search>([\\s\\S]*?)</search>\\s*<replace>([\\s\\S]*?)</replace>\\s*</edit>`,
            'gi',
          ),
          /<edit\s+path\s*=\s*["']([^"']+)["'][^>]*>\s*<search>((?:[\s\S]*?))<\/search>\s*<replace>((?:[\s\S]*?))<\/replace>\s*<\/edit>/gi,
          /<edit\s+path\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<search>([\s\S]*?)<\/search>[\s\S]*?<replace>([\s\S]*?)<\/replace>[\s\S]*?<\/edit>/gi,
          /<edit\s+file\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<search>([\s\S]*?)<\/search>[\s\S]*?<replace>([\s\S]*?)<\/replace>[\s\S]*?<\/edit>/gi,
          /<edit\s+path\s*=\s*([^\s>"']+)[^>]*>[\s\S]*?<search>([\s\S]*?)<\/search>[\s\S]*?<replace>([\s\S]*?)<\/replace>[\s\S]*?<\/edit>/gi,
          /<edit\s+path\s*=\s*["']?([^"'\s>]+)["']?[^>]*><search>([\s\S]*?)<\/search><replace>([\s\S]*?)<\/replace><\/edit>/gi,
        ];

        const parsedEditPaths = new Set<string>();
        let match;
        for (const editRegex of editPatterns) {
          editRegex.lastIndex = 0;
          while ((match = editRegex.exec(fixedContent)) !== null) {
            const fullMatch = match[0];
            const [, path, search, replace] = match;

            const matchKey = `${path}:${search.slice(0, 50)}`;
            if (parsedEditPaths.has(matchKey)) continue;
            parsedEditPaths.add(matchKey);

            const replaceAll =
              extractBoolAttr(fullMatch, 'replace_all') || extractBoolAttr(fullMatch, 'replaceAll');
            const cleanSearch = search.replace(/^\n+|\n+$/g, '');
            const cleanReplace = replace.replace(/^\n+|\n+$/g, '');
            actions.push({
              type: 'edit',
              path,
              search: cleanSearch,
              replace: cleanReplace,
              replaceAll: replaceAll || undefined,
            } as Action);
          }
        }
        return actions;
      },
    },
    // Diff edit action (post-strip) - new format with line numbers
    {
      tags: [], // No XML tags for this format
      parse(content): Action[] {
        const actions: Action[] = [];
        // Look for file path followed by diff format
        const diffRegex = /([\w/.]+\.(?:ts|js|tsx|jsx|py|go|rs|java|cpp|c|h|md|json|yaml|yml))\s*\n<<<<<<< SEARCH@(\d+)-(\d+)\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/gi;
        let match;
        while ((match = diffRegex.exec(content)) !== null) {
          const [, path, startLine, endLine, search, replace] = match;
          const cleanSearch = search.replace(/^\n+|\n+$/g, '');
          const cleanReplace = replace.replace(/^\n+|\n+$/g, '');
          actions.push({
            type: 'edit',
            path,
            search: cleanSearch,
            replace: cleanReplace,
          } as Action);
        }
        return actions;
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
