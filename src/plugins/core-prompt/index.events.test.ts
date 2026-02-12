import { describe, expect, it, vi } from 'vitest';
import { CorePromptPlugin } from './index';

describe('CorePromptPlugin event subscriptions', () => {
  it('rebuilds assembled prompt on prompt:redraw', async () => {
    const plugin = new CorePromptPlugin();
    const buildAssembledPrompt = vi.fn(async () => {});

    await plugin.init({
      container: {
        get: () => {
          throw new Error('not bound');
        },
      },
      getGrokClient: () => ({ buildAssembledPrompt }),
    } as any);

    const subscriptions = plugin.getEventSubscriptions();
    const redraw = subscriptions.find(subscription => subscription.event === 'prompt:redraw');
    expect(redraw).toBeDefined();

    await redraw!.handler({ type: 'prompt:redraw' });
    expect(buildAssembledPrompt).toHaveBeenCalledTimes(1);
  });
});
