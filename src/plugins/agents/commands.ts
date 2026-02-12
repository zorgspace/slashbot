import { display } from '../../core/ui';
import type { CommandHandler, CommandContext } from '../../core/commands/registry';
import { TYPES } from '../../core/di/types';
import type { AgentOrchestratorService } from './services';

function getService(context: CommandContext): AgentOrchestratorService | null {
  try {
    return context.container.get<AgentOrchestratorService>(TYPES.AgentOrchestratorService);
  } catch {
    return null;
  }
}

function resolveAgentId(service: AgentOrchestratorService, raw: string | undefined): string | null {
  if (!raw) return null;
  return service.resolveAgentId(raw) || null;
}

export const agentCommand: CommandHandler = {
  name: 'agent',
  aliases: ['agents'],
  description: 'Multi-agent orchestration: spawn, edit, send, switch, history, status',
  usage:
    '/agent [status|list|spawn|switch|send|prompt|rename|role|autopoll|enable|disable|delete|history|run] ...',
  group: 'Agents',
  subcommands: [
    'status',
    'list',
    'spawn',
    'switch',
    'send',
    'prompt',
    'rename',
    'role',
    'autopoll',
    'enable',
    'disable',
    'delete',
    'history',
    'run',
  ],
  async execute(args: string[], context: CommandContext): Promise<boolean> {
    const service = getService(context);
    if (!service) {
      display.errorText('Agent orchestrator service is not available');
      return true;
    }

    const cmd = (args[0] || 'status').toLowerCase();

    if (cmd === 'status' || cmd === 'list') {
      const summary = service.getSummary();
      const agents = service.listAgents();
      display.append('');
      display.violet(
        `Agents: ${summary.totalAgents} (active: ${summary.activeAgentId || 'none'})`,
        {
          bold: true,
        },
      );
      display.append(
        `Queue: ${summary.queued} queued, ${summary.running} running, ${summary.done} done, ${summary.failed} failed`,
      );
      display.append('');
      for (const agent of agents) {
        const marker = agent.id === summary.activeAgentId ? '*' : ' ';
        const poll = agent.autoPoll ? 'poll=on' : 'poll=off';
        const run = agent.lastRunAt ? `lastRun=${agent.lastRunAt}` : 'lastRun=never';
        const stats = service.getTaskStatsForAgent(agent.id);
        const err = agent.lastError ? ` error=${agent.lastError}` : '';
        display.append(` [${marker}] ${agent.id} (${agent.name}) - ${agent.responsibility}`);
        display.muted(
          `      ${poll} enabled=${agent.enabled} queue=${stats.queued} running=${stats.running} done=${stats.done} failed=${stats.failed} ${run}${err}`,
        );
        display.muted(`      workspace=${agent.workspaceDir}`);
        display.muted(`      agentDir=${agent.agentDir}`);
      }
      display.append('');
      return true;
    }

    if (cmd === 'spawn' || cmd === 'create') {
      const name = args[1];
      if (!name) {
        display.errorText('Usage: /agent spawn <name> [responsibility]');
        return true;
      }
      const responsibility = args.slice(2).join(' ').trim() || undefined;
      const created = await service.createAgent({
        name,
        responsibility,
      });
      display.successText(`Created ${created.id} (${created.name})`);
      return true;
    }

    if (cmd === 'switch') {
      const target = resolveAgentId(service, args[1]);
      if (!target) {
        display.errorText('Usage: /agent switch <agent-id|name>');
        return true;
      }
      const ok = await service.setActiveAgent(target);
      if (!ok) {
        display.errorText(`Agent not found: ${args[1]}`);
        return true;
      }
      display.successText(`Active agent: ${target}`);
      return true;
    }

    if (cmd === 'send') {
      const toId = resolveAgentId(service, args[1]);
      if (!toId) {
        display.errorText('Usage: /agent send <to-agent> <task text>');
        return true;
      }
      const content = args.slice(2).join(' ').trim();
      if (!content) {
        display.errorText('Task content is required');
        return true;
      }
      const from = service.getActiveAgentId();
      if (!from) {
        display.errorText('No active agent. Create one with /agent spawn <name> first.');
        return true;
      }
      const task = await service.sendTask({
        fromAgentId: from,
        toAgentId: toId,
        title: content.split('\n')[0].slice(0, 80),
        content,
      });
      display.successText(`Queued ${task.id} -> ${toId}`);
      return true;
    }

    if (cmd === 'prompt') {
      const id = resolveAgentId(service, args[1]);
      if (!id) {
        display.errorText('Usage: /agent prompt <agent-id|name> <prompt text>');
        return true;
      }
      const prompt = args.slice(2).join(' ').trim();
      if (!prompt) {
        display.errorText('Prompt text is required');
        return true;
      }
      await service.updateAgent(id, { systemPrompt: prompt });
      display.successText(`Updated prompt for ${id}`);
      return true;
    }

    if (cmd === 'rename') {
      const id = resolveAgentId(service, args[1]);
      if (!id) {
        display.errorText('Usage: /agent rename <agent-id|name> <new name>');
        return true;
      }
      const name = args.slice(2).join(' ').trim();
      if (!name) {
        display.errorText('New name is required');
        return true;
      }
      await service.updateAgent(id, { name });
      display.successText(`Renamed ${id} to "${name}"`);
      return true;
    }

    if (cmd === 'role' || cmd === 'responsibility') {
      const id = resolveAgentId(service, args[1]);
      if (!id) {
        display.errorText('Usage: /agent role <agent-id|name> <responsibility>');
        return true;
      }
      const responsibility = args.slice(2).join(' ').trim();
      if (!responsibility) {
        display.errorText('Responsibility is required');
        return true;
      }
      await service.updateAgent(id, { responsibility });
      display.successText(`Updated responsibility for ${id}`);
      return true;
    }

    if (cmd === 'autopoll') {
      const id = resolveAgentId(service, args[1]);
      if (!id) {
        display.errorText('Usage: /agent autopoll <agent-id|name> <on|off>');
        return true;
      }
      const mode = (args[2] || '').toLowerCase();
      if (mode !== 'on' && mode !== 'off') {
        display.errorText('Autopoll mode must be "on" or "off"');
        return true;
      }
      const autoPoll = mode === 'on';
      await service.updateAgent(id, { autoPoll });
      display.successText(`Autopoll ${autoPoll ? 'enabled' : 'disabled'} for ${id}`);
      return true;
    }

    if (cmd === 'enable' || cmd === 'disable') {
      const id = resolveAgentId(service, args[1]);
      if (!id) {
        display.errorText(`Usage: /agent ${cmd} <agent-id|name>`);
        return true;
      }
      const enabled = cmd === 'enable';
      await service.updateAgent(id, { enabled });
      display.successText(`${enabled ? 'Enabled' : 'Disabled'} ${id}`);
      return true;
    }

    if (cmd === 'delete' || cmd === 'remove') {
      const id = resolveAgentId(service, args[1]);
      if (!id) {
        display.errorText('Usage: /agent delete <agent-id|name>');
        return true;
      }
      const ok = await service.deleteAgent(id);
      if (!ok) {
        display.warningText(`Cannot delete ${id} (agent not found)`);
      } else {
        display.successText(`Deleted ${id}`);
      }
      return true;
    }

    if (cmd === 'run') {
      const id = resolveAgentId(service, args[1]);
      if (!id) {
        display.errorText('Usage: /agent run <agent-id|name>');
        return true;
      }
      const ok = await service.runNextForAgent(id);
      if (!ok) {
        display.warningText(`No queued task for ${id}`);
      } else {
        display.successText(`Running next task for ${id}`);
      }
      return true;
    }

    if (cmd === 'history') {
      const id = resolveAgentId(service, args[1]);
      if (!id) {
        display.errorText('Usage: /agent history <agent-id|name> [limit]');
        return true;
      }
      const limit = Number(args[2] || 10);
      const agent = service.getAgent(id);
      if (!agent) {
        display.errorText(`Agent not found: ${id}`);
        return true;
      }
      const history = context.grokClient?.getHistoryForSession(agent.sessionId) || [];
      display.append('');
      display.violet(`History for ${id} (${history.length} messages)`, { bold: true });
      const items = history.slice(-Math.max(1, limit));
      for (const msg of items) {
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join(' ')
              : '[non-text]';
        display.append(`${msg.role}: ${content.replace(/\s+/g, ' ').slice(0, 240)}`);
      }
      display.append('');
      return true;
    }

    display.muted(
      'Usage: /agent [status|list|spawn|switch|send|prompt|rename|role|autopoll|enable|disable|delete|history|run]',
    );
    return true;
  },
};

export const agentCommands: CommandHandler[] = [agentCommand];
