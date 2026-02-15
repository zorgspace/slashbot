import { EventEmitter } from 'node:events';
import type { JsonValue } from './contracts.js';

/**
 * Known event types and their payload shapes.
 *
 * Plugins can extend this map via declaration merging for type safety:
 *
 * ```ts
 * declare module '../../core/kernel/event-bus.js' {
 *   interface EventMap { 'my.plugin:event': { data: string } }
 * }
 * ```
 */
export interface EventMap {
  'tool:result': { toolId: string; args: Record<string, JsonValue>; sessionId: string; ok: boolean; output: JsonValue; error: string | null };
  'lifecycle:session_start': { sessionId: string; agentId: string };
  'lifecycle:session_end': { sessionId: string; agentId: string };
  'lifecycle:message_received': { sessionId: string; agentId: string; message: string };
  'lifecycle:message_sending': { sessionId: string; agentId: string; message: string };
  'lifecycle:message_sent': { sessionId: string; agentId: string; message: string };
  'history:clear': Record<string, never>;
  'provider:changed': { providerId: string; modelId: string };
  'connector:agentic': { connector?: string; type?: string; text?: string; [key: string]: JsonValue | undefined };
  'connector:telegram:status': { status: string };
  'connector:telegram:message': Record<string, JsonValue>;
  'connector:telegram:agentic': Record<string, JsonValue>;
  'connector:discord:status': { status: string };
  'heartbeat:status': { status: string };
  'heartbeat:started': Record<string, never>;
  'heartbeat:complete': { result: JsonValue; responseLength: number };
  'heartbeat:error': { error: string };
  'automation:job:started': { jobId: string; name: string };
  'automation:job:completed': { jobId: string; name: string };
  'automation:job:error': { jobId: string; error: string };
  'automation:webhook:received': { jobId: string; name: string };
  'agents:registered': { agentId: string; name: string; action: string };
  'agents:removed': { agentId: string; name: string };
  'agents:invoked': { agentId: string; name: string; promptLength: number };
  'agents:completed': { agentId: string; name: string; steps: number; toolCalls: number; durationMs: number; finishReason: string };
}

export type KnownEventType = keyof EventMap;

export interface EventEnvelope<T = Record<string, JsonValue>> {
  type: string;
  payload: T;
  at: string;
}

const ALL_EVENTS = '__all__';

export class EventBus {
  private readonly emitter = new EventEmitter();

  /** Publish a known event with typed payload. */
  publish<K extends KnownEventType>(type: K, payload: EventMap[K]): void;
  /** Publish a custom/plugin-defined event. */
  publish(type: string, payload: Record<string, JsonValue>): void;
  publish(type: string, payload: Record<string, JsonValue>): void {
    const envelope: EventEnvelope = {
      type,
      payload,
      at: new Date().toISOString()
    };

    this.emitter.emit(type, envelope);
    this.emitter.emit(ALL_EVENTS, envelope);
  }

  /** Subscribe to a known event with typed envelope. */
  subscribe<K extends KnownEventType>(type: K, listener: (event: EventEnvelope<EventMap[K]>) => void): () => void;
  /** Subscribe to a custom/plugin-defined event. */
  subscribe(type: string, listener: (event: EventEnvelope) => void): () => void;
  subscribe(type: string, listener: (event: EventEnvelope) => void): () => void {
    this.emitter.on(type, listener);
    return () => this.emitter.off(type, listener);
  }

  subscribeAll(listener: (event: EventEnvelope) => void): () => void {
    this.emitter.on(ALL_EVENTS, listener);
    return () => this.emitter.off(ALL_EVENTS, listener);
  }
}
