/**
 * Core Filesystem Plugin - File read/edit/write operations
 *
 * Provides: read, edit, write, create actions
 * Prompt: File tools reference, edit format rules, code quality
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../types';
import { registerActionParser } from '../../core/actions/parser';
import { executeRead, executeEdit, executeWrite, executeCreate } from './executors';
import { getFilesystemParserConfigs } from './parser';
import { FILESYSTEM_PROMPT } from './prompt';

export class FilesystemPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'core.filesystem',
    name: 'Filesystem',
    version: '1.0.0',
    category: 'core',
    description: 'File read, edit, write, and create operations',
  };

  private context!: PluginContext;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
    for (const config of getFilesystemParserConfigs()) {
      registerActionParser(config);
    }

    // Wire EventBus into CodeEditor for edit:applied events
    try {
      const { TYPES } = require('../../core/di/types');
      const codeEditor = context.container.get<any>(TYPES.CodeEditor);
      const eventBus = context.container.get<any>(TYPES.EventBus);
      codeEditor.setEventBus(eventBus);
    } catch {
      // EventBus or CodeEditor not yet bound
    }
  }

  getActionContributions(): ActionContribution[] {
    const context = this.context;

    const getCodeEditor = () => {
      const { TYPES } = require('../../core/di/types');
      return context.container.get<any>(TYPES.CodeEditor);
    };

    const getFileSystem = () => {
      const { TYPES } = require('../../core/di/types');
      return context.container.get<any>(TYPES.FileSystem);
    };

    const onRead = async (path: string, options?: { offset?: number; limit?: number }) => {
      const codeEditor = getCodeEditor();
      const content = await codeEditor.readFile(path);
      if (!content) return null;

      // Apply offset/limit if specified
      if (options?.offset || options?.limit) {
        const lines = content.split('\n');
        const start = options.offset || 0;
        const end = options.limit ? start + options.limit : lines.length;
        return lines.slice(start, end).join('\n');
      }

      return content;
    };

    const onEdit = async (
      path: string,
      mode: 'full' | 'search-replace',
      content?: string,
      blocks?: import('./types').SearchReplaceBlock[],
    ) => {
      const codeEditor = getCodeEditor();
      return await codeEditor.applyMergeEdit(path, mode, content, blocks);
    };

    const onCreate = async (path: string, content: string) => {
      const codeEditor = getCodeEditor();
      return await codeEditor.createFile(path, content);
    };

    const onFile = async (path: string, content: string) => {
      const fileSystem = getFileSystem();
      return await fileSystem.writeFile(path, content);
    };

    return [
      {
        type: 'read',
        tagName: 'read',
        handler: { onRead },
        execute: (action, handlers) => executeRead(action as any, handlers),
      },
      {
        type: 'edit',
        tagName: 'edit',
        handler: { onEdit },
        execute: (action, handlers) => executeEdit(action as any, handlers),
      },

      {
        type: 'write',
        tagName: 'write',
        handler: { onCreate, onWrite: onFile },
        execute: (action, handlers) => executeWrite(action as any, handlers),
      },
      {
        type: 'create',
        tagName: 'create',
        handler: { onCreate, onWrite: onFile },
        execute: (action, handlers) => executeCreate(action as any, handlers),
      },
    ];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'core.filesystem.tools',
        title: 'File Operations Tools',
        priority: 20,
        content: FILESYSTEM_PROMPT,
      },
    ];
  }
}
