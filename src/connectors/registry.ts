/**
 * Connector Registry - Manages Telegram/Discord connectors
 */

import 'reflect-metadata';
import { injectable } from 'inversify';
import type {
  Connector,
  ConnectorActionSpec,
  ConnectorCapabilities,
  ConnectorStatus,
} from './base';
import {
  buildDefaultConnectorStatus,
  getConnectorActionSpecs,
  getConnectorCapabilities,
  listConnectorCatalogEntries,
} from './catalog';

export interface ConnectorEntry {
  connector: Connector;
  isRunning: () => boolean;
  sendMessage: (msg: string) => Promise<void>;
  sendMessageTo?: (chatId: string, msg: string) => Promise<void>;
  getStatus?: () => ConnectorStatus;
  getCapabilities?: () => ConnectorCapabilities;
  listSupportedActions?: () => ConnectorActionSpec[];
  stop?: () => void;
}

export interface ConnectorSnapshot {
  id: string;
  configured: boolean;
  running: boolean;
  status: ConnectorStatus;
  capabilities: ConnectorCapabilities | null;
  actions: ConnectorActionSpec[];
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
   * Build a stable snapshot (catalog + runtime) for UI/commands.
   */
  getSnapshots(): ConnectorSnapshot[] {
    const snapshots: ConnectorSnapshot[] = [];
    const known = new Set<string>();

    for (const entry of listConnectorCatalogEntries()) {
      const id = String(entry.id);
      known.add(id);
      const runtime = this.connectors.get(id);
      const status = runtime?.getStatus?.() ?? buildDefaultConnectorStatus(entry.id);
      snapshots.push({
        id,
        configured: status.configured,
        running: status.running,
        status: {
          ...status,
          source: status.source || entry.id,
        },
        capabilities: runtime?.getCapabilities?.() ?? getConnectorCapabilities(entry.id),
        actions: runtime?.listSupportedActions?.() ?? getConnectorActionSpecs(entry.id),
      });
    }

    for (const [id, runtime] of this.connectors) {
      if (known.has(id)) continue;
      const status =
        runtime.getStatus?.() ??
        ({
          source: id,
          configured: true,
          running: runtime.isRunning(),
          authorizedTargets: [],
        } satisfies ConnectorStatus);
      snapshots.push({
        id,
        configured: status.configured,
        running: status.running,
        status,
        capabilities: runtime.getCapabilities?.() ?? getConnectorCapabilities(id),
        actions: runtime.listSupportedActions?.() ?? getConnectorActionSpecs(id),
      });
    }

    return snapshots.sort((a, b) => a.id.localeCompare(b.id));
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
  async notify(
    message: string,
    target?: string,
    chatId?: string,
  ): Promise<{ sent: string[]; failed: string[] }> {
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
        if (chatId && conn.sendMessageTo) {
          await conn.sendMessageTo(chatId, message);
        } else {
          await conn.sendMessage(message);
        }
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
