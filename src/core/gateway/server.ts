import type { ServerWebSocket } from 'bun';

import type { EventBus } from '../events/EventBus';
import type { GatewayAuthClient, GatewayAuthManager } from './auth';
import type { GatewayClientMessage, GatewayServerMessage, GatewayWebhookPayload } from './protocol';

type WsData = {
  authenticated: boolean;
  client?: GatewayAuthClient;
  token?: string;
};

export interface GatewayServerHandlers {
  processMessage: (options: {
    message: string;
    sessionId: string;
    clientId: string;
    onChunk?: (chunk: string) => void;
  }) => Promise<{ response: string; sessionId: string }>;
  listSessions: () => Array<{
    id: string;
    messageCount: number;
    lastActivity: number;
    preview: string;
  }>;
  getStatus: () => {
    connected: boolean;
    model?: string;
    provider?: string;
    connectors: Array<{ id: string; configured: boolean; running: boolean }>;
  };
  handleWebhook?: (payload: GatewayWebhookPayload) => Promise<{ matchedJobs: number }>;
}

export interface GatewayServerOptions {
  host: string;
  port: number;
  version: string;
  auth: GatewayAuthManager;
  eventBus: EventBus;
  handlers: GatewayServerHandlers;
}

function asJson(message: GatewayServerMessage): string {
  return JSON.stringify(message);
}

function sanitizeHeaderMap(headers: Headers): Record<string, string> {
  const map: Record<string, string> = {};
  headers.forEach((value, key) => {
    map[key.toLowerCase()] = value;
  });
  return map;
}

function readTextMessage(raw: string | Buffer | ArrayBuffer | Uint8Array): string {
  if (typeof raw === 'string') return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw).toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  return Buffer.from(raw).toString('utf8');
}

function normalizeCommandPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function extractWebhookName(pathname: string): string | null {
  const m = pathname.match(/^\/webhooks\/([^/]+)$/i);
  if (!m) return null;
  return decodeURIComponent(m[1]).trim() || null;
}

export class GatewayServer {
  private readonly options: GatewayServerOptions;
  private server: ReturnType<typeof Bun.serve<WsData>> | null = null;
  private unsubscribeEventBus: (() => void) | null = null;
  private readonly sockets = new Set<ServerWebSocket<WsData>>();

  constructor(options: GatewayServerOptions) {
    this.options = options;
  }

