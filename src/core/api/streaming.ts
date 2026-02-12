/**
 * Streaming - Unified LLM response via Vercel AI SDK
 *
 * Uses streamText() with tool execute callbacks. The fullStream is consumed
 * only for real-time display control (spinner, tool-call logging). All data
 * extraction uses the AI SDK's normalized promise properties, keeping this
 * code fully provider-agnostic.
 */

import { streamText } from 'ai';
import { display } from '../ui';
import { cleanXmlTags } from '../utils/xml';
import type { ClientContext, StreamOptions, StreamResult } from './types';
import { getModelInfo, PROVIDERS } from '../../plugins/providers/models';

/**
 * Get a response from the LLM via Vercel AI SDK's streamText().
 */
export async function streamResponse(
  ctx: ClientContext,
  options?: StreamOptions,
): Promise<StreamResult> {
  const showThinking = options?.showThinking ?? true;
  const displayStream = options?.displayStream ?? true;
  const quiet = options?.quiet ?? false;
  const timeout = options?.timeout;
  const thinkingLabel = options?.thinkingLabel ?? 'Reticulating...';
  const outputTabId = options?.outputTabId || ctx.outputTabId;
  const withOutputTab = <T>(fn: () => T): T => display.withOutputTab(outputTabId, fn);

  if (ctx.authProvider.beforeRequest) {
    await ctx.authProvider.beforeRequest();
  }

  let responseContent = '';
  let thinkingContent = '';
  let finishReason: string | null = null;
  let hasToolCalls = false;
  let responseMessages: any[] = [];
  ctx.thinkingActive = true;

  ctx.abortController = new AbortController();
  ctx.onAbortControllerChange?.(ctx.abortController);

  let fetchTimeout: ReturnType<typeof setTimeout> | undefined;
  if (timeout) {
    fetchTimeout = setTimeout(() => ctx.abortController?.abort(), timeout);
  }

  // Always show spinner while waiting for API response
  if (!quiet) {
    withOutputTab(() => display.startThinking(thinkingLabel));
  }
  if (showThinking && !quiet) {
    withOutputTab(() => display.startThinkingStream());
  }

  const callNum = ++ctx.usage.requests;
  const startPromptTokens = ctx.usage.promptTokens;
  const startCompletionTokens = ctx.usage.completionTokens;

  // Log the prompt to CommPanel
  const lastMsg = ctx.sessionManager.history[ctx.sessionManager.history.length - 1];
  if (lastMsg) {
    let promptText = '';
    if (typeof lastMsg.content === 'string') {
      promptText = lastMsg.content;
    } else if (Array.isArray(lastMsg.content)) {
      const textPart = lastMsg.content.find((p: any) => p.type === 'text');
      promptText = textPart?.text || '';
    }
    if (promptText && !quiet) {
      withOutputTab(() => display.logPrompt(promptText));
    }
  }

  try {
    // Resolve model via provider registry
    const providerId = ctx.getProvider();
    const modelId = ctx.getModel();
    const model = ctx.providerRegistry.resolveModel(modelId, providerId);

    // Build messages for the AI SDK in CoreMessage format
    const messages: any[] = ctx.sessionManager.history.map(msg => {
      // Assistant messages with tool calls: reconstruct CoreAssistantMessage
      if (msg.role === 'assistant' && (msg as any)._toolCalls) {
        const parts: any[] = [];
        const text = typeof msg.content === 'string' ? msg.content : '';
        if (text) {
          parts.push({ type: 'text', text });
        }
        for (const tc of (msg as any)._toolCalls) {
          parts.push({
            type: 'tool-call',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: tc.args,
          });
        }
        return { role: 'assistant', content: parts };
      }
      // Legacy: _rawAIMessage from older history entries
      if ((msg as any)._rawAIMessage) {
        const raw = (msg as any)._rawAIMessage;
        if (raw.content && Array.isArray(raw.content)) {
          const hasTool = raw.content.some((p: any) => p.type === 'tool-call');
          if (hasTool) {
            return { role: 'assistant', content: raw.content };
          }
        }
        return { role: 'assistant', content: typeof msg.content === 'string' ? msg.content : '' };
      }
      // Tool-result messages
      if (msg.role === 'tool' && (msg as any).toolResults) {
        return {
          role: 'tool',
          content: (msg as any).toolResults.map((tr: any) => ({
            type: 'tool-result',
            toolCallId: tr.toolCallId,
            toolName: tr.toolName,
            output: { type: 'text', value: String(tr.result) },
          })),
        };
      }
      // Safety: tool messages without toolResults — convert to user role
      if (msg.role === 'tool') {
        const content = typeof msg.content === 'string' ? msg.content : '[tool output]';
        return { role: 'user', content: `<tool-output-summary>${content}</tool-output-summary>` };
      }
      if (typeof msg.content === 'string') {
        return { role: msg.role, content: msg.content };
      }
      // Multimodal messages
      const parts = (msg.content as any[]).map((part: any) => {
        if (part.type === 'text') {
          return { type: 'text' as const, text: part.text || '' };
        }
        if (part.type === 'image_url' && part.image_url?.url) {
          return { type: 'image' as const, image: part.image_url.url };
        }
        return { type: 'text' as const, text: '' };
      });
      return { role: msg.role, content: parts };
    });

    // Cap maxOutputTokens to the model's actual limit
    const modelInfo = getModelInfo(modelId);
    const providerInfo = PROVIDERS[providerId];
    const modelMaxOutput = modelInfo?.maxOutputTokens ?? providerInfo?.capabilities.maxOutputTokens;
    const maxOutputTokens = modelMaxOutput
      ? Math.min(ctx.config.maxTokens ?? modelMaxOutput, modelMaxOutput)
      : ctx.config.maxTokens;

    // Reasoning models reject temperature and maxOutputTokens
    const isReasoning = modelInfo?.reasoning ?? false;

    const streamParams: any = {
      model,
      messages,
      ...(!isReasoning && maxOutputTokens ? { maxOutputTokens } : {}),
      ...(!isReasoning ? { temperature: ctx.config.temperature } : {}),
      abortSignal: ctx.abortController.signal,
    };

    // Pass tools if provided (native AI SDK tool calling with execute callbacks)
    if (options?.tools && Object.keys(options.tools).length > 0) {
      streamParams.tools = options.tools;
      // maxSteps=1: AI SDK executes tools but doesn't loop back to LLM.
      streamParams.maxSteps = 1;
    }

    const stream = streamText(streamParams);

    // Consume fullStream only for real-time display control.
    // Data extraction uses AI SDK's normalized promise properties below.
    for await (const event of stream.fullStream) {
      const type = (event as any).type;

      // Stop spinner on first content event
      if (ctx.thinkingActive && (type === 'text-delta' || type === 'tool-call')) {
        withOutputTab(() => display.stopThinking());
        ctx.thinkingActive = false;
        if (showThinking && !quiet) {
          withOutputTab(() => display.endThinkingStream());
        }
      }

      if (type === 'tool-call') {
        hasToolCalls = true;
        if (!quiet) {
          withOutputTab(() => display.logAction((event as any).toolName));
        }
      }
    }

    // ===== Extract all data from AI SDK normalized promises =====

    responseContent = await stream.text;
    finishReason = await stream.finishReason;

    // Reasoning / thinking (provider-agnostic — AI SDK normalizes this)
    try {
      const reasoning = await (stream as any).reasoning;
      if (typeof reasoning === 'string' && reasoning) {
        thinkingContent = reasoning;
        if (showThinking && !quiet) {
          withOutputTab(() => display.streamThinkingChunk(reasoning));
        }
      }
    } catch {
      /* provider doesn't support reasoning */
    }

    // Response messages for history reconstruction
    const response = await stream.response;
    if (response?.messages) {
      responseMessages = response.messages;
    }
    if (!responseContent.trim() && responseMessages.length > 0) {
      const fallbackText = extractAssistantTextFromMessages(responseMessages);
      if (fallbackText) {
        responseContent = fallbackText;
      }
    }

    let resolvedUsage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    } | null = null;
    try {
      const usage = await (stream as any).usage;
      resolvedUsage = resolveUsage(usage);
    } catch {
      resolvedUsage = null;
    }
    if (!resolvedUsage) {
      resolvedUsage = resolveUsage((response as any)?.usage);
    }
    if (!resolvedUsage) {
      resolvedUsage = resolveUsage((response as any)?.providerMetadata?.usage);
    }
    if (!resolvedUsage) {
      resolvedUsage = resolveUsage((response as any)?.providerMetadata?.tokenUsage);
    }

    if (resolvedUsage) {
      ctx.usage.promptTokens += resolvedUsage.promptTokens;
      ctx.usage.completionTokens += resolvedUsage.completionTokens;
      ctx.usage.totalTokens += resolvedUsage.totalTokens;
    }

    // Tool calls — detect from resolved promise if not caught in stream events
    if (!hasToolCalls) {
      const toolCalls = await stream.toolCalls;
      if (toolCalls && toolCalls.length > 0) {
        hasToolCalls = true;
      }
    }

    // ===== Display =====

    if (responseContent) {
      ctx.rawOutputCallback?.(responseContent);
    }

    // Stop thinking indicators if still active
    if (ctx.thinkingActive) {
      withOutputTab(() => display.stopThinking());
      ctx.thinkingActive = false;
    }
    if (showThinking && !quiet) {
      withOutputTab(() => display.endThinkingStream());
    }

    // Display the full response
    if (displayStream && responseContent && !quiet) {
      let cleaned = cleanXmlTags(responseContent);
      cleaned = cleaned.replace(/^Assistant:\s*/gim, '');
      const normalized = cleaned.replace(/\n{3,}/g, '\n\n');
      const displayText = normalized
        .replace(/<session-actions>[\s\S]*?<\/session-actions>/gi, '')
        .replace(/^\[you\]\s*/gim, '')
        .trim();
      if (displayText) {
        if (!withOutputTab(() => display.renderAssistantTranscript(displayText))) {
          withOutputTab(() => display.renderMarkdown(displayText, true));
        }
        ctx.sessionManager.displayedContent = displayText;
      }
    }

    const deltaPrompt = ctx.usage.promptTokens - startPromptTokens;
    const deltaCompletion = ctx.usage.completionTokens - startCompletionTokens;
    const deltaTotal = Math.max(0, deltaPrompt + deltaCompletion);
    ctx.sessionManager.recordUsage({
      promptTokens: Math.max(0, deltaPrompt),
      completionTokens: Math.max(0, deltaCompletion),
      totalTokens: deltaTotal,
      requests: 1,
    });

    if (!quiet) {
      withOutputTab(() =>
        display.streamThinkingChunk(
          `\u{1F6EC} #${callNum} \u2190 ${deltaPrompt}p + ${deltaCompletion}c tokens\n`,
        ),
      );
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw error;
    }

    const msg = error.message || '';

    if (
      msg.includes('maximum prompt length') ||
      msg.includes('context_length_exceeded') ||
      msg.includes('max_tokens')
    ) {
      throw new Error(`maximum prompt length exceeded: ${msg}`);
    }
    throw new Error(`LLM API Error: ${msg}`);
  } finally {
    if (fetchTimeout) {
      clearTimeout(fetchTimeout);
    }
    if (ctx.thinkingActive) {
      withOutputTab(() => display.stopThinking());
      ctx.thinkingActive = false;
    }
    if (showThinking && !quiet) {
      withOutputTab(() => display.endThinkingStream());
    }
    ctx.abortController = null;
    ctx.onAbortControllerChange?.(null);
  }

  if (thinkingContent && !responseContent.trim() && !hasToolCalls) {
    withOutputTab(() =>
      display.warningText(
        `[Model produced thinking but no response (finish: ${finishReason}) - may need to retry]`,
      ),
    );
  }

  return {
    content: responseContent,
    thinking: thinkingContent,
    finishReason,
    hasToolCalls,
    responseMessages: responseMessages.length > 0 ? responseMessages : undefined,
  };
}

