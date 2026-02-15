import { describe, expect, test } from 'vitest';
import { HookDispatcher } from '../src/core/kernel/hook-dispatcher.js';
function loggerStub() {
    return {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
    };
}
describe('HookDispatcher', () => {
    test('executes in deterministic priority and registration order with patch merging', async () => {
        const dispatcher = new HookDispatcher({ hooks: { defaultTimeoutMs: 200 } }, loggerStub());
        dispatcher.register({
            id: 'a',
            pluginId: 'plugin-a',
            domain: 'kernel',
            event: 'input',
            priority: 20,
            handler: async (payload) => ({ count: Number(payload.count ?? 0) + 10 })
        });
        dispatcher.register({
            id: 'b',
            pluginId: 'plugin-b',
            domain: 'kernel',
            event: 'input',
            priority: 10,
            handler: async (payload) => ({ count: Number(payload.count ?? 0) + 1 })
        });
        dispatcher.register({
            id: 'c',
            pluginId: 'plugin-c',
            domain: 'kernel',
            event: 'input',
            priority: 10,
            handler: async (payload) => ({ count: Number(payload.count ?? 0) + 2 })
        });
        const report = await dispatcher.dispatchKernel('input', { count: 0 }, {});
        expect(report.finalPayload.count).toBe(13);
        expect(report.failures).toHaveLength(0);
    });
    test('isolates failures and timeouts', async () => {
        const dispatcher = new HookDispatcher({ hooks: { defaultTimeoutMs: 10 } }, loggerStub());
        dispatcher.register({
            id: 'ok',
            pluginId: 'plugin-ok',
            domain: 'lifecycle',
            event: 'message_sent',
            handler: async () => ({ ok: true })
        });
        dispatcher.register({
            id: 'boom',
            pluginId: 'plugin-boom',
            domain: 'lifecycle',
            event: 'message_sent',
            handler: async () => {
                throw new Error('boom');
            }
        });
        dispatcher.register({
            id: 'slow',
            pluginId: 'plugin-slow',
            domain: 'lifecycle',
            event: 'message_sent',
            timeoutMs: 5,
            handler: async () => {
                await new Promise((resolve) => setTimeout(resolve, 20));
                return { slow: true };
            }
        });
        const report = await dispatcher.dispatchLifecycle('message_sent', { base: true, ok: false }, {});
        expect(report.finalPayload.ok).toBe(true);
        expect(report.failures).toHaveLength(2);
        expect(report.failures.some((failure) => failure.hookId === 'boom')).toBe(true);
        expect(report.failures.some((failure) => failure.hookId === 'slow' && failure.timedOut)).toBe(true);
    });
    test('emits hook lifecycle observability events', async () => {
        const emitted = [];
        const dispatcher = new HookDispatcher({ hooks: { defaultTimeoutMs: 50 } }, loggerStub(), (type, payload) => emitted.push({ type, payload }));
        dispatcher.register({
            id: 'obs',
            pluginId: 'plugin-observability',
            domain: 'lifecycle',
            event: 'message_sent',
            handler: async () => ({ observed: true }),
        });
        await dispatcher.dispatchLifecycle('message_sent', { message: 'ok' }, { sessionId: 's1', agentId: 'a1' });
        const eventTypes = emitted.map((entry) => entry.type);
        expect(eventTypes).toContain('hook:registered');
        expect(eventTypes).toContain('hook:dispatch_start');
        expect(eventTypes).toContain('hook:invoke_start');
        expect(eventTypes).toContain('hook:invoke_success');
        expect(eventTypes).toContain('hook:dispatch_end');
        const dispatchEnd = emitted.find((entry) => entry.type === 'hook:dispatch_end');
        expect(dispatchEnd?.payload.event).toBe('message_sent');
        expect(dispatchEnd?.payload.failuresCount).toBe(0);
    });
});
