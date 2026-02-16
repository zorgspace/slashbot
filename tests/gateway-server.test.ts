import { describe, expect, test, afterEach } from 'vitest';
import { SlashbotGateway } from '../src/core/gateway/server.js';
import { GatewayMethodRegistry, HttpRouteRegistry } from '../src/core/kernel/registries.js';
import { noopLogger, defaultRuntimeConfig } from './helpers.js';

function getAvailablePort(): number {
  return 17680 + Math.floor(Math.random() * 10000);
}

function createGateway(port: number) {
  const config = defaultRuntimeConfig();
  config.gateway.port = port;
  config.gateway.host = '127.0.0.1';

  return new SlashbotGateway({
    config,
    methods: new GatewayMethodRegistry(),
    routes: new HttpRouteRegistry(),
    logger: noopLogger(),
    healthProvider: () => ({ status: 'ok', details: {} }),
  });
}

describe('SlashbotGateway', () => {
  let gateway: SlashbotGateway | null = null;

  afterEach(async () => {
    if (gateway) {
      try { await gateway.stop(); } catch {}
      gateway = null;
    }
  });

  test('start on available port succeeds', async () => {
    const port = getAvailablePort();
    gateway = createGateway(port);
    await gateway.start();
    // If we get here without error, start succeeded
  });

  test('stop closes server', async () => {
    const port = getAvailablePort();
    gateway = createGateway(port);
    await gateway.start();
    await gateway.stop();
    gateway = null;
    // Should be able to start again on same port
    const gw2 = createGateway(port);
    await gw2.start();
    await gw2.stop();
  });

  test('HTTP /health returns status', async () => {
    const port = getAvailablePort();
    gateway = createGateway(port);
    await gateway.start();

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  test('HTTP /rpc returns 401 without auth', async () => {
    const port = getAvailablePort();
    gateway = createGateway(port);
    await gateway.start();

    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'test', params: null }),
    });
    expect(response.status).toBe(401);
  });

  test('HTTP /rpc routes correctly with auth', async () => {
    const port = getAvailablePort();
    const config = defaultRuntimeConfig();
    config.gateway.port = port;
    config.gateway.host = '127.0.0.1';

    const methods = new GatewayMethodRegistry();
    methods.register({
      id: 'test.echo',
      pluginId: 'test',
      description: 'Echo params',
      handler: async (params) => params,
    });

    gateway = new SlashbotGateway({
      config,
      methods,
      routes: new HttpRouteRegistry(),
      logger: noopLogger(),
      healthProvider: () => ({ status: 'ok', details: {} }),
    });
    await gateway.start();

    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.gateway.authToken}`,
      },
      body: JSON.stringify({ method: 'test.echo', params: { hello: 'world' } }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { ok: boolean; result: unknown };
    expect(body.ok).toBe(true);
    expect(body.result).toEqual({ hello: 'world' });
  });

  test('HTTP /rpc with unknown method returns error', async () => {
    const port = getAvailablePort();
    gateway = createGateway(port);
    await gateway.start();

    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test',
      },
      body: JSON.stringify({ method: 'nonexistent.method', params: {} }),
    });
    const body = await response.json() as { ok: boolean; error?: unknown };
    expect(body.ok).toBe(false);
  });

  test('HTTP /health returns application/json', async () => {
    const port = getAvailablePort();
    gateway = createGateway(port);
    await gateway.start();

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  test('unknown path without auth returns 401', async () => {
    const port = getAvailablePort();
    gateway = createGateway(port);
    await gateway.start();

    const response = await fetch(`http://127.0.0.1:${port}/unknown-path`);
    expect(response.status).toBe(401);
  });

  test('RPC handler that throws returns error response', async () => {
    const port = getAvailablePort();
    const config = defaultRuntimeConfig();
    config.gateway.port = port;
    config.gateway.host = '127.0.0.1';

    const methods = new GatewayMethodRegistry();
    methods.register({
      id: 'test.throw',
      pluginId: 'test',
      description: 'Always throws',
      handler: async () => { throw new Error('handler boom'); },
    });

    gateway = new SlashbotGateway({
      config,
      methods,
      routes: new HttpRouteRegistry(),
      logger: noopLogger(),
      healthProvider: () => ({ status: 'ok', details: {} }),
    });
    await gateway.start();

    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.gateway.authToken}`,
      },
      body: JSON.stringify({ method: 'test.throw', params: {} }),
    });
    const body = await response.json() as { ok: boolean; error?: unknown };
    expect(body.ok).toBe(false);
  });
});
