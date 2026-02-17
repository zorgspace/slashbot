/**
 * @module voltagent/model-factory
 *
 * Factory for resolving AI SDK models per-request via auth router.
 *
 * @see {@link createResolvedModel} — Factory function
 */
import type { AuthProfileRouter } from '../providers/auth-router.js';
import type { ProviderRegistry } from '../kernel/registries.js';
import type { StructuredLogger } from '../kernel/contracts.js';
import type { TokenModeProxyAuthService, TokenModeProxyResolver } from '../agentic/llm/types.js';
import { resolveModel, type LanguageModelLike } from './failover-model.js';

/**
 * Resolves an AI SDK model for a specific request context.
 *
 * @param opts - Configuration including auth router, providers, and session info
 * @returns A resolved LanguageModel, or null if no auth is available
 */
export async function createResolvedModel(opts: {
  authRouter: AuthProfileRouter;
  providers: ProviderRegistry;
  logger: StructuredLogger;
  sessionId: string;
  agentId: string;
  pinnedProviderId?: string;
  pinnedModelId?: string;
  tokenModeProxy?: TokenModeProxyResolver;
}): Promise<LanguageModelLike | null> {
  const resolveTokenModeProxy = (): TokenModeProxyAuthService | undefined => {
    if (!opts.tokenModeProxy) return undefined;
    if (typeof opts.tokenModeProxy === 'function') return opts.tokenModeProxy();
    return opts.tokenModeProxy;
  };

  const selectModelForProvider = (providerId: string, preferredModelId?: string): string | undefined => {
    if (preferredModelId && preferredModelId.trim().length > 0) {
      return preferredModelId.trim();
    }
    const provider = opts.providers.get(providerId);
    if (!provider || provider.models.length === 0) return undefined;
    return [...provider.models]
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
      .map((model) => model.id)
      .find((modelId) => modelId.length > 0);
  };

  return resolveModel({
    authRouter: opts.authRouter,
    providers: opts.providers,
    logger: opts.logger,
    sessionId: opts.sessionId,
    agentId: opts.agentId,
    pinnedProviderId: opts.pinnedProviderId,
    pinnedModelId: opts.pinnedModelId,
    resolveTokenModeProxy,
    selectModelForProvider,
  });
}
