/**
 * Core Code Editor Plugin - Search & navigation (grep, glob, ls)
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  ToolContribution,
} from '../types';
import type { CommandHandler } from '../../core/commands/registry';
import { registerActionParser } from '../../core/actions/parser';
import { executeGlob, executeGrep, executeLS } from './executors';
import { getCodeEditorParserConfigs } from './parser';
import { codeEditorCommands } from './commands';
import { CODE_EDITOR_PROMPT } from './prompt';
import { getCodeEditorToolContributions } from './tools';
import { createCodeEditor } from './services/CodeEditor';
import { TYPES } from '../../core/di/types';
import path from 'path';

const getCodeEditor = (context: PluginContext) => {
  return context.container.get<any>(TYPES.CodeEditor);
};

export class CodeEditorPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'core.code-editor',
    name: 'Code Editor',
    version: '1.0.0',
    category: 'core',
    description: 'Search & navigation (glob, grep, ls)',
  };

  private context!: PluginContext;

  async init(context: PluginContext): Promise<void> {
    this.context = context;

    // Self-register CodeEditor in DI if not already bound (e.g., in compiled builds)
    if (!context.container.isBound(TYPES.CodeEditor)) {
      const codeEditor = createCodeEditor(context.workDir);
      if (context.eventBus) {
        codeEditor.setEventBus(context.eventBus as any);
      }
      context.container.bind(TYPES.CodeEditor).toConstantValue(codeEditor);
    }

    for (const config of getCodeEditorParserConfigs()) {
      registerActionParser(config);
    }
  }

  getActionContributions(): ActionContribution[] {
    const context = this.context;

    return [
      {
        type: 'glob',
        tagName: 'glob',
        handler: {
          onGlob: async (pattern: string, basePath?: string) => {
            const codeEditor = getCodeEditor(context);
            return await codeEditor.glob(pattern, basePath);
          },
        },
        execute: executeGlob,
      },
      {
        type: 'grep',
        tagName: 'grep',
        handler: {
          onGrep: async (pattern: string, options?: any) => {
            const codeEditor = getCodeEditor(context);
            const results = await codeEditor.grep(pattern, options?.glob, options);

            if (results.length === 0) {
              return options?.outputMode === 'count' ? '0' : '';
            }

            switch (options?.outputMode) {
              case 'count':
                return results.filter((r: any) => r.match !== '').length.toString();
              case 'files_with_matches':
                const uniqueFiles = [...new Set(results.map((r: any) => r.file))];
                return uniqueFiles.join('\n');
              case 'content':
              default:
                return results.map((r: any) => `${r.file}:${r.line}: ${r.content}`).join('\n');
            }
          },
        },
        execute: executeGrep,
      },
      {
        type: 'ls',
        tagName: 'ls',
        handler: {
          onLS: async (target: string, ignore?: string[]) => {
            const codeEditor = getCodeEditor(context);
            const workDir = codeEditor.getWorkDir();
            const requestedPath = String(target || '.').trim() || '.';
            const targetPath = path.isAbsolute(requestedPath)
              ? requestedPath
              : path.join(workDir, requestedPath);
            const ignoreSet = new Set(ignore || ['node_modules', '.git', 'dist']);

            const fs = await import('fs/promises');

            try {
              const stat = await fs.stat(targetPath);
              if (stat.isFile()) {
                return [path.basename(targetPath)];
              }
              if (!stat.isDirectory()) {
                throw new Error(`Path is neither a file nor a directory: ${requestedPath}`);
              }
            } catch (error: any) {
              if (error?.code === 'ENOENT') {
                throw new Error(`Path not found: ${requestedPath}`);
              }
              throw error;
            }

            const entries = await fs.readdir(targetPath, { withFileTypes: true });
            const results: string[] = [];
            for (const entry of entries) {
              if (ignoreSet.has(entry.name)) continue;
              const type = entry.isDirectory() ? '/' : '';
              results.push(`${entry.name}${type}`);
            }
            return results.sort();
          },
        },
        execute: executeLS,
      },
    ];
  }

  getToolContributions(): ToolContribution[] {
    return getCodeEditorToolContributions();
  }

  getCommandContributions(): CommandHandler[] {
    return codeEditorCommands;
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'core.code-editor.tools',
        title: 'Search & Navigation',
        priority: 30,
        content: CODE_EDITOR_PROMPT,
      },
    ];
  }
}
