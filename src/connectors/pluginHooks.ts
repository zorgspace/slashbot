import { TYPES } from '../core/di/types';
import type { ConnectorRegistry } from './registry';
import type { SidebarData } from '../core/ui';
import type { SidebarStatusItem } from '../core/ui/types';
import type { KernelHookContribution, KernelHookPayload, PluginContext } from '../plugins/types';
import type { TabItem } from '../plugins/tui/panels/TabsPanel';

function getConnectorRegistry(context: PluginContext): ConnectorRegistry | null {
  try {
    return context.container.get<ConnectorRegistry>(TYPES.ConnectorRegistry);
  } catch {
    return null;
  }
}

function toSidebarData(value: unknown): SidebarData | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<SidebarData>;
  if (!Array.isArray(candidate.items)) {
    return null;
  }
  if (typeof candidate.model !== 'string' || typeof candidate.provider !== 'string') {
    return null;
  }
  return candidate as SidebarData;
}

function withConnectorSidebarItem(options: {
  sidebarData: SidebarData;
  connectorId: string;
  label: string;
  order: number;
  active: boolean;
}): SidebarData {
  const items: SidebarStatusItem[] = options.sidebarData.items.filter(
    item => item.id !== options.connectorId,
  );
  items.push({
    id: options.connectorId,
    label: options.label,
    active: options.active,
    order: options.order,
  });
  items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { ...options.sidebarData, items };
}

function lockAgentTab(options: { tabs: TabItem[]; protectedAgentId: string }): TabItem[] {
  let changed = false;
  const next = options.tabs.map(tab => {
    if (tab.id !== options.protectedAgentId) {
      return tab;
    }
    if (tab.removable === false) {
      return tab;
    }
    changed = true;
    return { ...tab, removable: false };
  });
  return changed ? next : options.tabs;
}

function getTabs(payload: KernelHookPayload): TabItem[] | null {
  if (!Array.isArray(payload.tabs)) {
    return null;
  }
  return payload.tabs as TabItem[];
}

export function createConnectorKernelHooks(options: {
  connectorId: string;
  sidebarLabel: string;
  sidebarOrder: number;
  protectedAgentId?: string;
}): KernelHookContribution[] {
  let uiRefreshHookBound = false;
  const hooks: KernelHookContribution[] = [
    {
      event: 'sidebar:before',
      order: 40,
      handler: (payload, context) => {
        const sidebarData = toSidebarData(payload.sidebarData);
        if (!sidebarData) {
          return;
        }

        const connectorRegistry = getConnectorRegistry(context);
        const runtime = connectorRegistry?.get(options.connectorId);
        if (!runtime) {
          return;
        }

        const status = runtime.getStatus?.();
        const active = Boolean(status?.running ?? runtime.isRunning());
        const nextSidebarData = withConnectorSidebarItem({
          sidebarData,
          connectorId: options.connectorId,
          label: options.sidebarLabel,
          order: options.sidebarOrder,
          active,
        });
        return { sidebarData: nextSidebarData };
      },
    },
    {
      event: 'startup:after-ui-ready',
      order: 80,
      handler: (payload, context) => {
        if (uiRefreshHookBound) {
          return;
        }
        const refreshLayout = payload.refreshLayout as (() => void) | undefined;
        const eventBus = (context.eventBus || payload.eventBus) as
          | { on: (type: string, handler: (event: any) => void) => unknown }
          | undefined;
        if (!refreshLayout || !eventBus) {
          return;
        }

        uiRefreshHookBound = true;
        const maybeRefresh = (event: any) => {
          if (String(event?.source || '').toLowerCase() === options.connectorId.toLowerCase()) {
            refreshLayout();
          }
        };
        eventBus.on('connector:connected', maybeRefresh);
        eventBus.on('connector:disconnected', maybeRefresh);
      },
    },
  ];

  if (options.protectedAgentId) {
    const protectedAgentId = options.protectedAgentId;
    hooks.push({
      event: 'tabs:before',
      order: 40,
      handler: payload => {
        const tabs = getTabs(payload);
        if (!tabs) {
          return;
        }
        const nextTabs = lockAgentTab({
          tabs,
          protectedAgentId,
        });
        if (nextTabs === tabs) {
          return;
        }
        return { tabs: nextTabs };
      },
    });
  }

  return hooks;
}
