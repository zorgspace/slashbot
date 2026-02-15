import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { AuthProfileStore } from '../src/core/auth/profile-store.js';
import { AuthProfileRouter } from '../src/core/providers/auth-router.js';
import { ProviderRegistry } from '../src/core/kernel/registries.js';
function loggerStub() {
    return {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
    };
}
function profile(providerId, profileId, method) {
    return {
        providerId,
        profileId,
        label: profileId,
        method,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: method === 'oauth_pkce' ? { access: 'x', refresh: 'y', expires: Date.now() + 1000000 } : { apiKey: 'k' }
    };
}
describe('AuthProfileRouter', () => {
    test('resolves active provider and rotates profiles on failure', async () => {
        const providerRegistry = new ProviderRegistry();
        providerRegistry.register({
            id: 'providerA',
            pluginId: 'test',
            displayName: 'A',
            models: [{ id: 'model-a', displayName: 'A', contextWindow: 1 }],
            authHandlers: [{ method: 'oauth_pkce', start: async () => ({ method: 'oauth_pkce' }), complete: async () => profile('providerA', 'x', 'oauth_pkce') }],
            preferredAuthOrder: ['oauth_pkce', 'api_key']
        });
        const store = new AuthProfileStore(join(tmpdir(), `slashbot-auth-${randomUUID()}`));
        const agentId = 'agent-1';
        await store.upsertProfile(agentId, profile('providerA', 'a-oauth', 'oauth_pkce'));
        await store.upsertProfile(agentId, profile('providerA', 'a-key', 'api_key'));
        const router = new AuthProfileRouter(providerRegistry, store, {
            gateway: { host: '127.0.0.1', port: 1, authToken: 'x' },
            plugins: { allow: [], deny: [], entries: [], paths: [] },
            providers: {
                active: { providerId: 'providerA', modelId: 'model-a' }
            },
            hooks: { defaultTimeoutMs: 10 },
            commandSafety: { defaultTimeoutMs: 10, riskyCommands: [], requireExplicitApproval: true },
            logging: { level: 'info' }
        }, loggerStub());
        const first = await router.resolve({ agentId, sessionId: 's1' });
        expect(first.providerId).toBe('providerA');
        expect(first.profile.profileId).toBe('a-oauth');
        router.reportFailure({ sessionId: 's1', providerId: 'providerA', profileId: 'a-oauth' });
        const second = await router.resolve({ agentId, sessionId: 's1' });
        expect(second.providerId).toBe('providerA');
        expect(second.profile.profileId).toBe('a-key');
    });
    test('throws when no provider is configured', async () => {
        const providerRegistry = new ProviderRegistry();
        const store = new AuthProfileStore(join(tmpdir(), `slashbot-auth-${randomUUID()}`));
        const router = new AuthProfileRouter(providerRegistry, store, {
            gateway: { host: '127.0.0.1', port: 1, authToken: 'x' },
            plugins: { allow: [], deny: [], entries: [], paths: [] },
            providers: {},
            hooks: { defaultTimeoutMs: 10 },
            commandSafety: { defaultTimeoutMs: 10, riskyCommands: [], requireExplicitApproval: true },
            logging: { level: 'info' }
        }, loggerStub());
        await expect(router.resolve({ agentId: 'a', sessionId: 's1' }))
            .rejects.toThrow('No provider configured');
    });
});
