import { describe, expect, it, vi } from 'vitest';
import { executeSessionsHistory, executeSessionsSend } from './executors';

vi.mock('../../core/ui', () => ({
  display: {
    appendAssistantMessage: vi.fn(),
  },
  formatToolAction: vi.fn(() => 'tool-action'),
}));

describe('session executors', () => {
  it('caps sessions_history payload size', async () => {
    const huge = 'x'.repeat(4_000);
    const handlers: any = {
      onSessionsHistory: vi.fn(async () =>
        Array.from({ length: 64 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `${i}:${huge}`,
        })),
      ),
    };

    const result = await executeSessionsHistory(
      {
        type: 'sessions-history',
        sessionId: 'agent:test',
      },
      handlers,
    );

    expect(result?.success).toBe(true);
    expect(result?.result.length).toBeLessThanOrEqual(12_500);
    expect(result?.result).toContain('truncated: output capped');
  });

  it('does not echo delegated session response into caller output', async () => {
    const handlers: any = {
      onSessionsSend: vi.fn(async () => ({
        delivered: true,
        response: 'worker full output should not leak here',
      })),
    };

    const result = await executeSessionsSend(
      {
        type: 'sessions-send',
        sessionId: 'agent:worker',
        message: 'Fix issue',
        run: true,
      },
      handlers,
    );

    expect(result?.success).toBe(true);
    expect(result?.result).toBe('Delivered and executed in target session.');
    expect(result?.result).not.toContain('worker full output should not leak here');
  });
});
