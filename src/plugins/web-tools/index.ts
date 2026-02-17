import type {
  AuthProfile,
  JsonValue,
  ProviderDefinition,
  SlashbotPlugin,
  ToolCallContext
} from '../../plugin-sdk/index.js';
import type { ProviderRegistry } from '@slashbot/core/kernel/registries.js';
import type { AuthProfileRouter } from '@slashbot/core/providers/auth-router.js';
import { z } from 'zod';
import { asObject, asString, asOptionalStringArray, stripHtml } from '../utils.js';

const PLUGIN_ID = 'slashbot.tools.web';
const MAX_CONTENT_LENGTH = 15_000;
type SearchProviderId = 'openai' | 'xai';

const DEFAULT_SEARCH_MODELS: Record<SearchProviderId, string> = {
  openai: 'gpt-5',
  xai: 'grok-4-fast-non-reasoning'
};
const DEFAULT_SEARCH_TOOL_TYPES: Record<SearchProviderId, string[]> = {
  openai: ['web_search', 'web_search_preview'],
  xai: ['web_search'],
};

function normalizeSearchProvider(value: unknown): SearchProviderId | undefined {
  if (value !== 'openai' && value !== 'xai') {
    return undefined;
  }
  return value;
}

function extractToken(profile: AuthProfile): string | undefined {
  const apiKey = profile.data.apiKey;
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    return apiKey;
  }

  const access = profile.data.access;
  if (typeof access === 'string' && access.length > 0) {
    return access;
  }

  return undefined;
}

function modelSupportsSearch(provider: ProviderDefinition | undefined, modelId: string): boolean {
  if (!provider) {
    return true;
  }
  const model = provider.models.find((entry) => entry.id === modelId);
  if (!model) {
    return true;
  }
  const caps = model.capabilities ?? [];
  return caps.includes('search') || caps.includes('tools');
}

function parseSearchOutput(data: Record<string, unknown>): string {
  if (typeof data.output_text === 'string' && data.output_text.trim().length > 0) {
    return data.output_text;
  }

  const output = Array.isArray(data.output) ? data.output : [];
  const responseTextParts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const typed = item as Record<string, unknown>;
    const content = Array.isArray(typed.content) ? typed.content : [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const node = part as Record<string, unknown>;
      if (typeof node.text === 'string' && node.text.trim().length > 0) {
        responseTextParts.push(node.text);
      }
    }
  }
  if (responseTextParts.length > 0) {
    return responseTextParts.join('\n');
  }

  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0];
  if (!first || typeof first !== 'object') {
    return JSON.stringify(data, null, 2);
  }

  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') {
    return JSON.stringify(data, null, 2);
  }

  const content = (message as Record<string, unknown>).content;
  if (typeof content === 'string' && content.trim().length > 0) {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts = content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const obj = part as Record<string, unknown>;
        if (typeof obj.text === 'string') return obj.text;
        if (typeof obj.content === 'string') return obj.content;
        return '';
      })
      .filter((part) => part.length > 0);

    if (textParts.length > 0) {
      return textParts.join('\n');
    }
  }

  return JSON.stringify(data, null, 2);
}

/**
 * Web Tools plugin — HTTP fetch and AI-powered web search.
 *
 * Tools:
 *  - `web.fetch`   — Fetch a URL and return text content (HTML stripped, JSON pretty-printed, max 15K chars).
 *  - `web.search`  — Web search via OpenAI or xAI Responses API with built-in summarization.
 *
 * Prompt section:
 *  - `web.tools.docs` — Instructs the LLM when to use web tools.
 */
