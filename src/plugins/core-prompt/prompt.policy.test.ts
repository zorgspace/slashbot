import { describe, expect, it } from 'vitest';
import { TYPES } from '../../core/di/types';
import { CorePromptPlugin } from './index';
import { CORE_PROMPT } from './prompt';

describe('CorePrompt policy', () => {
  it('keeps mandatory sections in the base prompt', () => {
    expect(CORE_PROMPT).toContain('## Tool Call Style');
    expect(CORE_PROMPT).toContain('## Safety');
    expect(CORE_PROMPT).toContain('## Skills (mandatory)');
    expect(CORE_PROMPT).toContain('## Memory Recall');
  });

  it('exposes tooling policy through plugin prompt contribution', async () => {
    const plugin = new CorePromptPlugin();
    const toolRegistry = {
      getToolDefinitions: () => [
        { name: 'read_file', description: 'Read file contents' },
        { name: 'edit_file', description: 'Edit file contents' },
      ],
    };
    const configManager = { getConfig: () => ({ provider: 'xai' }) };

    await plugin.init({
      container: {
        get: (token: symbol) => {
          if (token === TYPES.ConfigManager) return configManager;
          if (token === TYPES.ToolRegistry) return toolRegistry;
          throw new Error('not bound');
        },
      },
      getGrokClient: () => null,
    } as any);

    const contribution = plugin
      .getPromptContributions()
      .find(entry => entry.id === 'core.prompt.tooling');
    expect(contribution).toBeDefined();
    const content =
      typeof contribution?.content === 'function'
        ? await contribution.content()
        : contribution?.content;
    const resolved = typeof content === 'string' ? content : String(content || '');
    expect(resolved).toContain('Tool availability (filtered by policy):');
    expect(resolved).toContain('- read_file: Read file contents');
    expect(resolved).toContain('- edit_file: Edit file contents');
  });
});
