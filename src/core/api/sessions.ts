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
   * Switch to a different conversation session
   */
  setSession(sessionId: string): void {
    this.currentSessionId = sessionId;
    this.getSession(sessionId);
  }

  getSessionId(): string {
    return this.currentSessionId;
  }

  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
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

    const recentMessages = messages.slice(-this.maxContextMessages);
    this.history = [systemPrompt, ...recentMessages];

    display.muted(`[Context] Compressed: ${messages.length} → ${recentMessages.length} messages`);
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
        const actionMatches = (msg.content as string).match(
          /<(bash|read|edit|write|grep|explore)\b[^>]*>/g,
        );
        if (actionMatches) {
          actions.push(...actionMatches.slice(0, 3));
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
    return Math.ceil(this.history.reduce((sum, m) => sum + m.content.length, 0) / 4);
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
