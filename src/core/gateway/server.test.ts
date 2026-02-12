import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { createGatewayAuthManager } from './auth';
import { EventBus } from '../events/EventBus';
import { GatewayServer } from './server';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function waitForCondition<T>(
  getValue: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 4000,
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = getValue();
    if (predicate(value)) {
      return value;
    }
    await sleep(40);
  }
  throw new Error('Condition timed out');
}

const describeIfBun = typeof (globalThis as any).Bun !== 'undefined' ? describe : describe.skip;

describeIfBun('GatewayServer', () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const fn = cleanup.pop()!;
      await fn();
    }
  });

  it('authenticates and handles command bus messages', async () => {
    const tempDir = await createTempDir('slashbot-gateway-server-');
    cleanup.push(() => rm(tempDir, { recursive: true, force: true }));

    const auth = createGatewayAuthManager({ authFile: path.join(tempDir, 'gateway-auth.json') });
    const pairing = await auth.createPairingCode('ws-client');
    const exchanged = await auth.consumePairingCode(pairing.code);
    expect(exchanged).not.toBeNull();

    const eventBus = new EventBus();
    const server = new GatewayServer({
      host: '127.0.0.1',
      port: 0,
      version: 'test',
      auth,
      eventBus,
      handlers: {
        processMessage: async ({ message, sessionId, onChunk }) => {
          onChunk?.(`chunk:${message}`);
          return {
            response: `ok:${message}`,
            sessionId,
          };
        },
        listSessions: () => [
          {
            id: 'gateway:ws-client',
            messageCount: 2,
            lastActivity: Date.now(),
            preview: 'preview',
          },
        ],
        getStatus: () => ({
          connected: true,
          model: 'grok-code-fast-1',
          provider: 'xai',
          connectors: [],
        }),
      },
    });
    cleanup.push(() => server.stop());
    await server.start();

    const messages: any[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    cleanup.push(() => {
      ws.close();
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS open timeout')), 2500);
      ws.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.addEventListener('error', event => {
        clearTimeout(timeout);
        reject(event);
      });
    });
    ws.addEventListener('message', event => {
      const payload = JSON.parse(String(event.data));
      messages.push(payload);
    });

    await waitForCondition(
      () => messages,
      value => value.some(item => item.type === 'hello'),
    );

    ws.send(
      JSON.stringify({
        type: 'authenticate',
        token: exchanged!.token,
      }),
    );

    await waitForCondition(
      () => messages,
      value => value.some(item => item.type === 'auth_ok'),
    );

    ws.send(
      JSON.stringify({
        type: 'command',
        id: 'cmd-1',
        name: 'message.send',
        payload: {
          sessionId: 'gateway:ws-client',
          message: 'hello',
        },
      }),
    );

    await waitForCondition(
      () => messages,
      value =>
        value.some(item => item.type === 'command_result' && item.id === 'cmd-1' && item.ok),
    );

    const chunkEvent = messages.find(
      item => item.type === 'command_event' && item.id === 'cmd-1' && item.event === 'chunk',
    );
    expect(chunkEvent?.data?.chunk).toBe('chunk:hello');
  });

  it('rejects unauthenticated commands', async () => {
    const tempDir = await createTempDir('slashbot-gateway-server-auth-');
    cleanup.push(() => rm(tempDir, { recursive: true, force: true }));

    const auth = createGatewayAuthManager({ authFile: path.join(tempDir, 'gateway-auth.json') });
    const eventBus = new EventBus();
    const server = new GatewayServer({
      host: '127.0.0.1',
      port: 0,
      version: 'test',
      auth,
      eventBus,
      handlers: {
        processMessage: async ({ sessionId }) => ({ response: 'ok', sessionId }),
        listSessions: () => [],
        getStatus: () => ({ connected: false, connectors: [] }),
      },
    });
    cleanup.push(() => server.stop());
    await server.start();

    const messages: any[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    cleanup.push(() => {
      ws.close();
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS open timeout')), 2500);
      ws.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.addEventListener('error', event => {
        clearTimeout(timeout);
        reject(event);
      });
    });
    ws.addEventListener('message', event => {
      messages.push(JSON.parse(String(event.data)));
    });

    ws.send(
      JSON.stringify({
        type: 'command',
        id: 'cmd-unauth',
        name: 'status.get',
      }),
    );

    await waitForCondition(
      () => messages,
      value => value.some(item => item.type === 'auth_error'),
    );
  });

  it('accepts webhook HTTP requests and reports matched jobs', async () => {
    const tempDir = await createTempDir('slashbot-gateway-server-webhook-');
    cleanup.push(() => rm(tempDir, { recursive: true, force: true }));

    const auth = createGatewayAuthManager({ authFile: path.join(tempDir, 'gateway-auth.json') });
    const eventBus = new EventBus();
    const server = new GatewayServer({
      host: '127.0.0.1',
      port: 0,
      version: 'test',
      auth,
      eventBus,
      handlers: {
        processMessage: async ({ sessionId }) => ({ response: 'ok', sessionId }),
        listSessions: () => [],
        getStatus: () => ({ connected: true, connectors: [] }),
        handleWebhook: async payload => {
          expect(payload.name).toBe('deploy');
          return { matchedJobs: 2 };
        },
      },
    });
    cleanup.push(() => server.stop());
    await server.start();

    const response = await fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ok: true }),
    });
    expect(response.status).toBe(202);
    const json = (await response.json()) as any;
    expect(json.accepted).toBe(true);
    expect(json.matchedJobs).toBe(2);
  });
});
