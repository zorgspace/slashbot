/**
 * Connector Registry - Manages Telegram/Discord connectors
 */

import 'reflect-metadata';
import { injectable } from 'inversify';

export interface ConnectorEntry {
  connector: any;
  isRunning: () => boolean;
  sendMessage: (msg: string) => Promise<void>;
  stop?: () => void;
}

@injectable()
export class ConnectorRegistry {
  private connectors: Map<string, ConnectorEntry> = new Map();

  /**
   * Register a connector
   */
  register(name: string, entry: ConnectorEntry): void {
    this.connectors.set(name, entry);
  }

  /**
   * Get a connector by name
   */
  get(name: string): ConnectorEntry | undefined {
    return this.connectors.get(name);
  }

  /**
   * Check if a connector exists
   */
  has(name: string): boolean {
    return this.connectors.has(name);
  }

  /**
   * Get all connector names
   */
  getNames(): string[] {
    return Array.from(this.connectors.keys());
  }

  /**
   * Get all connectors
   */
  getAll(): Map<string, ConnectorEntry> {
    return this.connectors;
  }

  /**
   * Get running connectors
   */
  getRunning(): Map<string, ConnectorEntry> {
    const running = new Map<string, ConnectorEntry>();
    for (const [name, conn] of this.connectors) {
      if (conn.isRunning()) {
        running.set(name, conn);
      }
    }
    return running;
  }

  /**
   * Send notification to connectors
   */
  async notify(message: string, target?: string): Promise<{ sent: string[]; failed: string[] }> {
    const sent: string[] = [];
    const failed: string[] = [];

    // Only send if target is specified (disable sending to all)
    if (!target) {
      return { sent: [], failed: [] };
    }

    for (const [name, conn] of this.connectors) {
      // Skip if target doesn't match
      if (name !== target) continue;
      // Skip if not running
      if (!conn.isRunning()) continue;

      try {
        await conn.sendMessage(message);
        sent.push(name);
      } catch {
        failed.push(name);
      }
    }

    return { sent, failed };
  }

  /**
   * Stop all connectors
   */
  stopAll(): void {
    for (const [, conn] of this.connectors) {
      conn.stop?.();
    }
  }
}
