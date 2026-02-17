/**
 * @module voltagent/failover-model
 *
 * Resolves auth credentials via AuthProfileRouter and creates a real
 * AI SDK model for a single request. No failover/retry — just resolves
 * the best available provider once.
 *
 * @see {@link resolveModel} — Main entry point
 */
import type { AuthProfileRouter } from '../providers/auth-router.js';
import type { ProviderRegistry } from '../kernel/registries.js';
import type { StructuredLogger } from '../kernel/contracts.js';
import type { TokenModeProxyAuthService } from '../agentic/llm/types.js';
import { extractToken } from '../agentic/llm/helpers.js';
import { getProviderFactory } from '../agentic/llm/provider-registry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolveModelOptions {
  authRouter: AuthProfileRouter;
  providers: ProviderRegistry;
  logger: StructuredLogger;
  sessionId: string;
  agentId: string;
  pinnedProviderId?: string;
  pinnedModelId?: string;
  resolveTokenModeProxy: () => TokenModeProxyAuthService | undefined;
  selectModelForProvider: (providerId: string, preferredModelId?: string) => string | undefined;
}

/** Minimal language model interface matching the AI SDK runtime contract. */
export interface LanguageModelLike {
  readonly specificationVersion: string;
  readonly provider: string;
  readonly modelId: string;
  doGenerate(options: unknown): PromiseLike<unknown>;
  doStream(options: unknown): PromiseLike<unknown>;
}

// ---------------------------------------------------------------------------
// resolveModel
// ---------------------------------------------------------------------------

/**
 * Resolves auth credentials and creates a real AI SDK model for a single
 * request. Handles token-mode proxy path and direct auth resolution.
 *
 * @returns The resolved AI SDK model, or null if no auth is available
 */
export async function resolveModel(opts: ResolveModelOptions): Promise<LanguageModelLike | null> {
  const { authRouter, providers, logger, sessionId, agentId, pinnedProviderId, pinnedModelId } = opts;

  // Token-mode proxy path
  const tokenModeProxy = opts.resolveTokenModeProxy();
  const proxyProbe = tokenModeProxy
    ? await tokenModeProxy.resolveProxyRequest('')
    : null;

  if (proxyProbe?.enabled) {
    const baseUrl = proxyProbe.baseUrl?.trim();
    if (!baseUrl) return null;

    const modelId = opts.selectModelForProvider('xai') ?? 'grok-4-1';

    const proxyFetch = async (request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const liveProxy = opts.resolveTokenModeProxy();
      if (!liveProxy) throw new Error('Token mode proxy unavailable');
      const resolvedProxy = await liveProxy.resolveProxyRequest(
        typeof init?.body === 'string' ? init.body : '',
      );
      if (!resolvedProxy.enabled) throw new Error(resolvedProxy.reason || 'Proxy unavailable');

      const mergedHeaders = new Headers(init?.headers as HeadersInit | undefined);
      mergedHeaders.delete('authorization');
      mergedHeaders.delete('api-key');
      mergedHeaders.delete('x-api-key');
      for (const [key, value] of Object.entries(resolvedProxy.headers ?? {})) {
        if (value !== undefined && value !== null && value !== '') {
          mergedHeaders.set(key, String(value));
        }
      }
      return fetch(request, { ...(init ?? {}), headers: mergedHeaders });
    };

    const factory = getProviderFactory('xai');
    if (!factory) return null;

    return factory({
      providerId: 'xai',
      modelId,
      token: 'token-mode-placeholder',
      baseUrl,
      customFetch: proxyFetch,
    }) as LanguageModelLike;
  }

  if (proxyProbe?.reason) return null;

  // Direct auth path — resolve once
  const resolved = await authRouter.resolve({
    agentId,
    sessionId,
    pinnedProviderId,
  });

  const provider = providers.get(resolved.providerId);
  if (!provider) {
    authRouter.reportFailure({
      sessionId,
      providerId: resolved.providerId,
      profileId: resolved.profile.profileId,
    });
    return null;
  }

  const token = extractToken(resolved.profile);
  if (!token) {
    authRouter.reportFailure({
      sessionId,
      providerId: resolved.providerId,
      profileId: resolved.profile.profileId,
    });
    return null;
  }

  const resolvedModelId = pinnedModelId
    ?? opts.selectModelForProvider(provider.id, resolved.modelId)
    ?? resolved.modelId;

  const factory = getProviderFactory(provider.id);
  if (!factory) return null;

  return factory({
    providerId: provider.id,
    modelId: resolvedModelId,
    token,
    profileId: resolved.profile.profileId,
  }) as LanguageModelLike;
}
