/**
 * System Commands - help, clear, history, exit, banner
 */

import { display } from '../../../core/ui';
import { fg, bold } from '@opentui/core';
import { theme } from '../../../core/ui/theme';
import { getLocalHistoryFile } from '../../../core/config/constants';
import { isSessionActive } from '../../wallet/services';
import type { CommandHandler } from '../../../core/commands/registry';
import { listConnectorCatalogEntries } from '../../../connectors/catalog';
import type { ConnectorCapabilities, ConnectorStatus } from '../../../connectors/base';

export const helpCommand: CommandHandler = {
  name: 'help',
  description: 'Show available commands',
  usage: '/help [command]',
  aliases: ['?'],
  group: 'System',
  execute: async (args, context) => {
    const { TYPES } = await import('../../../core/di/types');
    const { container } = await import('../../../core/di/container');
    const registry = container.get(TYPES.CommandRegistry) as any;
    const commands: Map<string, CommandHandler> = registry.commands;

    if (!commands) {
      display.errorText('Command registry not available');
      return true;
    }

    if (args.length > 0) {
      const cmd = commands.get(args[0]);
      if (cmd) {
        display.append('');
        display.violet(cmd.name);
        display.muted('Usage: ' + cmd.usage);
        display.append('');
      } else {
        display.errorText('Unknown command: ' + args[0]);
      }
      return true;
    }

    display.append(
      `${fg(theme.accent)(bold('Keyboard shortcuts:'))}\n\n  ?           Show this help\n  Ctrl+C      Cancel / Quit\n\n`,
    );
    display.append(`${fg(theme.accent)(bold('Commands:'))}\n\n`);

    const groupMap = new Map<string, CommandHandler[]>();
    const seen = new Set<string>();
    for (const handler of commands.values()) {
      if (seen.has(handler.name)) continue;
      seen.add(handler.name);
      const group = handler.group || 'Other';
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push(handler);
    }

    let commandsText = '';
    for (const [groupTitle, handlers] of groupMap) {
      if (groupTitle !== 'Other') {
        commandsText += `${fg(theme.primary)(groupTitle)}\n`;
      }
      for (const cmd of handlers) {
        commandsText += `  /${cmd.name.padEnd(10)} ${cmd.description}\n`;
      }
      commandsText += '\n';
    }

    display.append(commandsText);
    display.append(`${fg(theme.muted)('Use /help <command> for more details')}\n\n`);
    return true;
  },
};

export const clearCommand: CommandHandler = {
  name: 'clear',
  description: 'Clear current tab conversation',
  usage: '/clear (or /clean)',
  aliases: ['clean'],
  group: 'System',
  execute: async (_, context) => {
    if (context.grokClient) {
      let sessionId: string | null = null;
      const activeTabId = context.tuiApp?.getActiveTabId();

      if (activeTabId && activeTabId !== 'agents') {
        if (activeTabId === 'main') {
          sessionId = 'cli';
        } else {
          try {
            const { TYPES } = await import('../../../core/di/types');
            const agentService = context.container.get<any>(TYPES.AgentOrchestratorService);
            sessionId = agentService?.getAgent?.(activeTabId)?.sessionId || null;
          } catch {
            // Agent service is optional.
          }
        }
      }

      // Fallback: clear the currently selected session in the LLM client.
      if (!sessionId) {
        sessionId = context.grokClient.getSessionId();
      }

      context.grokClient.clearSession(sessionId);
    }

    if (context.tuiApp) {
      context.tuiApp.clearChat();
    } else {
      console.clear();
    }
    display.successText('Current tab cleared');
    return true;
  },
};

export const historyCommand: CommandHandler = {
  name: 'history',
  description: 'Show command history',
  usage: '/history [n]',
  group: 'System',
  execute: async args => {
    const limit = parseInt(args[0]) || 20;

    try {
      const historyPath = getLocalHistoryFile();
      const file = Bun.file(historyPath);

      if (!(await file.exists())) {
        display.muted('No history');
        return true;
      }

      const content = await file.text();
      const lines = content.split('\n').filter(l => l.trim());
      const recent = lines.slice(-limit);

      const historyBlock = `${fg(theme.accent)('Command history:')}\n\n${recent.map((line, i) => fg(theme.muted)('  ' + String(lines.length - recent.length + i + 1).padStart(4) + '  ' + line)).join('\n')}\n`;
      display.append(historyBlock);
    } catch {
      display.muted('Could not read history');
    }

    return true;
  },
};

export const exitCommand: CommandHandler = {
  name: 'exit',
  description: 'Quit Slashbot',
  usage: '/exit',
  group: 'System',
  execute: async (_, context) => {
    display.append(`${fg(theme.accent)('Goodbye!')}\n\n`);
    process.exit(0);
  },
};

