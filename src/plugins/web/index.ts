/**
 * Core Web Plugin - Fetch and Search operations
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
} from '../types';
import { registerActionParser } from '../../core/actions/parser';
import { executeFetch, executeSearch } from './executors';
import { getWebParserConfigs } from './parser';
import { WEB_PROMPT } from './prompt';
import { webSearch } from './search';

export class WebPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'core.web',
    name: 'Web',
    version: '1.0.0',
    category: 'core',
    description: 'Web operations (fetch, search)',
  };

  private context!: PluginContext;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
    for (const config of getWebParserConfigs()) {
      registerActionParser(config);
    }
  }

  getActionContributions(): ActionContribution[] {
    const context = this.context;

    return [
      {
        type: 'fetch',
        tagName: 'fetch',
        handler: {
          onFetch: async (url: string, prompt?: string) => {
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 30000);
              const response = await fetch(url, {
                headers: {
                  'User-Agent': 'Slashbot/1.0 (CLI Assistant)',
                  Accept: 'text/html,application/json,text/plain,*/*',
                },
                redirect: 'follow',
                signal: controller.signal,
              });
              clearTimeout(timeout);
              if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              const contentType = response.headers.get('content-type') || '';
              let content: string;
              if (contentType.includes('application/json')) {
                const json = await response.json();
                content = JSON.stringify(json, null, 2);
              } else {
                content = await response.text();
                if (contentType.includes('text/html')) {
                  content = content
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/\s+/g, ' ')
                    .trim();
                }
              }
              const MAX_FETCH_CHARS = 15000;
              let truncated = false;
              if (content.length > MAX_FETCH_CHARS) {
                content = content.slice(0, MAX_FETCH_CHARS);
                truncated = true;
              }
              const truncationNote = truncated
                ? `\n\n[Content truncated to ${MAX_FETCH_CHARS} chars]`
                : '';
              if (prompt)
                return `[Fetched from ${url}]\n\n${content}${truncationNote}\n\n[User wants: ${prompt}]`;
              return `[Fetched from ${url}]\n\n${content}${truncationNote}`;
            } catch (error: any) {
              throw new Error(`Fetch failed: ${error.message || error}`);
            }
          },
        },
        execute: executeFetch,
      },
      {
        type: 'search',
        tagName: 'search',
        handler: {
          onSearch: async (query: string, options?: { allowedDomains?: string[]; blockedDomains?: string[] }) => {
            const getClient = context.getGrokClient;
            if (!getClient) throw new Error('Not connected to Grok');
            const grokClient = getClient();
            if (!grokClient) throw new Error('Not connected to Grok');
            return await webSearch(grokClient as import('../../core/api/client').GrokClient, query, {
              enableXSearch: true,
              allowedDomains: options?.allowedDomains,
              excludedDomains: options?.blockedDomains,
            });
          },
        },
        execute: executeSearch,
      },
    ];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'core.web.tools',
        title: 'Web Operations',
        priority: 40,
        content: WEB_PROMPT,
      },
    ];
  }
}
