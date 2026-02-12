import { describe, expect, it } from 'vitest';
import { buildAgentTabs, buildConnectorTabs, collectConnectorTargets } from './tabBuilder';
import type { ConnectorSnapshot } from '../../connectors/registry';

describe('tabBuilder', () => {
  it('builds agent tabs with spinner and unread suffix', () => {
    const tabs = buildAgentTabs({
      agents: [
        { id: 'agent-architect', name: 'Architect', sessionId: 's1' },
        { id: 'agent-frontend', name: 'Frontend', sessionId: 's2' },
      ],
      spinnerFrames: ['⠋', '⠙'],
      spinnerFrameIndex: 1,
      getUnreadCount: tabId => (tabId === 'agent-frontend' ? 3 : 0),
      isReticulating: sessionId => sessionId === 's2',
      isRemovableAgent: agentId => agentId !== 'agent-architect',
    });

    expect(tabs[0]).toMatchObject({ id: 'agents', section: 'agents' });
    expect(tabs[1]).toMatchObject({ id: 'agent-architect', removable: false });
    expect(tabs[2].label).toContain('⠙');
    expect(tabs[2].label).toContain('•3');
  });

  it('collects connector targets from primary/active/authorized without duplicates', () => {
    const snapshot = {
      id: 'discord',
      configured: true,
      running: true,
      status: {
        source: 'discord',
        configured: true,
        running: true,
        primaryTarget: 'chan-a',
        activeTarget: 'chan-b',
        authorizedTargets: ['chan-a', 'chan-c'],
      },
      capabilities: null,
      actions: [],
    } as ConnectorSnapshot;

    expect(collectConnectorTargets(snapshot)).toEqual(['chan-a', 'chan-b', 'chan-c']);
  });

  it('builds connector tab infos and labels', () => {
    const snapshots = [
      {
        id: 'telegram',
        configured: true,
        running: true,
        status: {
          source: 'telegram',
          configured: true,
          running: true,
          primaryTarget: 'chat-1',
          activeTarget: '',
          authorizedTargets: ['chat-2'],
        },
        capabilities: null,
        actions: [],
      } as ConnectorSnapshot,
    ];

    const built = buildConnectorTabs({
      snapshots,
      spinnerFrames: ['⠋'],
      spinnerFrameIndex: 0,
      getUnreadCount: tabId => (tabId.endsWith('chat-2') ? 2 : 0),
      isReticulating: sessionId => sessionId.endsWith('chat-1'),
    });

    expect(built.tabs).toHaveLength(2);
    expect(built.infos).toHaveLength(2);
    expect(built.tabs[0].label).toContain('Telegram');
  });
});
