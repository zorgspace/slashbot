import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ConnectorAgentSession } from '../src/plugins/services/connector-agent.js';
import type { LlmAdapter, LlmCompletionInput } from '../src/core/agentic/llm/index.js';
import type { AgentLoopResult } from '../src/core/agentic/llm/types.js';

class FakeLlm implements LlmAdapter {
  readonly calls: LlmCompletionInput[] = [];

  async complete(input: LlmCompletionInput): Promise<AgentLoopResult> {
    this.calls.push(input);
    return { text: `reply-${this.calls.length}`, steps: 1, toolCalls: 0, finishReason: 'stop' };
  }
}

describe('connector agent history persistence', () => {
  test('rehydrates connector chat history after restart', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-connector-history-'));
    const homeDir = join(tempHome, '.slashbot');

    try {
      const firstLlm = new FakeLlm();
      const firstSession = new ConnectorAgentSession(firstLlm, async () => 'system prompt', homeDir);
      await firstSession.chat('tg:private:42', 'hello', { sessionId: 's1', agentId: 'a1' });

      const secondLlm = new FakeLlm();
      const secondSession = new ConnectorAgentSession(secondLlm, async () => 'system prompt', homeDir);
      await secondSession.chat('tg:private:42', 'again', { sessionId: 's1', agentId: 'a1' });

      const firstCall = secondLlm.calls[0];
      expect(firstCall).toBeDefined();
      const messages = firstCall.messages;

      // ConnectorAgentSession uses a 2-message format: [system, user]
      // The user message contains conversation history + latest message
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toBe('system prompt');
      expect(messages[1].role).toBe('user');
      const userContent = String(messages[1].content);
      expect(userContent).toContain('hello');
      expect(userContent).toContain('reply-1');
      expect(userContent).toContain('again');
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('sends attached images to llm input while keeping persisted history compact', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-connector-images-'));
    const homeDir = join(tempHome, '.slashbot');

    try {
      const llm = new FakeLlm();
      const session = new ConnectorAgentSession(llm, async () => 'system prompt', homeDir);
      const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

      await session.chat('tg:private:99', 'What is in this image?', {
        sessionId: 's2',
        agentId: 'a2',
        images: [image],
      });

      const firstCall = llm.calls[0];
      expect(firstCall).toBeDefined();
      expect(firstCall.messages).toHaveLength(2);

      const userMessage = firstCall.messages[1];
      expect(userMessage.role).toBe('user');
      expect(Array.isArray(userMessage.content)).toBe(true);
      const parts = userMessage.content as Array<{ type: string; text?: string; image?: string; mimeType?: string }>;
      expect(parts[0]).toMatchObject({ type: 'text' });
      expect(parts[1]).toMatchObject({ type: 'image', image, mimeType: 'image/png' });

      await session.chat('tg:private:99', 'follow up', { sessionId: 's2', agentId: 'a2' });
      const secondCall = llm.calls[1];
      const historyUserEntry = secondCall.messages.find((m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[Images attached: 1]'));
      expect(historyUserEntry).toBeDefined();
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('uses agentic runner when available and carries conversation history in prompt', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-connector-agentic-'));
    const homeDir = join(tempHome, '.slashbot');

    try {
      const llm = new FakeLlm();
      const prompts: string[] = [];
      const session = new ConnectorAgentSession(
        llm,
        async () => 'system prompt',
        homeDir,
        async (input) => {
          prompts.push(input.prompt);
          return `agentic-${prompts.length}`;
        },
      );

      const first = await session.chat('tg:private:77', 'What is the weather in SF?', {
        sessionId: 's3',
        agentId: 'a3',
      });
      expect(first).toBe('agentic-1');
      expect(llm.calls).toHaveLength(0);
      expect(prompts[0]).toContain('What is the weather in SF?');

      const second = await session.chat('tg:private:77', 'and tomorrow?', {
        sessionId: 's3',
        agentId: 'a3',
      });
      expect(second).toBe('agentic-2');
      expect(llm.calls).toHaveLength(0);
      expect(prompts[1]).toContain('[assistant] agentic-1');
      expect(prompts[1]).toContain('Latest user message:\nand tomorrow?');
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('clearHistory resets chat state', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-connector-clear-'));
    const homeDir = join(tempHome, '.slashbot');

    try {
      const llm = new FakeLlm();
      const session = new ConnectorAgentSession(llm, async () => 'system prompt', homeDir);
      await session.chat('chat1', 'before clear', { sessionId: 's', agentId: 'a' });
      session.clearHistory('chat1');
      await session.chat('chat1', 'after clear', { sessionId: 's', agentId: 'a' });

      const lastCall = llm.calls[llm.calls.length - 1];
      const userContent = String(lastCall.messages[lastCall.messages.length - 1].content);
      // Should NOT contain the message from before clear
      expect(userContent).not.toContain('before clear');
      expect(userContent).toContain('after clear');
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('getHistoryLength returns correct count', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-connector-len-'));
    const homeDir = join(tempHome, '.slashbot');

    try {
      const llm = new FakeLlm();
      const session = new ConnectorAgentSession(llm, async () => 'system prompt', homeDir);
      expect(await session.getHistoryLength('chat1')).toBe(0);
      await session.chat('chat1', 'hello', { sessionId: 's', agentId: 'a' });
      expect(await session.getHistoryLength('chat1')).toBeGreaterThan(0);
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('multiple chatIds are isolated', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-connector-iso-'));
    const homeDir = join(tempHome, '.slashbot');

    try {
      const llm = new FakeLlm();
      const session = new ConnectorAgentSession(llm, async () => 'system prompt', homeDir);
      await session.chat('chat-a', 'msg for A', { sessionId: 's', agentId: 'a' });
      await session.chat('chat-b', 'msg for B', { sessionId: 's', agentId: 'a' });

      // Third call to chat-a should not include chat-b history
      await session.chat('chat-a', 'follow up A', { sessionId: 's', agentId: 'a' });
      const lastCall = llm.calls[llm.calls.length - 1];
      const userContent = String(lastCall.messages[lastCall.messages.length - 1].content);
      expect(userContent).toContain('msg for A');
      expect(userContent).not.toContain('msg for B');
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  test('multiple images included in parts array', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-connector-multiimg-'));
    const homeDir = join(tempHome, '.slashbot');

    try {
      const llm = new FakeLlm();
      const session = new ConnectorAgentSession(llm, async () => 'system prompt', homeDir);
      const images = [
        'data:image/png;base64,img1',
        'data:image/jpeg;base64,img2',
        'data:image/png;base64,img3',
      ];

      await session.chat('chat1', 'Look at these images', {
        sessionId: 's',
        agentId: 'a',
        images,
      });

      const call = llm.calls[0];
      const userMsg = call.messages[call.messages.length - 1];
      expect(Array.isArray(userMsg.content)).toBe(true);
      const parts = userMsg.content as Array<{ type: string }>;
      const imageParts = parts.filter(p => p.type === 'image');
      expect(imageParts.length).toBe(3);
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});