function extractAssistantTextFromMessages(messages: any[]): string {
  const text: string[] = [];
  for (const msg of messages) {
    if (msg?.role !== 'assistant') continue;

    if (typeof msg.content === 'string') {
      if (msg.content.trim()) text.push(msg.content);
      continue;
    }

    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        text.push(part.text);
      }
    }
  }
  return text.join('').trim();
}

function resolveUsage(usage: unknown): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} | null {
  if (!usage || typeof usage !== 'object') return null;
  const raw = usage as Record<string, unknown>;

  const promptTokens =
    pickNumber(raw, ['promptTokens', 'inputTokens', 'input_tokens', 'prompt_tokens']) ?? 0;
  const completionTokens =
    pickNumber(raw, ['completionTokens', 'outputTokens', 'output_tokens', 'completion_tokens']) ??
    0;
  const totalTokens = pickNumber(raw, ['totalTokens', 'total_tokens']);

  if (promptTokens <= 0 && completionTokens <= 0 && (!totalTokens || totalTokens <= 0)) {
    return null;
  }

  const resolvedTotal = Math.max(0, totalTokens ?? promptTokens + completionTokens);

  return {
    promptTokens: Math.max(0, promptTokens),
    completionTokens: Math.max(0, completionTokens),
    totalTokens: resolvedTotal,
  };
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}
