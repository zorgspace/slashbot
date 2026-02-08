/**
 * Streaming - Unified SSE streaming for both CLI and connector modes
 */

import { display } from '../ui';
import { cleanXmlTags, cleanSelfDialogue } from '../utils/xml';
import { getRegisteredTags } from '../utils/tagRegistry';
import type { ClientContext, StreamOptions, StreamResult } from './types';

/**
 * Stream a response from the API, handling thinking/reasoning and content display.
 */
export async function streamResponse(
  ctx: ClientContext,
  options?: StreamOptions,
): Promise<StreamResult> {
  const showThinking = options?.showThinking ?? true;
  const displayStream = options?.displayStream ?? true;
  const timeout = options?.timeout;
  const thinkingLabel = options?.thinkingLabel ?? 'Thinking...';

  if (ctx.authProvider.beforeRequest) {
    await ctx.authProvider.beforeRequest();
  }

  if (displayStream) {
    console.log();
  }

  const requestBody: Record<string, unknown> = {
    model: ctx.getModel(),
    messages: ctx.sessionManager.history,
    max_tokens: ctx.config.maxTokens,
    temperature: ctx.config.temperature,
    stream: true,
  };

  let responseContent = '';
  let thinkingContent = '';
  let buffer = '';
  let finishReason: string | null = null;
  ctx.thinkingActive = true;
  let firstChunk = true;
  let thinkingStreamStarted = false;

  ctx.abortController = new AbortController();

  let fetchTimeout: ReturnType<typeof setTimeout> | undefined;
  if (timeout) {
    fetchTimeout = setTimeout(() => ctx.abortController?.abort(), timeout);
  }

  // Always show spinner while waiting for API response
  display.startThinking(thinkingLabel);
  if (showThinking) {
    display.startThinkingStream();
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
    if (promptText) {
      display.logPrompt(promptText);
    }
  }

  try {
    const requestBodyJson = JSON.stringify(requestBody);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...ctx.authProvider.getHeaders(requestBodyJson),
    };

    const response = await fetch(ctx.authProvider.getEndpoint(), {
      method: 'POST',
      headers,
      body: requestBodyJson,
      signal: ctx.abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Grok API Error: ${response.status} - ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);

          if (ctx.authProvider.onStreamChunk) {
            ctx.authProvider.onStreamChunk(parsed);
          }

          const choice = parsed.choices?.[0];
          const delta = choice?.delta;
          const content = delta?.content;

          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }

          if (parsed.usage) {
            ctx.usage.promptTokens += parsed.usage.prompt_tokens || 0;
            ctx.usage.completionTokens += parsed.usage.completion_tokens || 0;
            ctx.usage.totalTokens += parsed.usage.total_tokens || 0;
          }

          if (delta?.reasoning_content) {
            if (!thinkingStreamStarted) {
              thinkingStreamStarted = true;
            }
            thinkingContent += delta.reasoning_content;
            if (showThinking) {
              display.streamThinkingChunk(delta.reasoning_content);
            }
          }

          if (content) {
            responseContent += content;

            ctx.rawOutputCallback?.(content);

            if (displayStream) {
              const tagAlt = getRegisteredTags().join('|');
              const openTags = (
                responseContent.match(new RegExp(`<(${tagAlt})\\b[^>]*>`, 'gi')) || []
              ).length;
              const closeTags = (
                responseContent.match(new RegExp(`</(${tagAlt})>|/>`, 'gi')) || []
              ).length;
              const hasUnclosedTag = openTags > closeTags;
              const partialTagMatch = responseContent.match(/<[a-z-]*$/i);
              const hasPartialTag = partialTagMatch !== null;

              if (!hasUnclosedTag && !hasPartialTag) {
                let cleanFull = cleanSelfDialogue(cleanXmlTags(responseContent));
                cleanFull = cleanFull.replace(/^Assistant:\s*/gim, '');
                const normalized = cleanFull.replace(/\n{3,}/g, '\n\n');
                const newContent = normalized.slice(ctx.sessionManager.displayedContent.length);
                if (newContent && newContent.trim()) {
                  const isDuplicate = ctx.sessionManager.displayedContent.includes(
                    newContent.trim(),
                  );
                  if (!isDuplicate) {
                    if (firstChunk) {
                      if (ctx.thinkingActive) {
                        display.stopThinking();
                        ctx.thinkingActive = false;
                      }
                      if (showThinking) {
                        display.endThinkingStream();
                      }
                      firstChunk = false;
                    }
                    ctx.sessionManager.displayedContent = normalized;
                  }
                }
              }
            } else {
              if (ctx.thinkingActive) {
                display.stopThinking();
                ctx.thinkingActive = false;
              }
            }
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    const deltaPrompt = ctx.usage.promptTokens - startPromptTokens;
    const deltaCompletion = ctx.usage.completionTokens - startCompletionTokens;

    display.streamThinkingChunk(
      `🛬 #${callNum} ← ${deltaPrompt}p + ${deltaCompletion}c tokens\n`,
    );
  } finally {
    if (fetchTimeout) {
      clearTimeout(fetchTimeout);
    }
    if (ctx.thinkingActive) {
      display.stopThinking();
      ctx.thinkingActive = false;
    }
    if (showThinking) {
      display.endThinkingStream();
    }
    ctx.abortController = null;
  }

  if (thinkingContent && !responseContent.trim()) {
    display.warningText('[Model produced thinking but no response - may need to retry]');
  }

  return { content: responseContent, thinking: thinkingContent, finishReason };
}
