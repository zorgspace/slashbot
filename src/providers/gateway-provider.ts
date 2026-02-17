/**
 * @module providers/gateway-provider
 *
 * Vercel AI Gateway provider implementation. Routes requests through the
 * Vercel AI Gateway to access models from multiple providers (Anthropic,
 * OpenAI, xAI, Google) via a single API key. Also exposes a `setup:gateway`
 * command for interactive onboarding.
 *
 * @see {@link createProvider} -- Provider factory function
 * @see {@link createGatewayCommands} -- CLI command factory for gateway setup
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition, CommandDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the Vercel AI Gateway provider definition with multi-provider models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for the Vercel AI Gateway
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('gateway', 'Vercel AI Gateway', [
    { id: 'anthropic/claude-opus-4-6', displayName: 'Claude Opus 4.6', contextWindow: 200_000, priority: 1, capabilities: ['chat', 'tools', 'reasoning', 'image', 'thinking'] },
    { id: 'openai/gpt-5.2', displayName: 'GPT-5.2', contextWindow: 128_000, priority: 2, capabilities: ['chat', 'tools', 'reasoning', 'image', 'thinking'] },
    { id: 'xai/grok-4-1-fast-reasoning', displayName: 'Grok 4.1 Fast Reasoning', contextWindow: 131_072, priority: 3, capabilities: ['chat', 'tools', 'reasoning', 'image'] },
    { id: 'google/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', contextWindow: 1_000_000, priority: 4, capabilities: ['chat', 'tools', 'reasoning', 'image', 'search', 'thinking'] },
  ], pluginId);
}

/**
 * Creates the `setup:gateway` CLI command for configuring the Vercel AI Gateway
 * provider. Launches the onboarding flow to collect an API key.
 *
 * @param pluginId - The plugin identifier that owns the command
 * @param getKernel - Lazy accessor for the kernel instance
 * @returns An array of {@link CommandDefinition} containing the gateway setup command
 */
export function createGatewayCommands(pluginId: string, getKernel: () => import('../core/kernel/kernel.js').SlashbotKernel): CommandDefinition[] {
  return [
    {
      id: 'setup:gateway',
      pluginId,
      description: 'Set up Vercel AI Gateway provider (API key)',
      execute: async (args, context) => {
        const { runOnboarding } = await import('../ui/onboarding.js');
        const flags = context.flags ?? {};
        const method = typeof flags['method'] === 'string' ? flags['method'] : undefined;
        const apiKey = typeof flags['api-key'] === 'string' ? flags['api-key']
          : (args[0] && typeof args[0] === 'string' ? args[0] : undefined);
        await runOnboarding(getKernel(), {
          agentId: typeof flags['agent-id'] === 'string' ? flags['agent-id'] : 'default-agent',
          providerId: 'gateway',
          method: method as import('../core/kernel/contracts.js').ProviderAuthMethod | undefined,
          profileLabel: typeof flags['label'] === 'string' ? flags['label'] : undefined,
          nonInteractive: context.nonInteractive,
          apiKey,
          stdout: context.stdout
        });
        return 0;
      }
    }
  ];
}