export function createWebToolsPlugin(): SlashbotPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Web Tools',
      version: '0.1.0',
      main: 'bundled',
      description: 'Web fetch and search tools',
    },
    setup: (context) => {
      const authRouter = context.getService<AuthProfileRouter>('kernel.authRouter');
      const providers = context.getService<ProviderRegistry>('kernel.providers.registry');

      const resolveSearchCredentials = async (
        toolContext: ToolCallContext,
        preferredProvider?: SearchProviderId,
        requestedModelId?: string
      ): Promise<
        | { providerId: SearchProviderId; apiKey: string; modelId: string; source: 'auth_profile' | 'environment' }
        | { error: string }
      > => {
        const orderedProviders: SearchProviderId[] = [];
        const pushProvider = (providerId: SearchProviderId | undefined): void => {
          if (!providerId || orderedProviders.includes(providerId)) return;
          orderedProviders.push(providerId);
        };

        if (preferredProvider) {
          pushProvider(preferredProvider);
        }

        // Prefer the session's active provider — if the user is on xAI/Grok,
        // search should use xAI too rather than defaulting to OpenAI.
        if (authRouter && toolContext.agentId && toolContext.sessionId) {
          try {
            const active = await authRouter.resolve({
              agentId: toolContext.agentId,
              sessionId: toolContext.sessionId
            });
            pushProvider(normalizeSearchProvider(active.providerId));
          } catch {
            // No active auth profile in session; continue with fallback order.
          }
        }


        if (authRouter && toolContext.agentId && toolContext.sessionId) {
          for (const providerId of orderedProviders) {
            try {
              const resolved = await authRouter.resolve({
                agentId: toolContext.agentId,
                sessionId: toolContext.sessionId,
                pinnedProviderId: providerId
              });
              const token = extractToken(resolved.profile);
              if (!token) {
                continue;
              }

              // Use a search-capable default model unless explicitly overridden.
              // The active chat model may not support built-in web search tools.
              const modelId = requestedModelId ?? DEFAULT_SEARCH_MODELS[providerId];
              if (!modelSupportsSearch(providers?.get(providerId), modelId)) {
                continue;
              }

              return {
                providerId,
                apiKey: token,
                modelId,
                source: 'auth_profile'
              };
            } catch {
              // Provider/profile unavailable in this session. Try next option.
            }
          }
        }

        for (const providerId of orderedProviders) {
          const envToken = providerId === 'xai' ? process.env.XAI_API_KEY : process.env.OPENAI_API_KEY;
          if (!envToken) {
            continue;
          }

          const envModelId = requestedModelId
            ?? (providerId === 'xai'
              ? process.env.SLASHBOT_WEB_SEARCH_XAI_MODEL
              : process.env.SLASHBOT_WEB_SEARCH_OPENAI_MODEL)
            ?? DEFAULT_SEARCH_MODELS[providerId];

          if (!modelSupportsSearch(providers?.get(providerId), envModelId)) {
            continue;
          }

          return {
            providerId,
            apiKey: envToken,
            modelId: envModelId,
            source: 'environment'
          };
        }

        return {
          error:
            'No compatible web-search credentials found. Configure OpenAI/ChatGPT or xAI auth profile (or OPENAI_API_KEY / XAI_API_KEY).'
        };
      };

      context.registerTool({
        id: 'web.fetch',
        title: 'Fetch',
        pluginId: PLUGIN_ID,
        description: 'Fetch a URL and return its text content. Args: { url: string, prompt?: string }',
        timeoutMs: 30_000,
        parameters: z.object({
          url: z.string().describe('URL to fetch'),
          prompt: z.string().optional().describe('Optional prompt to prepend to content'),
        }),
        execute: async (args) => {
          try {
            const input = asObject(args);
            const url = asString(input.url, 'url');
            const userPrompt = typeof input.prompt === 'string' ? input.prompt : undefined;

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30_000);

            try {
              const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                  'User-Agent': 'Slashbot/0.1',
                  Accept: 'text/html, application/json, text/plain',
                },
              });

              if (!response.ok) {
                return {
                  ok: false,
                  error: { code: 'HTTP_ERROR', message: `HTTP ${response.status} from ${url}` },
                };
              }

              const contentType = response.headers.get('content-type') ?? '';
              const rawBody = await response.text();

              let content: string;
              if (contentType.includes('json')) {
                try {
                  content = JSON.stringify(JSON.parse(rawBody), null, 2);
                } catch {
                  content = rawBody;
                }
              } else if (contentType.includes('html')) {
                content = stripHtml(rawBody);
              } else {
                content = rawBody;
              }

              let truncated = false;
              if (content.length > MAX_CONTENT_LENGTH) {
                content = content.slice(0, MAX_CONTENT_LENGTH);
                truncated = true;
              }

              const result = `[Fetched from ${url}]\n\n${content}${truncated ? '\n\n[...truncated at 15K chars]' : ''}`;
              const finalResult = userPrompt ? `${userPrompt}\n\n${result}` : result;

              return { ok: true, output: finalResult };
            } finally {
              clearTimeout(timeout);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, error: { code: 'FETCH_ERROR', message } };
          }
        },
      });

      context.registerTool({
        id: 'web.search',
        title: 'Search',
        pluginId: PLUGIN_ID,
        description: 'Search the web using OpenAI/xAI-compatible models. Args: { query: string, provider?: "openai"|"xai", model?: string, allowedDomains?: string[], blockedDomains?: string[] }',
        timeoutMs: 30_000,
        parameters: z.object({
          query: z.string().describe('Search query'),
        }),
        execute: async (args, toolContext) => {
          try {
            const input = asObject(args);
            const query = asString(input.query, 'query');
            const preferredProvider = normalizeSearchProvider(input.provider);
            const requestedModelId = typeof input.model === 'string' && input.model.trim().length > 0
              ? input.model.trim()
              : undefined;
            const allowedDomains = asOptionalStringArray(input.allowedDomains);
            const blockedDomains = asOptionalStringArray(input.blockedDomains);

            const resolvedAuth = await resolveSearchCredentials(toolContext, preferredProvider, requestedModelId);
            if ('error' in resolvedAuth) {
              return {
                ok: false,
                error: { code: 'NO_COMPATIBLE_AUTH', message: resolvedAuth.error },
              };
            }

            const baseUrl = resolvedAuth.providerId === 'xai' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1';

            const toolTypeCandidates = DEFAULT_SEARCH_TOOL_TYPES[resolvedAuth.providerId] ?? ['web_search'];
            let lastError: { status: number; body: string; toolType: string } | null = null;

            for (const toolType of toolTypeCandidates) {
              const tools: Array<Record<string, unknown>> = [{ type: toolType }];
              if (resolvedAuth.providerId === 'xai') {
                if (allowedDomains) {
                  (tools[0] as Record<string, unknown>).allowed_domains = allowedDomains;
                }
                if (blockedDomains && !allowedDomains) {
                  (tools[0] as Record<string, unknown>).excluded_domains = blockedDomains;
                }
              }

              const response = await fetch(`${baseUrl}/responses`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${resolvedAuth.apiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: resolvedAuth.modelId,
                  instructions: 'Your very first word MUST be either USEFUL or NOT_USEFUL followed by a newline, then your answer. Use USEFUL when you found concrete data that answers the query. Use NOT_USEFUL when you could not find the specific information requested.',
                  input: query,
                  tools,
                }),
              });

              if (!response.ok) {
                const errBody = await response.text().catch(() => '');
                lastError = { status: response.status, body: errBody, toolType };
                continue;
              }

              const data = (await response.json()) as Record<string, unknown>;
              const rawContent = parseSearchOutput(data);

              // Parse the verdict prefix
              const match = rawContent.match(/^(USEFUL|NOT_USEFUL)\s*\n?([\s\S]*)$/i);
              const verdict = match?.[1]?.toUpperCase() ?? 'USEFUL';
              const content = (match?.[2] ?? rawContent).trim();

              if (verdict === 'USEFUL') {
                return { ok: true, output: content };
              }
              return {
                ok: false,
                error: { code: 'SEARCH_NOT_USEFUL', message: 'Web search did not return useful results for this query. Try web.fetch on a specific URL or use an appropriate skill instead.' },
                output: content,
              };
            }

            return {
              ok: false,
              error: {
                code: 'SEARCH_API_ERROR',
                message: `Search API failed via ${resolvedAuth.providerId}/${resolvedAuth.modelId}${lastError ? ` (tool=${lastError.toolType}, status=${lastError.status}): ${lastError.body}` : ''}`,
              },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, error: { code: 'SEARCH_ERROR', message } };
          }
        },
      });

      // Tool descriptions are self-explanatory; no extra prompt section needed.
    },
  };
}

export { createWebToolsPlugin as createPlugin };
