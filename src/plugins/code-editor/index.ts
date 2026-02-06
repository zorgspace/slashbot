/**
 * Core Code Editor Plugin - Search & navigation (grep, glob, ls, format)
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../types';
import type { CommandHandler } from '../../core/commands/registry';
import { registerActionParser } from '../../core/actions/parser';
import { executeGlob, executeGrep, executeLS, executeFormat } from './executors';
import { getCodeEditorParserConfigs } from './parser';
import { codeEditorCommands } from './commands';
import { CODE_EDITOR_PROMPT } from './prompt';

export class CodeEditorPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'core.code-editor',
    name: 'Code Editor',
    version: '1.0.0',
    category: 'core',
    description: 'Search & navigation (glob, grep, ls, format)',
  };

  private context!: PluginContext;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
    for (const config of getCodeEditorParserConfigs()) {
      registerActionParser(config);
    }
  }

  getActionContributions(): ActionContribution[] {
    const context = this.context;

    const getCodeEditor = () => {
      const { TYPES } = require('../../core/di/types');
      return context.container.get<any>(TYPES.CodeEditor);
    };

    return [
      {
        type: 'glob',
        tagName: 'glob',
        handler: {
          onGlob: async (pattern: string, basePath?: string) => {
            const codeEditor = getCodeEditor();
            const workDir = codeEditor.getWorkDir();
            const searchDir = basePath ? `${workDir}/${basePath}` : workDir;
            try {
              const { Glob } = await import('bun');
              const glob = new Glob(pattern);
              const files: string[] = [];
              for await (const file of glob.scan({ cwd: searchDir, onlyFiles: true, dot: false })) {
                if (
                  !file.includes('node_modules/') &&
                  !file.includes('.git/') &&
                  !file.includes('dist/')
                ) {
                  files.push(basePath ? `${basePath}/${file}` : file);
                }
                if (files.length >= 100) break;
              }
              return files;
            } catch {
              return [];
            }
          },
        },
        execute: executeGlob,
      },
      {
        type: 'grep',
        tagName: 'grep',
        handler: {
          onGrep: async (pattern: string, options?: any) => {
            const codeEditor = getCodeEditor();
            const results = await codeEditor.grep(pattern, options?.glob, options);
            if (results.length === 0) return '';
            return results.map((r: any) => `${r.file}:${r.line}: ${r.content}`).join('\n');
          },
        },
        execute: executeGrep,
      },
      {
        type: 'ls',
        tagName: 'ls',
        handler: {
          onLS: async (path: string, ignore?: string[]) => {
            const codeEditor = getCodeEditor();
            const workDir = codeEditor.getWorkDir();
            const targetPath = path.startsWith('/') ? path : `${workDir}/${path}`;
            const ignoreSet = new Set(ignore || ['node_modules', '.git', 'dist']);
            try {
              const fs = await import('fs/promises');
              const entries = await fs.readdir(targetPath, { withFileTypes: true });
              const results: string[] = [];
              for (const entry of entries) {
                if (ignoreSet.has(entry.name)) continue;
                const type = entry.isDirectory() ? '/' : '';
                results.push(`${entry.name}${type}`);
              }
              return results.sort();
            } catch (error: any) {
              return [`Error: ${error.message}`];
            }
          },
        },
        execute: executeLS,
      },
      {
        type: 'format',
        tagName: 'format',
        handler: {
          onFormat: async (path?: string) => {
            const codeEditor = getCodeEditor();
            const workDir = codeEditor.getWorkDir();
            try {
              const { exec } = await import('child_process');
              const { promisify } = await import('util');
              const execAsync = promisify(exec);
              const target = path || '.';
              const { stdout, stderr } = await execAsync(`npx prettier --write "${target}"`, {
                cwd: workDir,
                timeout: 30000,
              });
              return stdout || stderr || 'Formatted';
            } catch (error: any) {
              return `Error: ${error.message || error}`;
            }
          },
        },
        execute: executeFormat,
      },
    ];
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
