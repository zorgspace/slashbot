import type { MessageMetadata, ConnectorSource, Connector } from '../../connectors/base';
import type { ConnectorRegistry } from '../../connectors/registry';
import type { EventBus } from '../events/EventBus';
import type { ConfigManager } from '../config/config';
import type { PluginContext, ConnectorPlugin, SidebarContribution } from '../../plugins/types';
import { PROVIDERS, MODELS, inferProvider } from '../../plugins/providers/models';
import type { SidebarData } from '../ui';
import type { SidebarStatusItem } from '../ui/types';

type RuntimeConnector = Connector & {
  sendMessageTo?: (targetId: string, msg: string) => Promise<void>;
  getStatus?: () => unknown;
  getCapabilities?: () => unknown;
  listSupportedActions?: () => unknown;
};

export function createPluginRuntimeContext(options: {
  container: PluginContext['container'];
  eventBus: EventBus;
  configManager: ConfigManager;
  workDir: string;
  getGrokClient: () => unknown;
}): PluginContext {
  return {
    container: options.container,
    eventBus: options.eventBus,
    configManager: options.configManager,
    workDir: options.workDir,
    getGrokClient: options.getGrokClient,
  };
}

export function collectSidebarItems(
  sidebarContributions: SidebarContribution[],
): SidebarStatusItem[] {
  const items: SidebarStatusItem[] = sidebarContributions.map(c => ({
    id: c.id,
    label: c.label,
    active: c.getStatus(),
    order: c.order,
  }));

  items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return items;
}

export function buildSidebarData(options: {
  sidebarContributions: SidebarContribution[];
  currentModelId?: string | null;
  availableModels?: string[];
}): SidebarData {
  const currentModelId = options.currentModelId || 'grok-3';
  const providerId = inferProvider(currentModelId);
  const providerInfo = providerId ? PROVIDERS[providerId] : undefined;
  const providerName = providerInfo ? `${providerInfo.id} (${providerInfo.name})` : 'Unknown';
  const modelInfo = MODELS.find(m => m.id === currentModelId);
  const modelName = modelInfo?.name || currentModelId;
  const items = collectSidebarItems(options.sidebarContributions);

  return {
    model: modelName,
    provider: providerName,
    availableModels: options.availableModels || [],
    items,
  };
}

export async function initializeConnectorPlugins(options: {
  connectorPlugins: ConnectorPlugin[];
  pluginContext: PluginContext;
  eventBus: EventBus;
  connectorRegistry: ConnectorRegistry;
  onMessage: (
    message: string,
    source: ConnectorSource,
    metadata?: MessageMetadata,
  ) => Promise<string | void>;
  onIncoming?: (connectorName: string, message: string) => void;
  onOutgoing?: (connectorName: string, response: string) => void;
  onError?: (pluginName: string, error: unknown) => void;
}): Promise<void> {
  for (const plugin of options.connectorPlugins) {
    if (!plugin.createConnector) continue;
    try {
      const connector = (await plugin.createConnector(options.pluginContext)) as Connector | null;
      if (!connector) continue;

      const runtimeConnector = connector as RuntimeConnector;
      const connectorName = plugin.metadata.id.replace('connector.', '') as ConnectorSource;

      connector.setEventBus?.(options.eventBus);
      connector.setMessageHandler(
        async (message: string, source: ConnectorSource, metadata?: MessageMetadata) => {
          options.onIncoming?.(connectorName as string, message);
          const response = await options.onMessage(message, source, metadata);
          if (response) {
            options.onOutgoing?.(connectorName as string, response);
          }
          return response;
        },
      );

      await connector.start();
      options.connectorRegistry.register(connectorName, {
        connector,
        isRunning: () => connector.isRunning(),
        sendMessage: (msg: string) => connector.sendMessage(msg),
        sendMessageTo: runtimeConnector.sendMessageTo
          ? (targetId: string, msg: string) => runtimeConnector.sendMessageTo!(targetId, msg)
          : undefined,
        getStatus: runtimeConnector.getStatus ? () => runtimeConnector.getStatus!() : undefined,
        getCapabilities: runtimeConnector.getCapabilities
          ? () => runtimeConnector.getCapabilities!()
          : undefined,
        listSupportedActions: runtimeConnector.listSupportedActions
          ? () => runtimeConnector.listSupportedActions!()
          : undefined,
        stop: () => connector.stop(),
      });
    } catch (error) {
      options.onError?.(plugin.metadata.name, error);
    }
  }
}
