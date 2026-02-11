/**
 * Memory Plugin - Structured memory retrieval tools
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  ToolContribution,
} from '../types';
import {
  executeMemoryGet,
  executeMemorySearch,
  executeMemoryStats,
  executeMemoryUpsert,
} from './executors';
import { getMemoryToolContributions } from './tools';
import { MEMORY_PROMPT } from './prompt';
import { MemoryStore } from './services/MemoryStore';

export class MemoryPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.memory',
    name: 'Memory',
    version: '1.0.0',
    category: 'feature',
    description: 'Structured memory search/get tools over MEMORY.md and memory/*.md',
  };

  private context!: PluginContext;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
  }

  getActionContributions(): ActionContribution[] {
    const workDir = this.context.workDir || process.cwd();
    const memoryStore = new MemoryStore(workDir);

    return [
      {
        type: 'memory-search',
        tagName: 'memory-search',
        handler: {
          onMemorySearch: async (query: string, limit: number) =>
            await memoryStore.search(query, limit),
        },
        execute: (action, handlers) => executeMemorySearch(action as any, handlers),
      },
      {
        type: 'memory-get',
        tagName: 'memory-get',
        handler: {
          onMemoryGet: async (relPath: string, startLine?: number, endLine?: number) =>
            await memoryStore.get(relPath, startLine, endLine),
        },
        execute: (action, handlers) => executeMemoryGet(action as any, handlers),
      },
      {
        type: 'memory-upsert',
        tagName: 'memory-upsert',
        handler: {
          onMemoryUpsert: async (input: { text: string; tags?: string[]; file?: string }) =>
            await memoryStore.upsert(input),
        },
        execute: (action, handlers) => executeMemoryUpsert(action as any, handlers),
      },
      {
        type: 'memory-stats',
        tagName: 'memory-stats',
        handler: {
          onMemoryStats: async () => await memoryStore.stats(),
        },
        execute: (action, handlers) => executeMemoryStats(action as any, handlers),
      },
    ];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'feature.memory.tools',
        title: 'Memory Tools',
        priority: 115,
        content: MEMORY_PROMPT,
      },
    ];
  }

  getToolContributions(): ToolContribution[] {
    return getMemoryToolContributions();
  }
}
