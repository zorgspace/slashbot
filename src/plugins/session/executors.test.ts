import { describe, expect, it, vi } from 'vitest';
import { executeSessionsHistory, executeSessionsSend } from './executors';
import { display, formatToolAction } from '../../core/ui';

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

  it('surfaces delivery failures from sessions_send', async () => {
    const handlers: any = {
      onSessionsSend: vi.fn(async () => ({
        delivered: false,
        error: 'Session "ghost" is not an active tab session.',
      })),
    };

    const result = await executeSessionsSend(
      {
        type: 'sessions-send',
        sessionId: 'ghost',
        message: 'Ping',
      },
      handlers,
    );

    expect(result?.success).toBe(false);
    expect(result?.result).toBe('Failed');
    expect(result?.error).toContain('not an active tab session');
  });

  it('reports executed status when delivery declares immediate execution', async () => {
    vi.mocked(display.appendAssistantMessage).mockClear();
    vi.mocked(formatToolAction).mockClear();

    const handlers: any = {
      onSessionsSend: vi.fn(async () => ({
        delivered: true,
        executed: true,
      })),
    };

    const result = await executeSessionsSend(
      {
        type: 'sessions-send',
        sessionId: 'agent:worker',
        message: 'Run now',
      },
      handlers,
    );

    expect(result?.success).toBe(true);
    expect(result?.result).toBe('Delivered and executed in target session.');
    expect(formatToolAction).toHaveBeenCalledWith('SessionsSend', 'agent:worker', {
      success: true,
      summary: 'executed',
    });
    expect(display.appendAssistantMessage).toHaveBeenCalledWith('tool-action');
  });

  it('preserves undefined run flag so agent auto-run policy can apply', async () => {
    const handlers: any = {
      onSessionsSend: vi.fn(async () => ({
        delivered: true,
        executed: true,
      })),
    };

    await executeSessionsSend(
      {
        type: 'sessions-send',
        sessionId: 'agent:worker',
        message: 'Run with default policy',
      },
      handlers,
    );

    expect(handlers.onSessionsSend).toHaveBeenCalledWith(
      'agent:worker',
      'Run with default policy',
      undefined,
    );
  });
});