export const bannerCommand: CommandHandler = {
  name: 'banner',
  description: 'Display the Slashbot banner',
  usage: '/banner',
  group: 'System',
  execute: async (_, context) => {
    let tasksCount = 0;
    let heartbeatStatus: { running: boolean; enabled: boolean } | undefined;
    try {
      const { TYPES } = await import('../../../core/di/types');
      const hbService = context.container.get<any>(TYPES.HeartbeatService);
      heartbeatStatus = hbService?.getStatus();
      const agentService = context.container.get<any>(TYPES.AgentOrchestratorService);
      const summary = agentService?.getSummary?.();
      if (summary) {
        tasksCount = Number(summary.queued || 0) + Number(summary.running || 0);
      }
    } catch {
      // Optional services not bound
    }
    const cfg = context.configManager.getConfig();
    const voiceEnabled = !!(cfg.providers?.openai?.apiKey || process.env.OPENAI_API_KEY);
    const walletUnlocked = isSessionActive();

    const pkg = await import('../../../../package.json');
    const bannerLines = [
      `Slashbot v${pkg.version}`,
      `Working directory: ${context.codeEditor.getWorkDir()}`,
      `Tasks: ${tasksCount}`,
      `Telegram: ${context.connectors.has('telegram') ? 'connected' : 'off'}`,
      `Discord: ${context.connectors.has('discord') ? 'connected' : 'off'}`,
      `Voice: ${voiceEnabled ? 'enabled' : 'off'}`,
      `Heartbeat: ${heartbeatStatus?.running && heartbeatStatus.enabled ? 'active' : 'off'}`,
      `Solana: ${walletUnlocked ? 'unlocked' : 'locked'}`,
    ];
    display.renderMarkdown(bannerLines.join('\n'), true);

    return true;
  },
};

function isConnectorConfigured(id: string, context: Parameters<CommandHandler['execute']>[1]): boolean {
  if (id === 'telegram') return !!context.configManager.getTelegramConfig();
  if (id === 'discord') return !!context.configManager.getDiscordConfig();
  return context.connectors.has(id);
}

function buildConnectorStatus(
  id: string,
  context: Parameters<CommandHandler['execute']>[1],
): ConnectorStatus {
  const handle = context.connectors.get(id);
  const configured = isConnectorConfigured(id, context);
  return (
    handle?.getStatus?.() ?? {
      source: id,
      configured,
      running: handle?.isRunning?.() ?? false,
      authorizedTargets: [],
      notes: [configured ? 'Configured but not running' : 'Not configured'],
    }
  );
}

function renderCapabilities(capabilities: ConnectorCapabilities | null): string {
  if (!capabilities) return 'n/a';
  const bits = [
    `chatTypes=${capabilities.chatTypes.join(',') || 'n/a'}`,
    `markdown=${capabilities.supportsMarkdown ? 'yes' : 'no'}`,
    `threads=${capabilities.supportsThreads ? 'yes' : 'no'}`,
    `reactions=${capabilities.supportsReactions ? 'yes' : 'no'}`,
    `edit=${capabilities.supportsEdit ? 'yes' : 'no'}`,
    `delete=${capabilities.supportsDelete ? 'yes' : 'no'}`,
    `typing=${capabilities.supportsTyping ? 'yes' : 'no'}`,
    `voiceIn=${capabilities.supportsVoiceInbound ? 'yes' : 'no'}`,
    `imageIn=${capabilities.supportsImageInbound ? 'yes' : 'no'}`,
    `multiTarget=${capabilities.supportsMultiTarget ? 'yes' : 'no'}`,
  ];
  return bits.join(' | ');
}

export const connectorsCommand: CommandHandler = {
  name: 'connectors',
  description: 'Show connector status, capabilities, and actions',
  usage: '/connectors [status|capabilities|actions] [telegram|discord]',
  group: 'Connectors',
  subcommands: ['status', 'capabilities', 'actions'],
  execute: async (args, context) => {
    const catalog = listConnectorCatalogEntries();
    const known = new Set(catalog.map(entry => String(entry.id)));

    let mode: 'status' | 'capabilities' | 'actions' = 'status';
    let targetId = '';

    const first = (args[0] || '').toLowerCase();
    const second = (args[1] || '').toLowerCase();

    if (first === 'status' || first === 'capabilities' || first === 'actions') {
      mode = first;
      targetId = second;
    } else if (first) {
      targetId = first;
    }

    if (targetId && !known.has(targetId)) {
      display.errorText(`Unknown connector: ${targetId}`);
      display.muted('Valid connectors: ' + Array.from(known).join(', '));
      return true;
    }

    const entries = targetId
      ? catalog.filter(entry => String(entry.id) === targetId)
      : catalog;

    if (mode === 'status') {
      const lines: string[] = ['Connector Status'];
      for (const entry of entries) {
        const id = String(entry.id);
        const status = buildConnectorStatus(id, context);
        const inline = display.formatInline(status).replace(/`/g, "'");
        lines.push('');
        lines.push(`- ${entry.label} (${id}): ${inline}`);
      }
      display.renderMarkdown(lines.join('\n'), true);
      return true;
    }

    if (mode === 'capabilities') {
      const lines: string[] = ['Connector Capabilities'];
      for (const entry of entries) {
        const id = String(entry.id);
        const runtime = context.connectors.get(id);
        const capabilities = runtime?.getCapabilities?.() || entry.capabilities;
        lines.push('');
        lines.push(`${entry.label} (${id})`);
        lines.push(renderCapabilities(capabilities));
      }
      display.renderMarkdown(lines.join('\n'), true);
      return true;
    }

    const lines: string[] = ['Connector Actions'];
    for (const entry of entries) {
      const id = String(entry.id);
      const runtime = context.connectors.get(id);
      const actions = runtime?.listSupportedActions?.() || entry.actions;
      const actionLines =
        actions.length > 0
          ? actions.map(action => {
              const targetTag = action.requiresTarget ? ' [target]' : '';
              return `- ${action.id}${targetTag}: ${action.description}`;
            })
          : ['- none'];
      lines.push('');
      lines.push(`${entry.label} (${id})`);
      lines.push(...actionLines);
    }
    display.renderMarkdown(lines.join('\n'), true);
    return true;
  },
};
