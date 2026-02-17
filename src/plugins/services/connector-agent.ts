import type { AgentMessage, LlmAdapter, LlmCompletionInput, RichMessage, StreamingCallback } from '@slashbot/core/agentic/llm/index.js';
import type { AgentLoopResult } from '@slashbot/core/agentic/agent-loop.js';
import type { ChatHistoryStore } from './chat-history-store.js';
import { FileChatHistoryStore } from './chat-history-store.js';
import { contentToText, estimateTokens, maybeSummarize, mimeTypeFromDataUrl, windowByTokenBudget } from './context-window.js';
export interface ConnectorAgentRunInput {
  prompt: string;
  sessionId: string;
  agentId: string;
  images?: string[];
}

type ConnectorAgentRunner = (input: ConnectorAgentRunInput) => Promise<string>;

/**
 * ConnectorAgentSession — manages per-chat LLM agent sessions for channel connectors.
 *
 * Accepts a pluggable ChatHistoryStore for conversation persistence.
 * Defaults to FileChatHistoryStore if a homeDir string is provided.
 */
export class ConnectorAgentSession {
  private readonly store: ChatHistoryStore;

  constructor(
    private readonly llm: LlmAdapter,
    private readonly promptAssembler: () => Promise<string>,
    storeOrHomeDir: ChatHistoryStore | string,
    private readonly runAgent?: ConnectorAgentRunner,
    private readonly contextBudget: number = 32000,
    private readonly maxResponseTokens?: number,
  ) {
    this.store = typeof storeOrHomeDir === 'string'
      ? new FileChatHistoryStore(storeOrHomeDir)
      : storeOrHomeDir;
  }

  async chat(
    chatId: string,
    text: string,
    opts?: { sessionId: string; agentId: string; images?: string[]; onToken?: (delta: string) => void; abortSignal?: AbortSignal },
  ): Promise<string> {
    const history = await this.store.get(chatId);

    const attachedImages = (opts?.images ?? []).slice(0, 4);
    const historyUserContent = attachedImages.length > 0
      ? `${text}\n\n[Images attached: ${attachedImages.length}]`
      : text;
    const sessionId = opts?.sessionId ?? `connector-${chatId}`;
    const agentId = opts?.agentId ?? 'connector-agent';

    // Load existing summary for this chat
    const existingSummary = await this.store.getSummary?.(chatId);

    // Token-budget windowing: reserve 80% of context budget for history
    const historyBudget = Math.floor(this.contextBudget * 0.8);
    const windowedHistory = windowByTokenBudget(history, historyBudget);
    const windowedLines = windowedHistory
      .map((entry) => `[${entry.role}] ${contentToText(entry.content)}`)
      .join('\n');

    // Prepend summary context if available
    const historyWindow = existingSummary
      ? `[Previous conversation summary: ${existingSummary}]\n\n${windowedLines}`
      : windowedLines;

    let response: string | undefined;
    if (this.runAgent) {
      try {
        const agenticPrompt = historyWindow.length > 0
          ? `Conversation history:\n${historyWindow}\n\nLatest user message:\n${text}`
          : text;
        response = await this.runAgent({
          prompt: agenticPrompt,
          sessionId,
          agentId,
          images: attachedImages.length > 0 ? attachedImages : undefined,
        });
      } catch {
        response = undefined;
      }
    }

    let toolCallCount = 0;
    let loopResult: AgentLoopResult | undefined;
    if (!response || response.trim().length === 0) {
      const systemPrompt = await this.promptAssembler();

      // Flatten history into the user message (2-message format).
      // Passing history as separate role-alternating messages causes models
      // to follow the text-only Q&A pattern from history and skip tool calls.
      // The 2-message format [system, user] keeps tool calling reliable.
      const historyContext = historyWindow.length > 0
        ? `Conversation history:\n${historyWindow}\n\nLatest message:\n`
        : '';

      const toolReminder = '[Use tools for any factual query — never fabricate output.]\n\n';
      const userTextWithHistory = `${toolReminder}${historyContext}${text}`;

      const currentUserContent: AgentMessage['content'] = attachedImages.length > 0
        ? [
          { type: 'text', text: `${userTextWithHistory}\n\nUse the attached image context in your response.` },
          ...attachedImages.map((image) => ({
            type: 'image' as const,
            image,
            mimeType: mimeTypeFromDataUrl(image),
          })),
        ]
        : userTextWithHistory;

      const messages: AgentMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: currentUserContent },
      ];

      const input: LlmCompletionInput = {
        sessionId,
        agentId,
        messages,
        abortSignal: opts?.abortSignal,
        maxTokens: this.maxResponseTokens,
      };

      if (opts?.onToken && this.llm.streamComplete) {
        response = await new Promise<string>((resolve, reject) => {
          const callback: StreamingCallback = {
            onToken: opts.onToken!,
            onComplete: (fullText) => resolve(fullText),
            onError: (error) => reject(error),
          };
          this.llm.streamComplete!(input, callback);
        });
      } else {
        const result = await this.llm.complete(input);
        response = result.text;
        toolCallCount = result.toolCalls;
        loopResult = result;
      }
    }

    // Persist rich history (with tool messages) when available
    if (this.store.appendRich && loopResult?.messages && loopResult.messages.length > 0) {
      const userMsg: RichMessage = { role: 'user', content: historyUserContent };
      await this.store.appendRich(chatId, [userMsg, ...loopResult.messages]);
    } else {
      // Store tool usage evidence in history so the model sees its own
      // tool-calling pattern in future conversations and doesn't drift
      // toward fabricating answers.
      const historyResponse = toolCallCount > 0
        ? `[I used ${toolCallCount} tool call(s) to answer this.]\n${response}`
        : response;

      await this.store.append(chatId, [
        { role: 'user', content: historyUserContent },
        { role: 'assistant', content: historyResponse },
      ]);
    }

    // Trigger summarization asynchronously (non-blocking)
    if (this.store.setSummary) {
      const storeRef = this.store;
      const llmRef = this.llm;
      const budgetRef = this.contextBudget;
      void (async () => {
        try {
          const currentHistory = await storeRef.get(chatId);
          const currentSummary = await storeRef.getSummary?.(chatId);
          const result = await maybeSummarize(
            currentHistory,
            budgetRef,
            currentSummary,
            llmRef,
            sessionId,
          );
          if (result) {
            await storeRef.setSummary!(chatId, result.summary);
            // Replace history with just the kept messages
            await storeRef.clear(chatId);
            if (result.keptMessages.length > 0) {
              await storeRef.append(chatId, result.keptMessages);
            }
          }
        } catch {
          // Summarization failure is non-fatal
        }
      })();
    }

    return response;
  }

  clearHistory(chatId: string): void {
    void this.store.clear(chatId);
  }

  async getHistoryLength(chatId: string): Promise<number> {
    return this.store.length(chatId);
  }
}

// Re-export for convenience
export type { ChatHistoryStore } from './chat-history-store.js';
export { FileChatHistoryStore, SessionChatHistoryStore } from './chat-history-store.js';
