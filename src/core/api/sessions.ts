/**
 * SessionManager - Multi-channel conversation session management
 */

import { display } from '../ui';
import { LRUCache } from './utils';
import type { Message } from './types';

/**
 * Session data for multi-channel conversation support
 */
export interface ConversationSession {
  history: Message[];
  fileContextCache: LRUCache<string, string>;
  displayedContent: string;
  lastActivity: number;
}

/**
 * Interface for session access used by the agentic loop and streaming.
 * ScopedSession implements this, pinned to a specific session ID —
 * eliminating the currentSessionId race condition for concurrent requests.
 */
export interface SessionScope {
  history: Message[];
  readonly fileContextCache: LRUCache<string, string>;
  displayedContent: string;
  compressContext(): void;
  condenseHistory(): string;
}

/**
 * A session handle pinned to a specific session ID.
 * Each concurrent request (Telegram chat, Discord channel) gets its own ScopedSession
 * so they never interfere with each other via shared currentSessionId.
 */
export class ScopedSession implements SessionScope {
  private session: ConversationSession;

  constructor(private manager: SessionManager, sessionId: string) {
    this.session = manager.ensureSession(sessionId);
  }

  get history(): Message[] {
    return this.session.history;
  }

  set history(h: Message[]) {
    this.session.history = h;
  }

  get fileContextCache(): LRUCache<string, string> {
    return this.session.fileContextCache;
  }

  get displayedContent(): string {
    return this.session.displayedContent;
  }

  set displayedContent(content: string) {
    this.session.displayedContent = content;
  }

  compressContext(): void {
    if (!this.manager.isContextCompressionEnabled()) return;
    const maxCtx = this.manager.getMaxContextMessages();
    const systemPrompt = this.history[0];
    const messages = this.history.slice(1);
    if (messages.length <= maxCtx) return;
    let cutIdx = messages.length - maxCtx;
    if (cutIdx > 0 && messages[cutIdx]?.role === 'tool') {
      cutIdx--;
    }
    const recentMessages = messages.slice(cutIdx);
    this.history = [systemPrompt, ...recentMessages];
    display.muted(`[Context] Compressed: ${messages.length} \u2192 ${recentMessages.length} messages`);
  }

  condenseHistory(): string {
    const messages = this.history.slice(1);
    let summary = 'Conversation Summary:\n';
    const userMessages: string[] = [];
    const actions: string[] = [];
    for (const msg of messages) {
      if (msg.role === 'user') {
        const content =
          typeof msg.content === 'string' ? msg.content : msg.content?.[0]?.text || '';
        if (
          content &&
          !content.includes('<session-actions>') &&
          !content.includes('<system-instruction>')
        ) {
          userMessages.push(content.split('\n')[0]);
        }
      } else if (msg.role === 'assistant') {
        const contentStr = typeof msg.content === 'string' ? msg.content : '';
        const actionMatches = contentStr.match(
          /<(bash|read|edit|write|grep|explore)\b[^>]*>/g,
        );
        if (actionMatches) {
          actions.push(...actionMatches.slice(0, 3));
        }
      } else if (msg.role === 'tool') {
        const toolResults = (msg as any).toolResults as Array<{ toolName: string }> | undefined;
        if (toolResults) {
          actions.push(...toolResults.map(r => r.toolName).slice(0, 3));
        }
      }
    }
    if (userMessages.length > 0) {
      summary += `User requests: ${userMessages.slice(-5).join('; ')}\n`;
    }
    if (actions.length > 0) {
      summary += `Actions performed: ${actions.slice(-5).join(', ')}\n`;
    }
    summary += `Total messages: ${messages.length}\n`;
    summary += 'Please continue from this point.';
    return summary;
  }
}

export class SessionManager {
  private sessions = new Map<string, ConversationSession>();
  private currentSessionId: string = 'cli';
  private contextCompressionEnabled: boolean = true;
  private maxContextMessages: number = 200;
  private maxSessions: number = 50;

  constructor(private buildSystemPrompt: () => string) {
    // Initialize default CLI session
    this.createSession('cli');
  }

  // ===== Session lifecycle =====

  /**
   * Switch to a different conversation session (legacy — prefer scoped())
   */
  setSession(sessionId: string): void {
    this.currentSessionId = sessionId;
    this.ensureSession(sessionId);
  }

  getSessionId(): string {
    return this.currentSessionId;
  }

  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Create a ScopedSession pinned to a specific session ID.
   * Use this for concurrent request handling (Telegram, Discord).
   */
  scoped(sessionId: string): ScopedSession {
    return new ScopedSession(this, sessionId);
  }

  /**
   * Get or create a session by ID. Public for ScopedSession access.
   */
  ensureSession(sessionId: string): ConversationSession {
    return this.getSession(sessionId);
  }

  clearSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.history = [
        {
          role: 'system',
          content: this.buildSystemPrompt(),
        },
      ];
      session.fileContextCache.clear();
      session.displayedContent = '';
    }
  }

  deleteSession(sessionId: string): boolean {
    if (sessionId === 'cli') return false;
    return this.sessions.delete(sessionId);
  }

  // ===== Current session accessors =====

  get history(): Message[] {
    return this.getSession(this.currentSessionId).history;
  }

  set history(h: Message[]) {
    const session = this.getSession(this.currentSessionId);
    session.history = h;
  }

  get fileContextCache(): LRUCache<string, string> {
    return this.getSession(this.currentSessionId).fileContextCache;
  }

  get displayedContent(): string {
    return this.getSession(this.currentSessionId).displayedContent;
  }

  set displayedContent(content: string) {
    const session = this.getSession(this.currentSessionId);
    session.displayedContent = content;
  }

  // ===== History operations =====

  clearHistory(): void {
    this.history = [this.history[0]];
    this.fileContextCache.clear();
  }

  getHistory(): Message[] {
    return [...this.history];
  }

  addMessage(msg: Message): void {
    this.history.push(msg);
  }

  // ===== Context compression =====

  setContextCompression(enabled: boolean, maxMessages?: number): void {
    this.contextCompressionEnabled = enabled;
    if (maxMessages) this.maxContextMessages = maxMessages;
  }

  isContextCompressionEnabled(): boolean {
    return this.contextCompressionEnabled;
  }

  getMaxContextMessages(): number {
    return this.maxContextMessages;
  }

  compressContext(): void {
    if (!this.contextCompressionEnabled) return;

    const systemPrompt = this.history[0];
    const messages = this.history.slice(1);

    if (messages.length <= this.maxContextMessages) return;

    // Find a safe cut point that doesn't split assistant+tool pairs
    let cutIdx = messages.length - this.maxContextMessages;
    // If the message at the cut point is a tool-result, include its preceding assistant message
    if (cutIdx > 0 && messages[cutIdx]?.role === 'tool') {
      cutIdx--;
    }

    const recentMessages = messages.slice(cutIdx);
    this.history = [systemPrompt, ...recentMessages];

    display.muted(`[Context] Compressed: ${messages.length} \u2192 ${recentMessages.length} messages`);
  }

  condenseHistory(): string {
    const messages = this.history.slice(1);
    let summary = 'Conversation Summary:\n';

    const userMessages: string[] = [];
    const actions: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        const content =
          typeof msg.content === 'string' ? msg.content : msg.content?.[0]?.text || '';
        if (
          content &&
          !content.includes('<session-actions>') &&
          !content.includes('<system-instruction>')
        ) {
          userMessages.push(content.split('\n')[0]);
        }
      } else if (msg.role === 'assistant') {
        const contentStr = typeof msg.content === 'string' ? msg.content : '';
        // Extract XML action tags
        const actionMatches = contentStr.match(
          /<(bash|read|edit|write|grep|explore)\b[^>]*>/g,
        );
        if (actionMatches) {
          actions.push(...actionMatches.slice(0, 3));
        }
      } else if (msg.role === 'tool') {
        // Extract tool names from tool-result messages
        const toolResults = (msg as any).toolResults as Array<{ toolName: string }> | undefined;
        if (toolResults) {
          actions.push(...toolResults.map(r => r.toolName).slice(0, 3));
        }
      }
    }

    if (userMessages.length > 0) {
      summary += `User requests: ${userMessages.slice(-5).join('; ')}\n`;
    }

    if (actions.length > 0) {
      summary += `Actions performed: ${actions.slice(-5).join(', ')}\n`;
    }

    summary += `Total messages: ${messages.length}\n`;
    summary += 'Please continue from this point.';

    return summary;
  }

  getContextSize(): number {
    return this.history.length;
  }

  estimateTokens(): number {
    return Math.ceil(
      this.history.reduce((sum, m) => {
        if (typeof m.content === 'string') return sum + m.content.length;
        if (Array.isArray(m.content)) {
          return sum + m.content.reduce((s: number, p: any) => s + (p.text?.length || 100), 0);
        }
        // Estimate tokens for tool-result messages
        const toolResults = (m as any).toolResults;
        if (toolResults && Array.isArray(toolResults)) {
          return sum + toolResults.reduce((s: number, r: any) => s + (r.result?.length || 50), 0);
        }
        return sum;
      }, 0) / 4,
    );
  }

  // ===== LLM-Powered Compaction =====

  /**
   * Check if compaction is needed based on token estimate vs model limit
   */
  needsCompaction(modelMaxTokens: number = 256000, thresholdRatio: number = 0.8): boolean {
    const tokens = this.estimateTokens();
    return tokens > modelMaxTokens * thresholdRatio;
  }

  /**
   * Prune old tool outputs from history, keeping recent ones intact.
   * Handles both XML action-output messages and native tool-result messages.
   */
  pruneOldToolOutputs(protectLastN: number = 10): void {
    const systemPrompt = this.history[0];
    const messages = this.history.slice(1);

    // Count prunable messages (action-output XML and tool-result messages)
    const isToolOutput = (m: Message) =>
      (typeof m.content === 'string' && m.content.includes('<action-output>')) ||
      m.role === 'tool';
    const totalToolOutputs = messages.filter(isToolOutput).length;

    // Track which indices are being pruned (tool messages converted to user)
    const prunedToolIndices = new Set<number>();
    let toolOutputCount = 0;
    const pruned = messages.map((m, idx) => {
      if (!isToolOutput(m)) return m;

      toolOutputCount++;
      // Protect last N tool outputs
      if (totalToolOutputs - toolOutputCount < protectLastN) {
        return m;
      }

      // Prune: for tool messages, convert to user role with compact summary
      // (AI SDK requires tool messages to have structured toolResults, not plain strings)
      if (m.role === 'tool') {
        prunedToolIndices.add(idx);
        const toolResults = (m as any).toolResults as Array<{ toolName: string; result: string }> | undefined;
        const summary = toolResults
          ? `[${toolResults.length} tool results: ${toolResults.map(r => r.toolName).join(', ')}]`
          : '[pruned tool results]';
        return { role: 'user' as const, content: `<tool-output-summary>${summary}</tool-output-summary>` };
      }

      // XML action-output pruning
      const content = typeof m.content === 'string' ? m.content : '';
      const actionMatches = content.match(/\[[\u2713\u2717]\]\s*\w+:/g) || [];
      const summary = actionMatches.length > 0
        ? `<action-output>[${actionMatches.length} actions: ${actionMatches.slice(0, 3).join(', ')}...]</action-output>`
        : '<action-output>[pruned]</action-output>';
      return { ...m, content: summary };
    });

    // Strip _toolCalls/_rawAIMessage from assistant messages whose tool-result was pruned
    for (const idx of prunedToolIndices) {
      if (idx > 0 && pruned[idx - 1]?.role === 'assistant') {
        const prev = pruned[idx - 1] as any;
        delete prev._toolCalls;
        delete prev._rawAIMessage;
      }
    }

    this.history = [systemPrompt, ...pruned];
    const prunedCount = Math.max(0, totalToolOutputs - protectLastN);
    if (prunedCount > 0) {
      display.muted(`[Compaction] Pruned ${prunedCount} old tool outputs`);
    }
  }

  /**
   * Perform full compaction: prune + replace old history with summary.
   * The summary is a structured condensation of the conversation.
   */
  compact(summary: string): void {
    const systemPrompt = this.history[0];
    const recentCount = 20;
    const messages = this.history.slice(1);

    // Keep recent messages intact
    const recentMessages = messages.slice(-recentCount);

    // Replace old history with the LLM-generated summary
    this.history = [
      systemPrompt,
      {
        role: 'user' as const,
        content: `<session-summary>\nThe following is a summary of the conversation so far:\n\n${summary}\n\nContinue from this point. The recent messages below provide current context.\n</session-summary>`,
      },
      ...recentMessages,
    ];

    display.muted(
      `[Compaction] Compressed ${messages.length} messages → 1 summary + ${recentMessages.length} recent`,
    );
  }

  /**
   * Build a compaction prompt from current history for the LLM to summarize
   */
  buildCompactionPrompt(): string {
    const messages = this.history.slice(1);
    const oldMessages = messages.slice(0, -20);

    if (oldMessages.length === 0) return '';

    let prompt = 'Summarize the following conversation concisely. Focus on:\n';
    prompt += '1. What the user requested\n';
    prompt += '2. What actions were taken and their results\n';
    prompt += '3. What files were read/modified\n';
    prompt += '4. Any unresolved issues or pending work\n\n';
    prompt += 'Conversation to summarize:\n\n';

    for (const msg of oldMessages) {
      const role = msg.role.toUpperCase();
      const content = typeof msg.content === 'string'
        ? msg.content.slice(0, 500)
        : '[multimodal content]';
      prompt += `${role}: ${content}\n\n`;
    }

    return prompt;
  }

  // ===== System prompt rebuild =====

  rebuildAllSessionPrompts(newPrompt: string): void {
    for (const session of this.sessions.values()) {
      if (session.history.length > 0 && session.history[0].role === 'system') {
        session.history[0].content = newPrompt;
      }
    }
  }

  // ===== Private helpers =====

  private createSession(sessionId: string): ConversationSession {
    // Evict oldest session if at capacity
    if (this.sessions.size >= this.maxSessions) {
      let oldestId: string | null = null;
      let oldestTime = Infinity;
      for (const [id, session] of this.sessions) {
        if (id !== 'cli' && session.lastActivity < oldestTime) {
          oldestTime = session.lastActivity;
          oldestId = id;
        }
      }
      if (oldestId) {
        this.sessions.delete(oldestId);
      }
    }

    const session: ConversationSession = {
      history: [
        {
          role: 'system',
          content: this.buildSystemPrompt(),
        },
      ],
      fileContextCache: new LRUCache<string, string>(50),
      displayedContent: '',
      lastActivity: Date.now(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  private getSession(sessionId: string): ConversationSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = this.createSession(sessionId);
    }
    session.lastActivity = Date.now();
    return session;
  }
}
