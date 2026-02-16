import { describe, expect, test } from 'vitest';
import { SpawnBridge } from '../src/core/kernel/spawn-bridge.js';

describe('SpawnBridge', () => {
  test('request resolves when listener calls resolve', async () => {
    const bridge = new SpawnBridge();
    bridge.onRequest((req) => {
      req.resolve({ ok: true, output: 'done' });
    });

    const result = await bridge.request('echo', ['hello'], '/tmp', 5000);
    expect(result.ok).toBe(true);
    expect(result.output).toBe('done');
  });

  test('request returns NO_SPAWN_HANDLER error when no listener', async () => {
    const bridge = new SpawnBridge();
    const result = await bridge.request('echo', ['hello'], '/tmp', 5000);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NO_SPAWN_HANDLER');
  });

  test('onRequest returns unsubscribe function', async () => {
    const bridge = new SpawnBridge();
    const unsub = bridge.onRequest((req) => {
      req.resolve({ ok: true, output: 'handled' });
    });

    // Before unsubscribe, should work
    const r1 = await bridge.request('test', [], '/tmp', 1000);
    expect(r1.ok).toBe(true);

    unsub();

    // After unsubscribe, should get NO_SPAWN_HANDLER
    const r2 = await bridge.request('test', [], '/tmp', 1000);
    expect(r2.ok).toBe(false);
    expect(r2.error?.code).toBe('NO_SPAWN_HANDLER');
  });

  test('request passes correct command and args to listener', async () => {
    const bridge = new SpawnBridge();
    let captured: { command: string; args: string[]; cwd: string; timeoutMs: number } | undefined;
    bridge.onRequest((req) => {
      captured = { command: req.command, args: req.args, cwd: req.cwd, timeoutMs: req.timeoutMs };
      req.resolve({ ok: true, output: 'ok' });
    });
    await bridge.request('ls', ['-la', '/tmp'], '/home', 3000);
    expect(captured).toBeDefined();
    expect(captured!.command).toBe('ls');
    expect(captured!.args).toEqual(['-la', '/tmp']);
    expect(captured!.cwd).toBe('/home');
    expect(captured!.timeoutMs).toBe(3000);
  });

  test('multiple sequential requests get unique ids', async () => {
    const bridge = new SpawnBridge();
    const ids: string[] = [];
    bridge.onRequest((req) => {
      ids.push(req.id);
      req.resolve({ ok: true });
    });
    await bridge.request('a', [], '/tmp', 1000);
    await bridge.request('b', [], '/tmp', 1000);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test('re-register after unsubscribe works', async () => {
    const bridge = new SpawnBridge();
    const unsub = bridge.onRequest((req) => req.resolve({ ok: true, output: 'first' }));
    unsub();
    bridge.onRequest((req) => req.resolve({ ok: true, output: 'second' }));
    const result = await bridge.request('t', [], '/tmp', 1000);
    expect(result.ok).toBe(true);
    expect(result.output).toBe('second');
  });

  test('listener resolving with error', async () => {
    const bridge = new SpawnBridge();
    bridge.onRequest((req) => {
      req.resolve({ ok: false, error: { code: 'FAIL', message: 'failed' } });
    });
    const result = await bridge.request('t', [], '/tmp', 1000);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('FAIL');
  });
});
