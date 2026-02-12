import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@opentui/core', () => ({
  t: (...parts: any[]) => ({ chunks: parts.map(part => ({ text: String(part) })) }),
  fg: () => (value: any) => value,
  bold: (value: any) => value,
  RGBA: class RGBA {
    constructor(_value: unknown) {}
  },
}));

let display: any;
let setTUISpinnerCallbacks: any;

function createMockTui(): any {
  return {
    appendChat: vi.fn(),
    appendStyledChat: vi.fn(),
    appendUserChat: vi.fn(),
    appendAssistantChat: vi.fn(),
    appendAssistantMarkdown: vi.fn(),
    upsertAssistantMarkdownBlock: vi.fn(),
    removeAssistantMarkdownBlock: vi.fn(),
    appendCodeBlock: vi.fn(),
    appendDiffBlock: vi.fn(),
    appendThinking: vi.fn(),
    clearChat: vi.fn(),
    clearThinking: vi.fn(),
    startResponse: vi.fn(),
    appendResponse: vi.fn(),
    setThinkingVisible: vi.fn(),
    updateSidebar: vi.fn(),
    focusInput: vi.fn(),
    showSpinner: vi.fn(),
    hideSpinner: vi.fn(),
    logPrompt: vi.fn(),
    logResponse: vi.fn(),
    endResponse: vi.fn(),
    logAction: vi.fn(),
    logConnectorIn: vi.fn(),
    logConnectorOut: vi.fn(),
    promptInput: vi.fn(async () => ''),
    showNotification: vi.fn(),
    updateNotificationList: vi.fn(),
  };
}

afterEach(() => {
  display?.unbindTUI();
  vi.resetModules();
});

beforeEach(async () => {
  ({ display, setTUISpinnerCallbacks } = await import('./display'));
});

describe('DisplayService tab scoping', () => {
  it('routes unscoped assistant output to scoped tab context', async () => {
    const tui = createMockTui();
    display.bindTUI(tui);

    await display.withOutputTab('agent-2', async () => {
      await Promise.resolve();
      display.appendAssistantMessage('background work');
    });

    expect(tui.appendAssistantChat).toHaveBeenCalledWith('background work', 'agent-2');
  });

  it('keeps concurrent scoped outputs isolated per tab', async () => {
    const tui = createMockTui();
    display.bindTUI(tui);

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    await Promise.all([
      display.withOutputTab('agent-1', async () => {
        await delay(15);
        display.appendAssistantMessage('msg-1');
      }),
      display.withOutputTab('agent-2', async () => {
        await delay(5);
        display.appendAssistantMessage('msg-2');
      }),
    ]);

    const calls = (tui.appendAssistantChat as any).mock.calls as Array<[string, string | undefined]>;
    expect(calls).toContainEqual(['msg-1', 'agent-1']);
    expect(calls).toContainEqual(['msg-2', 'agent-2']);
  });

  it('routes spinner callbacks with scoped tab ids', async () => {
    const tui = createMockTui();
    const showSpinner = vi.fn();
    const hideSpinner = vi.fn();
    display.bindTUI(tui);
    setTUISpinnerCallbacks({ showSpinner, hideSpinner });

    await display.withOutputTab('agent-2', async () => {
      display.startThinking('Thinking...');
      display.stopThinking();
    });

    expect(showSpinner).toHaveBeenCalledWith('Thinking...', 'agent-2');
    expect(hideSpinner).toHaveBeenCalledWith('agent-2');

    setTUISpinnerCallbacks(null);
  });

  it('updates spinner label from action logs in scoped tabs', async () => {
    const tui = createMockTui();
    const showSpinner = vi.fn();
    const hideSpinner = vi.fn();
    display.bindTUI(tui);
    setTUISpinnerCallbacks({ showSpinner, hideSpinner });

    await display.withOutputTab('agent-1', async () => {
      display.logAction('grep src/main.ts');
    });

    expect(showSpinner).toHaveBeenCalledWith('Working: grep src/main.ts', 'agent-1');
    setTUISpinnerCallbacks(null);
  });
});
