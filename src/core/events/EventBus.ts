/**
 * Event Bus - Typed event system for Slashbot
 *
 * Core events are typed. Plugin events use generic string-based overloads.
 */

import 'reflect-metadata';
import { injectable } from 'inversify';
import { EventEmitter } from 'events';
import type { ConnectorSource } from '../../connectors/base';

/**
 * Core events in the system (typed)
 */
export type SlashbotEvent =
  | { type: 'task:complete'; taskId: string; taskName: string; output: string }
  | { type: 'task:error'; taskId: string; taskName: string; error: string }
  | { type: 'task:started'; taskId: string; taskName: string }
  | { type: 'connector:message'; source: ConnectorSource; message: string }
  | { type: 'connector:response'; source: ConnectorSource; response: string }
  | { type: 'connector:connected'; source: ConnectorSource }
  | { type: 'connector:disconnected'; source: ConnectorSource }
  | { type: 'grok:initialized' }
  | { type: 'grok:disconnected' }
  | { type: 'prompt:redraw' };

/**
 * Extract event types as string union
 */
export type SlashbotEventType = SlashbotEvent['type'];

/**
 * Extract event payload by type
 */
export type EventPayload<T extends SlashbotEventType> = Extract<SlashbotEvent, { type: T }>;

/**
 * Event handler function type
 */
export type EventHandler<T extends SlashbotEventType> = (
  event: EventPayload<T>,
) => void | Promise<void>;

@injectable()
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Increase max listeners to avoid warnings with many subscribers
    this.emitter.setMaxListeners(50);
  }

  /**
   * Emit a typed core event
   */
  emit<T extends SlashbotEventType>(event: EventPayload<T>): void;
  /**
   * Emit a plugin event (untyped)
   */
  emit(event: { type: string; [key: string]: any }): void;
  emit(event: { type: string; [key: string]: any }): void {
    this.emitter.emit(event.type, event);
    // Also emit to wildcard listeners
    this.emitter.emit('*', event);
  }

  /**
   * Subscribe to a typed core event
   */
  on<T extends SlashbotEventType>(type: T, handler: EventHandler<T>): () => void;
  /**
   * Subscribe to a plugin event (untyped)
   */
  on(type: string, handler: (event: any) => void): () => void;
  on(type: string, handler: (event: any) => void): () => void {
    this.emitter.on(type, handler);
    // Return unsubscribe function
    return () => this.emitter.off(type, handler);
  }

  /**
   * Subscribe to all events
   */
  onAny(
    handler: (event: SlashbotEvent | { type: string; [key: string]: any }) => void,
  ): () => void {
    this.emitter.on('*', handler);
    return () => this.emitter.off('*', handler);
  }

  /**
   * Subscribe once to a specific event type
   */
  once<T extends SlashbotEventType>(type: T, handler: EventHandler<T>): void;
  once(type: string, handler: (event: any) => void): void;
  once(type: string, handler: (event: any) => void): void {
    this.emitter.once(type, handler);
  }

  /**
   * Remove all listeners for a specific event type
   */
  off(type: string): void {
    this.emitter.removeAllListeners(type);
  }

  /**
   * Remove all listeners
   */
  clear(): void {
    this.emitter.removeAllListeners();
  }

  /**
   * Get listener count for an event type
   */
  listenerCount(type: string): number {
    return this.emitter.listenerCount(type);
  }
}
