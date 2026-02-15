import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ConnectorAgentSession } from '../src/plugins/services/connector-agent.js';
class FakeLlm {
    calls = [];
    async complete(input) {
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
            const messages = firstCall.messages.map((m) => ({ role: m.role, content: m.content }));
            expect(messages).toEqual([
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'hello' },
                { role: 'assistant', content: 'reply-1' },
                { role: 'user', content: 'again' },
            ]);
        }
        finally {
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
            const parts = userMessage.content;
            expect(parts[0]).toMatchObject({ type: 'text' });
            expect(parts[1]).toMatchObject({ type: 'image', image, mimeType: 'image/png' });
            await session.chat('tg:private:99', 'follow up', { sessionId: 's2', agentId: 'a2' });
            const secondCall = llm.calls[1];
            const historyUserEntry = secondCall.messages.find((m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[Images attached: 1]'));
            expect(historyUserEntry).toBeDefined();
        }
        finally {
            await rm(tempHome, { recursive: true, force: true });
        }
    });
    test('uses agentic runner when available and carries conversation history in prompt', async () => {
        const tempHome = await mkdtemp(join(tmpdir(), 'slashbot-connector-agentic-'));
        const homeDir = join(tempHome, '.slashbot');
        try {
            const llm = new FakeLlm();
            const prompts = [];
            const session = new ConnectorAgentSession(llm, async () => 'system prompt', homeDir, async (input) => {
                prompts.push(input.prompt);
                return `agentic-${prompts.length}`;
            });
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
        }
        finally {
            await rm(tempHome, { recursive: true, force: true });
        }
    });
});
