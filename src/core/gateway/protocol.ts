export type GatewayCommandName =
  | 'message.send'
  | 'sessions.list'
  | 'status.get'
  | 'auth.rotate'
  | 'ping';

export interface GatewayCommandEnvelope {
  type: 'command';
  id: string;
  name: GatewayCommandName;
  payload?: Record<string, unknown>;
}

export type GatewayClientMessage =
  | { type: 'authenticate'; token: string }
  | { type: 'pair'; code: string; label?: string }
  | GatewayCommandEnvelope
  | { type: 'ping'; ts?: number };

export type GatewayServerMessage =
  | {
      type: 'hello';
      version: string;
      authRequired: boolean;
      serverTime: string;
    }
  | {
      type: 'auth_ok';
      clientId: string;
      label: string;
      tokenIssuedAt: string;
    }
  | {
      type: 'auth_error';
      message: string;
    }
  | {
      type: 'pairing_code';
      code: string;
      expiresAt: string;
    }
  | {
      type: 'command_ack';
      id: string;
    }
  | {
      type: 'command_event';
      id: string;
      event: 'started' | 'chunk' | 'progress' | 'completed';
      data?: unknown;
    }
  | {
      type: 'command_result';
      id: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }
  | {
      type: 'event';
      name: string;
      payload: unknown;
      ts: string;
    }
  | {
      type: 'pong';
      ts: number;
    }
  | {
      type: 'error';
      message: string;
    };

export interface GatewayWebhookPayload {
  name: string;
  headers: Record<string, string>;
  rawBody: string;
  body: unknown;
  receivedAt: string;
  sourceIp?: string;
}
