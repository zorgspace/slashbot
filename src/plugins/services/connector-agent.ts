import type { AgentMessage, LlmAdapter, LlmCompletionInput, StreamingCallback } from '../../core/agentic/llm/index.js';
import type { ChatHistoryStore } from './chat-history-store.js';
import { FileChatHistoryStore } from './chat-history-store.js';
import { contentToText, estimateTokens, mimeTypeFromDataUrl, windowByTokenBudget } from './context-window.js';

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

    // Token-budget windowing: reserve 80% of context budget for history
    const historyBudget = Math.floor(this.contextBudget * 0.8);
    const windowedHistory = windowByTokenBudget(history, historyBudget);
    const historyWindow = windowedHistory
      .map((entry) => `[${entry.role}] ${contentToText(entry.content)}`)
      .join('\n');

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

    if (!response || response.trim().length === 0) {
      const systemPrompt = await this.promptAssembler();

      const currentUserContent: AgentMessage['content'] = attachedImages.length > 0
        ? [
          { type: 'text', text: `${text}\n\nUse the attached image context in your response.` },
          ...attachedImages.map((image) => ({
            type: 'image' as const,
            image,
            mimeType: mimeTypeFromDataUrl(image),
          })),
        ]
        : text;

      const systemTokens = estimateTokens(systemPrompt);
      const remainingBudget = Math.max(1000, this.contextBudget - systemTokens);
      const llmWindowedHistory = windowByTokenBudget(history, Math.floor(remainingBudget * 0.8));
      const messages: AgentMessage[] = [
        { role: 'system', content: systemPrompt },
        ...llmWindowedHistory,
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
      }
    }

    await this.store.append(chatId, [
      { role: 'user', content: historyUserContent },
      { role: 'assistant', content: response },
    ]);

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
export { FileChatHistoryStore } from './chat-history-store.js';
