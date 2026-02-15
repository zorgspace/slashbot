import type {
  AuthProfile,
  AuthResolution,
  ProviderAuthMethod,
  ProviderDefinition,
  ResolverFailureInput,
  RuntimeConfig,
  StructuredLogger
} from '../kernel/contracts.js';
import { AuthProfileStore } from '../auth/profile-store.js';
import { ProviderRegistry } from '../kernel/registries.js';

interface CooldownEntry {
  cooldownUntilMs: number;
  failureCount: number;
}

interface SessionState {
  stickyProfiles: Map<string, string>;
  cooldowns: Map<string, CooldownEntry>;
  /** Provider-level cooldowns for org-wide rate limits. */
  providerCooldowns: Map<string, CooldownEntry>;
}

export interface ResolveAuthRequest {
  agentId: string;
  sessionId: string;
  pinnedProviderId?: string;
  pinnedProfileId?: string;
  pinnedAuthMethod?: ProviderAuthMethod;
  excludeProfileIds?: string[];
}

function parseExpiry(profile: AuthProfile): number | undefined {
  const value = profile.data.expires;
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) {
      return ms;
    }
  }

  return undefined;
}

const ENV_VAR_MAP: Record<string, string[]> = {
  gateway: ['AI_GATEWAY_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  xai: ['XAI_API_KEY'],
  google: ['GOOGLE_GENERATIVE_AI_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  groq: ['GROQ_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY'],
  cohere: ['COHERE_API_KEY'],
  fireworks: ['FIREWORKS_API_KEY'],
  deepinfra: ['DEEPINFRA_API_KEY'],
  perplexity: ['PERPLEXITY_API_KEY'],
  togetherai: ['TOGETHER_API_KEY'],
  'amazon-bedrock': ['AWS_ACCESS_KEY_ID'],
  azure: ['AZURE_API_KEY'],
  'google-vertex': ['GOOGLE_VERTEX_API_KEY'],
};

function synthesizeEnvProfile(providerId: string): AuthProfile | null {
  const envVars = ENV_VAR_MAP[providerId];

  if (envVars) {
    for (const envVar of envVars) {
      const value = process.env[envVar];
      if (value && value.trim().length > 0) {
        return {
          profileId: `env:${envVar}`,
          providerId,
          label: `${envVar} (env)`,
          method: 'api_key',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          data: { apiKey: value.trim() },
        };
      }
    }
    return null;
  }

  // Fallback for custom providers: derive env var as <PROVIDER_ID>_API_KEY
  const derivedVar = `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  const value = process.env[derivedVar];
  if (value && value.trim().length > 0) {
    return {
      profileId: `env:${derivedVar}`,
      providerId,
      label: `${derivedVar} (env)`,
      method: 'api_key',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: { apiKey: value.trim() },
    };
  }

  return null;
}

function profileMethodPriority(method: ProviderAuthMethod): number {
  const order: ProviderAuthMethod[] = ['oauth_pkce', 'setup_token', 'api_key', 'claude_code_import'];
  const index = order.indexOf(method);
  return index >= 0 ? index : 999;
}

function rankProfiles(
  profiles: AuthProfile[],
  provider: ProviderDefinition,
  pinnedProfileId?: string,
  pinnedMethod?: ProviderAuthMethod
): AuthProfile[] {
  return [...profiles].sort((a, b) => {
    if (pinnedProfileId) {
      if (a.profileId === pinnedProfileId) {
        return -1;
      }
      if (b.profileId === pinnedProfileId) {
        return 1;
      }
    }

    if (pinnedMethod) {
      if (a.method === pinnedMethod && b.method !== pinnedMethod) {
        return -1;
      }
      if (b.method === pinnedMethod && a.method !== pinnedMethod) {
        return 1;
      }
    }

    const preferredA = provider.preferredAuthOrder.indexOf(a.method);
    const preferredB = provider.preferredAuthOrder.indexOf(b.method);
    if (preferredA !== preferredB) {
      if (preferredA === -1) return 1;
      if (preferredB === -1) return -1;
      return preferredA - preferredB;
    }

    const methodRankDiff = profileMethodPriority(a.method) - profileMethodPriority(b.method);
    if (methodRankDiff !== 0) {
      return methodRankDiff;
    }

    return a.profileId.localeCompare(b.profileId);
  });
}

export class AuthProfileRouter {
  private readonly sessions = new Map<string, SessionState>();

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly store: AuthProfileStore,
    private readonly config: RuntimeConfig,
    private readonly logger: StructuredLogger
  ) {}

  private getSessionState(sessionId: string): SessionState {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        stickyProfiles: new Map(),
        cooldowns: new Map(),
        providerCooldowns: new Map(),
      });
    }

    return this.sessions.get(sessionId)!;
  }

  private cooldownKey(providerId: string, profileId: string): string {
    return `${providerId}::${profileId}`;
  }

  private isCoolingDown(session: SessionState, providerId: string, profileId: string): boolean {
    const key = this.cooldownKey(providerId, profileId);
    const entry = session.cooldowns.get(key);
    if (!entry) return false;
    if (Date.now() >= entry.cooldownUntilMs) {
      session.cooldowns.delete(key);
      return false;
    }
    return true;
  }

  reportFailure(input: ResolverFailureInput): void {
    const state = this.getSessionState(input.sessionId);
    const key = this.cooldownKey(input.providerId, input.profileId);
    const existing = state.cooldowns.get(key);
    const failureCount = (existing?.failureCount ?? 0) + 1;
    // Exponential backoff: 60s → 300s → 1500s, capped at 25 min
    const backoffMs = Math.min(60_000 * Math.pow(5, failureCount - 1), 25 * 60_000);
    state.cooldowns.set(key, {
      cooldownUntilMs: Date.now() + backoffMs,
      failureCount,
    });
  }

  /** Cool down an entire provider (org-level rate limit). */
  reportProviderRateLimit(sessionId: string, providerId: string): void {
    const state = this.getSessionState(sessionId);
    const existing = state.providerCooldowns.get(providerId);
    const failureCount = (existing?.failureCount ?? 0) + 1;
    // Rate-limit backoff: 60s → 120s → 240s, capped at 5 min
    const backoffMs = Math.min(60_000 * Math.pow(2, failureCount - 1), 5 * 60_000);
    state.providerCooldowns.set(providerId, {
      cooldownUntilMs: Date.now() + backoffMs,
      failureCount,
    });
    this.logger.warn('Provider rate-limited, applying cooldown', {
      providerId,
      backoffMs,
      failureCount,
    });
  }

  private isProviderCoolingDown(session: SessionState, providerId: string): boolean {
    const entry = session.providerCooldowns.get(providerId);
    if (!entry) return false;
    if (Date.now() >= entry.cooldownUntilMs) {
      session.providerCooldowns.delete(providerId);
      return false;
    }
    return true;
  }

  private async refreshIfNeeded(agentId: string, provider: ProviderDefinition, profile: AuthProfile): Promise<AuthProfile> {
    const expiry = parseExpiry(profile);
    if (!expiry || expiry > Date.now() + 60_000) {
      return profile;
    }

    const handler = provider.authHandlers.find((item) => item.method === profile.method);
    if (!handler?.refresh) {
      return profile;
    }

    return this.store.withProfileLock(agentId, provider.id, async () => {
      const fresh = await handler.refresh!(profile);
      await this.store.upsertProfile(agentId, fresh);
      this.logger.info('Refreshed provider auth profile', {
        providerId: provider.id,
        profileId: profile.profileId
      });
      return fresh;
    });
  }

  async resolve(request: ResolveAuthRequest): Promise<AuthResolution> {
    const sessionState = this.getSessionState(request.sessionId);
    const active = this.config.providers.active;

    const providerId = request.pinnedProviderId ?? active?.providerId;
    if (!providerId) {
      throw new Error('No provider configured. Run /setup to configure one.');
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider "${providerId}" is not registered.`);
    }

    if (this.isProviderCoolingDown(sessionState, providerId)) {
      throw new Error(`Provider "${providerId}" is rate-limited. Try again later.`);
    }

    const modelId = active?.modelId ?? provider.models[0]?.id ?? providerId;

    let profiles = await this.store.listProfiles(request.agentId, provider.id);

    // Inherit from default-agent when agent-specific profiles don't exist
    if (profiles.length === 0 && request.agentId !== 'default-agent') {
      profiles = await this.store.listProfiles('default-agent', provider.id);
    }

    // Synthesize a profile from config apiKey
    if (profiles.length === 0 && active?.apiKey) {
      profiles = [{
        profileId: `config:${providerId}`,
        providerId,
        label: `${providerId} (config)`,
        method: 'api_key',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: { apiKey: active.apiKey },
      }];
    }

    // Synthesize a profile from environment variables
    if (profiles.length === 0) {
      const envProfile = synthesizeEnvProfile(providerId);
      if (envProfile) {
        profiles = [envProfile];
      }
    }

    // Fallback: if vendor provider has no profiles, try gateway's stored profiles
    if (profiles.length === 0 && providerId !== 'gateway') {
      let gatewayProfiles = await this.store.listProfiles(request.agentId, 'gateway');
      if (gatewayProfiles.length === 0 && request.agentId !== 'default-agent') {
        gatewayProfiles = await this.store.listProfiles('default-agent', 'gateway');
      }
      if (gatewayProfiles.length > 0) {
        profiles = gatewayProfiles;
      }
    }

    if (profiles.length === 0) {
      throw new Error(`No auth profile for provider "${providerId}". Run /setup to configure one.`);
    }

    const stickyProfileId = sessionState.stickyProfiles.get(provider.id);
    const orderedProfiles = rankProfiles(
      profiles,
      provider,
      request.pinnedProfileId ?? stickyProfileId,
      request.pinnedAuthMethod
    );

    const excludeSet = new Set(request.excludeProfileIds ?? []);

    for (const profile of orderedProfiles) {
      if (excludeSet.has(profile.profileId)) {
        continue;
      }
      if (this.isCoolingDown(sessionState, provider.id, profile.profileId)) {
        continue;
      }

      const freshProfile = await this.refreshIfNeeded(request.agentId, provider, profile);
      sessionState.stickyProfiles.set(provider.id, freshProfile.profileId);

      return {
        providerId: provider.id,
        modelId,
        profile: freshProfile
      };
    }

    throw new Error(`All auth profiles for provider "${providerId}" are cooling down. Try again later.`);
  }
}
