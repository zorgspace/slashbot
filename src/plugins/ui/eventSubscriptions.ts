/**
 * UI Event Subscriptions - Moved from main index.ts to plugins directory
 * Handles sidebar updates for heartbeat and connector events
 */

import type { TUIApp, SidebarData } from '../../core/ui';
import type { EventBus } from '../../core/events/EventBus';
import { container } from '../../core/di/container';
import { TYPES } from '../../core/di/types';
import type { HeartbeatService } from '../heartbeat/services';

export function getHeartbeatEventSubscription(sidebarData: SidebarData, tuiApp: TUIApp) {
  return () => {
    const hbService = container.get<HeartbeatService>(TYPES.HeartbeatService);
    const status = hbService.getStatus();
    sidebarData.heartbeat.running = status.running && status.enabled;
    tuiApp.updateSidebar(sidebarData);
  };
}

export function getConnectorEventSubscription(sidebarData: SidebarData, tuiApp: TUIApp) {
  return () => {
    sidebarData.connectors = [];
    const connectorRegistry = container.get<any>(TYPES.ConnectorRegistry);
    if (connectorRegistry.has('telegram')) {
      sidebarData.connectors.push({ name: 'Telegram', active: true });
    }
    if (connectorRegistry.has('discord')) {
      sidebarData.connectors.push({ name: 'Discord', active: true });
    }
    tuiApp.updateSidebar(sidebarData);
  };
}