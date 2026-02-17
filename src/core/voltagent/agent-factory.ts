/**
 * @module voltagent/agent-factory
 *
 * Converts AgentSpec (from the agent registry) to VoltAgent Agent instances.
 *
 * @see {@link createVoltAgentFromSpec} — Factory function
 */
import { Agent } from '@voltagent/core';
import type { AuthProfileRouter } from '../providers/auth-router.js';
import type { ProviderRegistry } from '../kernel/registries.js';
import type { StructuredLogger } from '../kernel/contracts.js';
import type { SlashbotKernel } from '../kernel/kernel.js';
import type { TokenModeProxyResolver } from '../agentic/llm/types.js';
import { createResolvedModel } from './model-factory.js';
import { buildVoltAgentTools, type ToolBridgeCallbacks } from './tool-bridge.js';

/** Minimal AgentSpec shape matching what the agents plugin provides. */
export interface AgentSpec {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  provider?: string;
  model?: string;
  enabled: boolean;
  toolAllowlist?: string[];
}

/**
 * Creates a VoltAgent Agent from an AgentSpec definition.
 *
 * @returns A configured VoltAgent Agent instance, or null if auth is unavailable
 */
export async function createVoltAgentFromSpec(
  spec: AgentSpec,
  kernel: SlashbotKernel,
  authRouter: AuthProfileRouter,
  providers: ProviderRegistry,
  logger: StructuredLogger,
  sessionId: string,
  tokenModeProxy?: TokenModeProxyResolver,
  toolCallbacks?: ToolBridgeCallbacks,
): Promise<Agent | null> {
  const model = await createResolvedModel({
    authRouter,
    providers,
    logger,
    sessionId,
    agentId: spec.id,
    pinnedProviderId: spec.provider,
    pinnedModelId: spec.model,
    tokenModeProxy,
  });

  if (!model) return null;

  const context = {
    sessionId,
    agentId: spec.id,
    requestId: `${spec.id}-${Date.now()}`,
  };

  const tools = buildVoltAgentTools(
    kernel,
    context,
    toolCallbacks,
    undefined,
    { allowlist: spec.toolAllowlist },
  );

  return new Agent({
    name: spec.name,
    instructions: spec.systemPrompt,
    model: model as any,
    tools,
    maxSteps: 25,
    memory: false,
  });
}
