/**
 * Event Bus - Typed event system for Slashbot
 *
 * Provides decoupled communication between components using typed events.
 */

import 'reflect-metadata';
import { injectable } from 'inversify';
import { EventEmitter } from 'events';
import type { ConnectorSource } from '../connectors/base';

/**
 * All possible events in the system
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
   * Emit an event to all subscribers
   */
  emit<T extends SlashbotEventType>(event: EventPayload<T>): void {
    this.emitter.emit(event.type, event);
    // Also emit to wildcard listeners
    this.emitter.emit('*', event);
  }

  /**
   * Subscribe to a specific event type
   */
  on<T extends SlashbotEventType>(type: T, handler: EventHandler<T>): () => void {
    this.emitter.on(type, handler);
    // Return unsubscribe function
    return () => this.emitter.off(type, handler);
  }

  /**
   * Subscribe to all events
   */
  onAny(handler: (event: SlashbotEvent) => void): () => void {
    this.emitter.on('*', handler);
    return () => this.emitter.off('*', handler);
  }

  /**
   * Subscribe once to a specific event type
   */
  once<T extends SlashbotEventType>(type: T, handler: EventHandler<T>): void {
    this.emitter.once(type, handler);
  }

  /**
   * Remove all listeners for a specific event type
   */
  off<T extends SlashbotEventType>(type: T): void {
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
  listenerCount(type: SlashbotEventType): number {
    return this.emitter.listenerCount(type);
  }
}
