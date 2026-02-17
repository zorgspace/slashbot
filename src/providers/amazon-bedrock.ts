/**
 * @module providers/amazon-bedrock
 *
 * Amazon Bedrock LLM provider implementation. Registers Claude 3.5 Sonnet
 * and Amazon Nova Pro models accessed through the AWS Bedrock managed
 * service with API-key authentication.
 *
 * @see {@link createProvider} -- Provider factory function
 */

import { defineProvider } from './shared.js';
import type { ProviderDefinition } from '../core/kernel/contracts.js';

/**
 * Creates the Amazon Bedrock provider definition with supported models.
 *
 * @param pluginId - The plugin identifier that owns this provider
 * @returns A {@link ProviderDefinition} for Amazon Bedrock
 */
export function createProvider(pluginId: string): ProviderDefinition {
  return defineProvider('amazon-bedrock', 'Amazon Bedrock', [
    { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', displayName: 'Claude 3.5 Sonnet (Bedrock)', contextWindow: 200_000, priority: 1, capabilities: ['chat', 'tools', 'image'] },
    { id: 'amazon.nova-pro-v1:0', displayName: 'Amazon Nova Pro', contextWindow: 300_000, priority: 2, capabilities: ['chat', 'tools', 'image'] },
  ], pluginId);
}
