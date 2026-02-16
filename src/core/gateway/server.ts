import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import type {
  GatewayRequest,
  GatewayResponse,
  GatewayCallContext,
  HealthStatus,
  JsonValue,
  RuntimeConfig,
  StructuredLogger
} from '../kernel/contracts.js';
import { GatewayMethodRegistry, HttpRouteRegistry } from '../kernel/registries.js';

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);

const GatewayRequestSchema = z.object({
  method: z.string().min(1),
  params: JsonValueSchema,
  requestId: z.string().optional(),
});

interface SlashbotGatewayOptions {
  config: RuntimeConfig;
  methods: GatewayMethodRegistry;
  routes: HttpRouteRegistry;
  logger: StructuredLogger;
  healthProvider: () => HealthStatus;
}

function parseAuthorizationToken(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (auth) {
    if (!auth.startsWith('Bearer ')) {
      return undefined;
    }

    return auth.replace('Bearer ', '').trim();
  }

  if (!req.url) return undefined;
  const host = req.headers.host ?? '127.0.0.1';
  const url = new URL(req.url, `http://${host}`);
  const token = url.searchParams.get('token');
  return token?.trim() || undefined;
}

interface WsClientState {
  subscribed: boolean;
  authorized: boolean;
}

interface WsSubscribeMessage {
  type: 'subscribe';
}

function isSubscribeMessage(value: unknown): value is WsSubscribeMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === 'subscribe';
}

function json(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

export class SlashbotGateway {
  private readonly server;
  private readonly ws;
  private readonly wsClients = new Map<WebSocket, WsClientState>();

  constructor(private readonly options: SlashbotGatewayOptions) {
    this.server = createServer((req, res) => this.handleHttp(req, res));
    this.ws = new WebSocketServer({ noServer: true });

    this.server.on('upgrade', (req, socket, head) => {
      this.ws.handleUpgrade(req, socket, head, (webSocket) => {
        this.ws.emit('connection', webSocket, req);
      });
    });

    this.ws.on('connection', (socket, req) => {
      const token = parseAuthorizationToken(req) ?? '';
      this.wsClients.set(socket, {
        subscribed: false,
        authorized: token === this.options.config.gateway.authToken
      });
      socket.on('close', () => {
        this.wsClients.delete(socket);
      });
      socket.on('message', async (message) => {
        try {
          const parsed = JSON.parse(String(message)) as unknown;
          if (isSubscribeMessage(parsed)) {
            const state = this.wsClients.get(socket);
            if (state) {
              state.subscribed = true;
            }
            socket.send(JSON.stringify({
              type: 'subscribed',
              ok: true,
              at: new Date().toISOString()
            }));
            return;
          }

          const state = this.wsClients.get(socket);
          if (!state?.authorized) {
            socket.send(JSON.stringify({
              type: 'rpc_error',
              ok: false,
              error: 'Unauthorized RPC call: provide gateway token',
              at: new Date().toISOString()
            }));
            return;
          }

          const validated = GatewayRequestSchema.parse(parsed);
          const request: GatewayRequest = {
            method: validated.method,
            params: (validated.params as JsonValue) ?? null,
            requestId: validated.requestId ?? randomUUID(),
          };
          const response = await this.executeRpc(request, token);
          socket.send(JSON.stringify(response));
        } catch (error) {
          socket.send(JSON.stringify({
            type: 'rpc_error',
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            at: new Date().toISOString()
          }));
        }
      });
    });
  }

  async start(): Promise<void> {
    const { host, port } = this.options.config.gateway;

    const listen = () =>
      new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          this.server.removeListener('error', onError);
          reject(err);
        };
        this.server.once('error', onError);
        this.server.listen(port, host, () => {
          this.server.removeListener('error', onError);
          resolve();
        });
      });

    try {
      await listen();
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        this.options.logger.warn(`Port ${port} in use, killing stale process…`);
        await this.killPortHolder(port);
        await new Promise((r) => setTimeout(r, 300));
        await listen();
      } else {
        throw err;
      }
    }

    this.options.logger.info('Gateway started', { host, port });
  }

  private async killPortHolder(port: number): Promise<void> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    try {
      const { stdout } = await exec('fuser', [`${port}/tcp`]);
      const pids = stdout.trim().split(/\s+/).filter(Boolean);
      for (const pid of pids) {
        try { process.kill(Number(pid), 'SIGTERM'); } catch { /* already gone */ }
      }
    } catch {
      // fuser not found or no process — ignore
    }
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.ws.close();
    this.wsClients.clear();
    this.options.logger.info('Gateway stopped');
  }

  publishEvent(eventType: string, payload: Record<string, JsonValue>): void {
    if (this.wsClients.size === 0) return;
    const message = JSON.stringify({
      type: 'event',
      event: {
        type: eventType,
        payload,
        at: new Date().toISOString()
      }
    });

    for (const [socket, state] of this.wsClients.entries()) {
      if (!state.subscribed || socket.readyState !== 1) continue;
      try {
        socket.send(message);
      } catch {
        // best effort
      }
    }
  }

  private isAuthorized(req: IncomingMessage): boolean {
    const token = parseAuthorizationToken(req);
    return token === this.options.config.gateway.authToken;
  }

  private async executeRpc(input: GatewayRequest, authToken: string): Promise<GatewayResponse> {
    try {
      const method = this.options.methods.get(input.method);
      if (!method) {
        return {
          requestId: input.requestId,
          ok: false,
          error: {
            code: 'METHOD_NOT_FOUND',
            message: `Gateway method not found: ${input.method}`
          }
        };
      }

      const context: GatewayCallContext = {
        authToken,
        requestId: input.requestId,
        sessionId: undefined,
        agentId: undefined
      };

      const result = await method.handler(input.params, context);
      return {
        requestId: input.requestId,
        ok: true,
        result
      };
    } catch (error) {
      return {
        requestId: input.requestId,
        ok: false,
        error: {
          code: 'RPC_ERROR',
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!req.url || !req.method) {
      json(res, 404, { error: 'Not found' });
      return;
    }

    if (req.url === '/health') {
      json(res, 200, this.options.healthProvider());
      return;
    }

    if (!this.isAuthorized(req)) {
      json(res, 401, { error: 'Unauthorized' });
      return;
    }

    if (req.url === '/rpc' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const validated = GatewayRequestSchema.parse(body);
      const response = await this.executeRpc(
        {
          method: validated.method,
          params: (validated.params as JsonValue) ?? null,
          requestId: validated.requestId ?? randomUUID(),
        },
        parseAuthorizationToken(req) ?? ''
      );
      json(res, response.ok ? 200 : 400, response);
      return;
    }

    const route = this.options.routes
      .list()
      .find((item) => item.method === req.method && item.path === req.url);

    if (!route) {
      json(res, 404, { error: 'Not found' });
      return;
    }

    try {
      const context: GatewayCallContext = {
        authToken: parseAuthorizationToken(req) ?? '',
        requestId: randomUUID(),
        agentId: undefined,
        sessionId: undefined
      };
      await route.handler(req, res, context);
    } catch (error) {
      json(res, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