  get port(): number {
    return this.server?.port || this.options.port;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = Bun.serve<WsData>({
      hostname: this.options.host,
      port: this.options.port,
      fetch: async (request, server) => {
        const url = new URL(request.url);
        if (url.pathname === '/ws') {
          const upgraded = server.upgrade(request, {
            data: {
              authenticated: false,
            },
          });
          if (upgraded) {
            return undefined;
          }
          return new Response('Upgrade failed', { status: 400 });
        }

        if (url.pathname === '/health') {
          return Response.json({
            ok: true,
            host: this.options.host,
            port: this.port,
            now: new Date().toISOString(),
          });
        }

        const webhookName = extractWebhookName(url.pathname);
        if (webhookName && request.method.toUpperCase() === 'POST') {
          const rawBody = await request.text();
          let body: unknown = rawBody;
          const contentType = request.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            try {
              body = rawBody ? JSON.parse(rawBody) : {};
            } catch {
              body = rawBody;
            }
          }
          const payload: GatewayWebhookPayload = {
            name: webhookName,
            headers: sanitizeHeaderMap(request.headers),
            rawBody,
            body,
            receivedAt: new Date().toISOString(),
            sourceIp: request.headers.get('x-forwarded-for') || undefined,
          };
          let matchedJobs = 0;
          if (this.options.handlers.handleWebhook) {
            try {
              const result = await this.options.handlers.handleWebhook(payload);
              matchedJobs = Number(result?.matchedJobs || 0);
            } catch {
              matchedJobs = 0;
            }
          }
          return Response.json(
            {
              accepted: true,
              webhook: webhookName,
              matchedJobs,
            },
            { status: 202 },
          );
        }

        return new Response('Not found', { status: 404 });
      },
      websocket: {
        open: ws => {
          this.sockets.add(ws);
          ws.send(
            asJson({
              type: 'hello',
              version: this.options.version,
              authRequired: true,
              serverTime: new Date().toISOString(),
            }),
          );
        },
        close: ws => {
          this.sockets.delete(ws);
        },
        message: async (ws, raw) => {
          const text = readTextMessage(raw);
          let parsed: GatewayClientMessage | null = null;
          try {
            parsed = JSON.parse(text) as GatewayClientMessage;
          } catch {
            ws.send(
              asJson({
                type: 'error',
                message: 'Invalid JSON payload',
              }),
            );
            return;
          }

          if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
            ws.send(
              asJson({
                type: 'error',
                message: 'Invalid message shape',
              }),
            );
            return;
          }

          if (parsed.type === 'ping') {
            ws.send(
              asJson({
                type: 'pong',
                ts: Date.now(),
              }),
            );
            return;
          }

          if (!ws.data.authenticated) {
            await this.handleUnauthenticatedMessage(ws, parsed);
            return;
          }

          await this.handleAuthenticatedMessage(ws, parsed);
        },
      },
    });

    this.unsubscribeEventBus = this.options.eventBus.onAny(event => {
      const message = asJson({
        type: 'event',
        name: event.type,
        payload: event,
        ts: new Date().toISOString(),
      });
      for (const ws of this.sockets) {
        if (!ws.data.authenticated) continue;
        try {
          ws.send(message);
        } catch {
          // Ignore send errors on stale sockets.
        }
      }
    });
  }

  private async handleUnauthenticatedMessage(
    ws: ServerWebSocket<WsData>,
    parsed: GatewayClientMessage,
  ): Promise<void> {
    if (parsed.type === 'authenticate') {
      const client = await this.options.auth.authenticate(parsed.token);
      if (!client) {
        ws.send(
          asJson({
            type: 'auth_error',
            message: 'Invalid token',
          }),
        );
        return;
      }
      ws.data.authenticated = true;
      ws.data.client = client;
      ws.data.token = parsed.token;
      ws.send(
        asJson({
          type: 'auth_ok',
          clientId: client.id,
          label: client.label,
          tokenIssuedAt: client.tokenIssuedAt,
        }),
      );
      return;
    }

    if (parsed.type === 'pair') {
      const consumed = await this.options.auth.consumePairingCode(parsed.code, parsed.label);
      if (!consumed) {
        ws.send(
          asJson({
            type: 'auth_error',
            message: 'Invalid or expired pairing code',
          }),
        );
        return;
      }
      ws.data.authenticated = true;
      ws.data.client = consumed.client;
      ws.data.token = consumed.token;
      ws.send(
        asJson({
          type: 'pairing_code',
          code: consumed.token,
          expiresAt: '',
        }),
      );
      ws.send(
        asJson({
          type: 'auth_ok',
          clientId: consumed.client.id,
          label: consumed.client.label,
          tokenIssuedAt: consumed.client.tokenIssuedAt,
        }),
      );
      return;
    }

    ws.send(
      asJson({
        type: 'auth_error',
        message: 'Authenticate first',
      }),
    );
  }

  private async handleAuthenticatedMessage(
    ws: ServerWebSocket<WsData>,
    parsed: GatewayClientMessage,
  ): Promise<void> {
    if (parsed.type !== 'command') {
      ws.send(
        asJson({
          type: 'error',
          message: 'Expected command message',
        }),
      );
      return;
    }

    const commandId = String(parsed.id || '').trim();
    if (!commandId) {
      ws.send(
        asJson({
          type: 'error',
          message: 'Command id is required',
        }),
      );
      return;
    }

    ws.send(
      asJson({
        type: 'command_ack',
        id: commandId,
      }),
    );

    const payload = normalizeCommandPayload(parsed.payload);

    if (parsed.name === 'ping') {
      ws.send(
        asJson({
          type: 'command_result',
          id: commandId,
          ok: true,
          result: { pong: Date.now() },
        }),
      );
      return;
    }

    if (parsed.name === 'status.get') {
      const status = this.options.handlers.getStatus();
      ws.send(
        asJson({
          type: 'command_result',
          id: commandId,
          ok: true,
          result: status,
        }),
      );
      return;
    }

    if (parsed.name === 'sessions.list') {
      const sessions = this.options.handlers.listSessions();
      ws.send(
        asJson({
          type: 'command_result',
          id: commandId,
          ok: true,
          result: sessions,
        }),
      );
      return;
    }

    if (parsed.name === 'auth.rotate') {
      const currentToken = ws.data.token || '';
      const rotated = await this.options.auth.rotateToken(currentToken);
      if (!rotated) {
        ws.send(
          asJson({
            type: 'command_result',
            id: commandId,
            ok: false,
            error: 'Unable to rotate token',
          }),
        );
        return;
      }
      ws.data.client = rotated.client;
      ws.data.token = rotated.token;
      ws.send(
        asJson({
          type: 'command_result',
          id: commandId,
          ok: true,
          result: {
            token: rotated.token,
            clientId: rotated.client.id,
            label: rotated.client.label,
          },
        }),
      );
      return;
    }

    if (parsed.name !== 'message.send') {
      ws.send(
        asJson({
          type: 'command_result',
          id: commandId,
          ok: false,
          error: `Unsupported command: ${parsed.name}`,
        }),
      );
      return;
    }

    const message = String(payload.message || '').trim();
    if (!message) {
      ws.send(
        asJson({
          type: 'command_result',
          id: commandId,
          ok: false,
          error: 'payload.message is required',
        }),
      );
      return;
    }

    const clientId = ws.data.client?.id || 'gateway-client';
    const sessionId =
      String(payload.sessionId || '').trim() || `gateway:${clientId.replace(/\s+/g, '-')}`;

    ws.send(
      asJson({
        type: 'command_event',
        id: commandId,
        event: 'started',
      }),
    );

    try {
      const outcome = await this.options.handlers.processMessage({
        message,
        sessionId,
        clientId,
        onChunk: chunk => {
          if (!chunk) return;
          ws.send(
            asJson({
              type: 'command_event',
              id: commandId,
              event: 'chunk',
              data: { chunk },
            }),
          );
        },
      });
      ws.send(
        asJson({
          type: 'command_event',
          id: commandId,
          event: 'completed',
          data: { sessionId: outcome.sessionId },
        }),
      );
      ws.send(
        asJson({
          type: 'command_result',
          id: commandId,
          ok: true,
          result: {
            sessionId: outcome.sessionId,
            response: outcome.response,
          },
        }),
      );
    } catch (error) {
      ws.send(
        asJson({
          type: 'command_result',
          id: commandId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async stop(): Promise<void> {
    this.unsubscribeEventBus?.();
    this.unsubscribeEventBus = null;
    for (const ws of this.sockets) {
      try {
        ws.close();
      } catch {
        // Ignore close errors.
      }
    }
    this.sockets.clear();
    this.server?.stop(true);
    this.server = null;
  }
}
