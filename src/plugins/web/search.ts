/**
 * Web Search - Standalone search function using Grok /v1/responses endpoint
 */

import { display } from '../../core/ui';
import type { GrokClient } from '../../core/api';
import { GROK_CONFIG, MODELS } from '../../core/config/constants';

export async function webSearch(
  grokClient: GrokClient,
  userMessage: string,
  options?: {
    enableXSearch?: boolean;
    allowedDomains?: string[];
    excludedDomains?: string[];
  },
): Promise<{ response: string; citations: string[] }> {
  const tools: Array<{ type: string; filters?: Record<string, any> }> = [{ type: 'web_search' }];

  if (options?.allowedDomains?.length) {
    tools[0].filters = { allowed_domains: options.allowedDomains.slice(0, 5) };
  } else if (options?.excludedDomains?.length) {
    tools[0].filters = { excluded_domains: options.excludedDomains.slice(0, 5) };
  }

  if (options?.enableXSearch) {
    tools.push({ type: 'x_search' });
  }

  const history = grokClient.getHistory();
  const input = [
    {
      role: 'system',
      content: history[0]?.content || 'You are a helpful assistant.',
    },
    ...history.slice(1).map(m => ({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? m.content
          : (m.content as any[]).find((p: any) => p.type === 'text')?.text || '',
    })),
    { role: 'user', content: userMessage },
  ];

  const currentModel = grokClient.getCurrentModel();
  const searchModel = currentModel.startsWith('grok-') ? currentModel : MODELS.SEARCH;

  const requestBody = {
    model: searchModel,
    input,
    tools,
  };

  // Search always uses the xAI Grok API, so get the xAI key specifically
  // (the main client may be using a different provider like Anthropic)
  const xaiConfig = grokClient.providerRegistry.getConfig('xai');
  const apiKey = xaiConfig?.apiKey || grokClient.getApiConfig().apiKey;
  const baseUrl = xaiConfig?.baseUrl || GROK_CONFIG.API_BASE_URL;

  display.startThinking('Searching...');

  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    display.stopThinking();

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Grok Search API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    let content = '';
    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === 'message' && Array.isArray(item.content)) {
          for (const block of item.content) {
            if (block.type === 'output_text' && block.text) {
              content += block.text;
            } else if (block.type === 'text' && block.text) {
              content += block.text;
            }
          }
        } else if (item.type === 'message' && typeof item.content === 'string') {
          content += item.content;
        }
      }
    }
    if (!content && data.output_text) {
      content = data.output_text;
    }
    const citations = Array.isArray(data.citations) ? data.citations : [];

    if (data.usage) {
      grokClient.trackUsage({
        promptTokens: data.usage.input_tokens || 0,
        completionTokens: data.usage.output_tokens || 0,
        totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
      });
    }

    grokClient.addMessage({ role: 'user', content: userMessage });
    grokClient.addMessage({ role: 'assistant', content: content });

    return {
      response: content,
      citations,
    };
  } catch (error) {
    display.stopThinking();
    throw error;
  }
}
