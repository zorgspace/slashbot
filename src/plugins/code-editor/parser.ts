import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getCodeEditorParserConfigs(): ActionParserConfig[] {
  return [
    // Glob action
    {
      tags: ['glob'],
      selfClosingTags: ['glob'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<glob\s+[^>]*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const pattern = extractAttr(fullTag, 'pattern');
          const basePath = extractAttr(fullTag, 'path');
          if (pattern) {
            actions.push({
              type: 'glob',
              pattern,
              path: basePath || undefined,
            } as Action);
          }
        }
        return actions;
      },
    },
    // Grep action
    {
      tags: ['grep'],
      selfClosingTags: ['grep'],
      parse(content, { extractAttr, extractBoolAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<grep\s+[^>]*(?:\/>|>[\s\S]*?<\/grep>)/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const pattern = extractAttr(fullTag, 'pattern');
          if (pattern) {
            const path = extractAttr(fullTag, 'path');
            const glob = extractAttr(fullTag, 'glob') || extractAttr(fullTag, 'file');
            const outputMode = extractAttr(fullTag, 'output') || extractAttr(fullTag, 'mode');
            const context = extractAttr(fullTag, 'context') || extractAttr(fullTag, 'C');
            const contextBefore = extractAttr(fullTag, 'before') || extractAttr(fullTag, 'B');
            const contextAfter = extractAttr(fullTag, 'after') || extractAttr(fullTag, 'A');
            const caseInsensitive =
              extractBoolAttr(fullTag, 'i') || extractAttr(fullTag, 'case') === 'insensitive';
            const lineNumbers = extractBoolAttr(fullTag, 'n') || extractBoolAttr(fullTag, 'lines');
            const headLimit = extractAttr(fullTag, 'limit') || extractAttr(fullTag, 'head');
            const multiline = extractBoolAttr(fullTag, 'multiline');

            actions.push({
              type: 'grep',
              pattern,
              path: path || undefined,
              glob: glob || undefined,
              outputMode: outputMode || undefined,
              context: context ? parseInt(context, 10) : undefined,
              contextBefore: contextBefore ? parseInt(contextBefore, 10) : undefined,
              contextAfter: contextAfter ? parseInt(contextAfter, 10) : undefined,
              caseInsensitive: caseInsensitive || undefined,
              lineNumbers: lineNumbers || undefined,
              headLimit: headLimit ? parseInt(headLimit, 10) : undefined,
              multiline: multiline || undefined,
            } as Action);
          }
        }
        return actions;
      },
    },
    // LS action
    {
      tags: ['ls', 'list'],
      selfClosingTags: ['ls', 'list'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        // Parse both <ls> and <list> tags
        for (const tagName of ['ls', 'list']) {
          const regex = new RegExp(`<${tagName}\\s+[^>]*\\/?>`, 'gi');
          let match;
          while ((match = regex.exec(content)) !== null) {
            const fullTag = match[0];
            const path = extractAttr(fullTag, 'path');
            const ignoreStr = extractAttr(fullTag, 'ignore');
            if (path) {
              actions.push({
                type: 'ls',
                path,
                ignore: ignoreStr ? ignoreStr.split(',').map(s => s.trim()) : undefined,
              } as Action);
            }
          }
        }
        return actions;
      },
    },
    // Format action
    {
      tags: ['format'],
      selfClosingTags: ['format'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<format(?:\s+[^>]*)?\s*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const path = extractAttr(fullTag, 'path');
          actions.push({
            type: 'format',
            path: path || undefined,
          } as Action);
        }
        return actions;
      },
    },
  ];
}
