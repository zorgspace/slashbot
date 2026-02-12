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
  ToolContribution,
  KernelHookContribution,
} from '../types';
import { registerActionParser } from '../../core/actions/parser';
import { display, formatToolAction } from '../../core/ui';
import { executeRead, executeEdit, executeWrite, executeCreate } from './executors';
import { getFilesystemParserConfigs } from './parser';
import { FILESYSTEM_PROMPT } from './prompt';
import { getFilesystemToolContributions } from './tools';
import { createFileSystem } from './services/SecureFileSystem';
import {
  addImage,
  imageBuffer,
  isImageDataUrl,
  loadImageFromFile,
  getImageSizeKB,
} from './services/ImageBuffer';
import { TYPES } from '../../core/di/types';
import type { EventBus } from '../../core/events/EventBus';
import type { CodeEditor } from '../code-editor/services/CodeEditor';

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

    // Self-register SecureFileSystem in DI
    const fileSystem = createFileSystem(context.workDir);
    context.container.bind(TYPES.FileSystem).toConstantValue(fileSystem);

    for (const config of getFilesystemParserConfigs()) {
      registerActionParser(config);
    }

    // Wire EventBus into CodeEditor for edit:applied events
    try {
      const codeEditor = context.container.get<CodeEditor>(TYPES.CodeEditor);
      const eventBus = context.container.get<EventBus>(TYPES.EventBus);
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
        const startLine = Math.max(1, options.offset || 1);
        const startIndex = startLine - 1;
        const maxLines = typeof options.limit === 'number' && options.limit > 0 ? options.limit : 0;
        const endIndex = maxLines > 0 ? startIndex + maxLines : lines.length;
        return lines.slice(startIndex, endIndex).join('\n');
      }

      return content;
    };

    const onEdit = async (
      path: string,
      oldString: string,
      newString: string,
      replaceAll?: boolean,
    ) => {
      const codeEditor = getCodeEditor();
      return await codeEditor.applyEdit(path, oldString, newString, replaceAll);
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

  getToolContributions(): ToolContribution[] {
    return getFilesystemToolContributions();
  }

  getKernelHooks(): KernelHookContribution[] {
    return [
      {
        event: 'input:before',
        order: 30,
        handler: async payload => {
          if (payload.handled === true) {
            return;
          }
          const source = String(payload.source || '');
          if (source !== 'cli') {
            return;
          }
          const input = typeof payload.input === 'string' ? payload.input.trim() : '';
          if (!input) {
            return;
          }

          if (isImageDataUrl(input)) {
            addImage(input);
            display.successText(`🖼️  Image added to context #${imageBuffer.length}`);
            return {
              handled: true,
              response: '',
            };
          }

          const pathMatch = input.match(
            /^['"]?([~\/]?[^\s'"]+\.(png|jpg|jpeg|gif|webp|bmp))['"]?$/i,
          );
          if (!pathMatch) {
            return;
          }

          try {
            const dataUrl = await loadImageFromFile(pathMatch[1]);
            addImage(dataUrl);
            display.appendAssistantMessage(
              formatToolAction('Image', pathMatch[1].split('/').pop() || 'file', {
                success: true,
                summary: `${getImageSizeKB(dataUrl)}KB`,
              }),
            );
            return {
              handled: true,
              response: '',
            };
          } catch {
            // If image load fails, keep normal input flow.
            return;
          }
        },
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
