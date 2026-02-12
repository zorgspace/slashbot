import type { ConnectorSnapshot } from '../../connectors/registry';
import type { TabItem } from '../../plugins/tui/panels/TabsPanel';

export interface AgentTabProfile {
  id: string;
  name: string;
  sessionId: string;
}

export interface ConnectorTabInfo {
  tabId: string;
  source: string;
  targetId: string;
  sessionId: string;
  label: string;
}

export function buildAgentTabs(options: {
  agents: AgentTabProfile[];
  spinnerFrames: string[];
  spinnerFrameIndex: number;
  getUnreadCount: (tabId: string) => number;
  isReticulating: (sessionId: string) => boolean;
  isRemovableAgent: (agentId: string) => boolean;
}): TabItem[] {
  const tabs: TabItem[] = [
    {
      id: 'agents',
      label: 'Agents',
      section: 'agents',
      editable: false,
      removable: false,
    },
  ];

  for (const agent of options.agents) {
    const unread = options.getUnreadCount(agent.id);
    const reticulating = options.isReticulating(agent.sessionId);
    const unreadSuffix = unread > 0 ? ` •${unread}` : '';
    const spinnerPrefix = reticulating
      ? ` ${options.spinnerFrames[options.spinnerFrameIndex]}`
      : '';
    tabs.push({
      id: agent.id,
      label: `${agent.name}${spinnerPrefix}${unreadSuffix}`,
      section: 'agents',
      editable: true,
      removable: options.isRemovableAgent(agent.id),
    });
  }

  return tabs;
}

export function collectConnectorTargets(snapshot: ConnectorSnapshot): string[] {
  const rawTargets = [
    snapshot.status.primaryTarget || '',
    snapshot.status.activeTarget || '',
    ...(Array.isArray(snapshot.status.authorizedTargets) ? snapshot.status.authorizedTargets : []),
  ];
  return Array.from(new Set(rawTargets.map(target => String(target || '').trim()).filter(Boolean)));
}

export function buildConnectorTabs(options: {
  snapshots: ConnectorSnapshot[];
  spinnerFrames: string[];
  spinnerFrameIndex: number;
  getUnreadCount: (tabId: string) => number;
  isReticulating: (sessionId: string) => boolean;
}): { tabs: TabItem[]; infos: ConnectorTabInfo[] } {
  const tabs: TabItem[] = [];
  const infos: ConnectorTabInfo[] = [];

  for (const snapshot of options.snapshots) {
    if (!snapshot.running) {
      continue;
    }
    const targets = collectConnectorTargets(snapshot);
    if (targets.length === 0) {
      continue;
    }
    const sourceLabel = snapshot.id.charAt(0).toUpperCase() + snapshot.id.slice(1);

    for (const targetId of targets) {
      const sessionId = `${snapshot.id}:${targetId}`;
      const label = `${sourceLabel} ${targetId}`;
      infos.push({
        tabId: sessionId,
        source: snapshot.id,
        targetId,
        sessionId,
        label,
      });

      const unread = options.getUnreadCount(sessionId);
      const reticulating = options.isReticulating(sessionId);
      const unreadSuffix = unread > 0 ? ` •${unread}` : '';
      const spinnerPrefix = reticulating
        ? ` ${options.spinnerFrames[options.spinnerFrameIndex]}`
        : '';
      tabs.push({
        id: sessionId,
        label: `${label}${spinnerPrefix}${unreadSuffix}`,
        section: 'connectors',
        editable: false,
        removable: false,
      });
    }
  }

  return { tabs, infos };
}
