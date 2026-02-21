import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { AgentSpec, TeamSpec } from './types.js';
import { AgentSpecSchema, TeamSpecSchema } from './types.js';

// ---------------------------------------------------------------------------
// AgentRegistry
// ---------------------------------------------------------------------------

export class AgentRegistry {
  private agents = new Map<string, AgentSpec>();
  private teams = new Map<string, TeamSpec>();
  private readonly agentsPath: string;
  private readonly teamsPath: string;

  constructor(private readonly homeDir: string) {
    this.agentsPath = join(homeDir, 'agents.json');
    this.teamsPath = join(homeDir, 'teams.json');
  }

  // ── Persistence ──────────────────────────────────────────────────

  async load(): Promise<void> {
    await this.loadAgents();
    await this.loadTeams();
  }

  private async loadAgents(): Promise<void> {
    try {
      const data = await fs.readFile(this.agentsPath, 'utf8');
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return;
      for (const raw of parsed) {
        const result = AgentSpecSchema.safeParse(raw);
        if (result.success) {
          this.agents.set(result.data.id, result.data as AgentSpec);
        }
      }
    } catch { /* no file or invalid JSON — start empty */ }
  }

  private async loadTeams(): Promise<void> {
    try {
      const data = await fs.readFile(this.teamsPath, 'utf8');
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return;
      for (const raw of parsed) {
        const result = TeamSpecSchema.safeParse(raw);
        if (result.success) {
          this.teams.set(result.data.id, result.data as TeamSpec);
        }
      }
    } catch { /* no file or invalid JSON — start empty */ }
  }

  private async saveAgents(): Promise<void> {
    await fs.mkdir(this.homeDir, { recursive: true });
    const data = JSON.stringify([...this.agents.values()], null, 2);
    await fs.writeFile(this.agentsPath, `${data}\n`, 'utf8');
  }

  private async saveTeams(): Promise<void> {
    await fs.mkdir(this.homeDir, { recursive: true });
    const data = JSON.stringify([...this.teams.values()], null, 2);
    await fs.writeFile(this.teamsPath, `${data}\n`, 'utf8');
  }

  // ── Agent CRUD ───────────────────────────────────────────────────

  list(): AgentSpec[] {
    return [...this.agents.values()];
  }

  get(id: string): AgentSpec | undefined {
    return this.agents.get(id);
  }

  async register(spec: AgentSpec): Promise<AgentSpec> {
    this.agents.set(spec.id, spec);
    await this.saveAgents();
    return spec;
  }

  async remove(id: string): Promise<boolean> {
    const existed = this.agents.delete(id);
    if (existed) await this.saveAgents();
    return existed;
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const agent = this.agents.get(id);
    if (!agent) return false;
    agent.enabled = enabled;
    agent.updatedAt = new Date().toISOString();
    await this.saveAgents();
    return true;
  }

  // ── Team CRUD ────────────────────────────────────────────────────

  listTeams(): TeamSpec[] {
    return [...this.teams.values()];
  }

  getTeam(id: string): TeamSpec | undefined {
    return this.teams.get(id);
  }

  async registerTeam(spec: TeamSpec): Promise<TeamSpec> {
    this.teams.set(spec.id, spec);
    await this.saveTeams();
    return spec;
  }

  async removeTeam(id: string): Promise<boolean> {
    const existed = this.teams.delete(id);
    if (existed) await this.saveTeams();
    return existed;
  }

  // ── Routing ──────────────────────────────────────────────────────

  resolveAgent(prefix: string): { agentId?: string; strippedMessage: string } {
    const match = prefix.match(/^@([a-z0-9_-]+)\s+([\s\S]+)$/i);
    if (!match) return { strippedMessage: prefix };

    const id = match[1].toLowerCase();
    const strippedMessage = match[2].trim();

    // Direct agent match
    if (this.agents.has(id)) {
      return { agentId: id, strippedMessage };
    }

    // Team match → route to leader
    const team = this.teams.get(id);
    if (team) {
      return { agentId: team.leaderAgentId, strippedMessage };
    }

    return { strippedMessage: prefix };
  }

  // ── Prompt formatting ────────────────────────────────────────────

  formatRoster(): string {
    const lines: string[] = [];
    const agents = this.list();
    const teams = this.listTeams();

    if (agents.length > 0) {
      lines.push('## Available Agents');
      lines.push('Use `agents.invoke` to delegate tasks to specialist agents.');
      for (const a of agents) {
        const model = a.provider
          ? `[${a.provider}${a.model ? `/${a.model}` : ''}]`
          : '[default provider]';
        const status = a.enabled ? '' : ' (disabled)';
        lines.push(`- **${a.id}** (${a.name}): ${a.role || 'No role defined'}${status} ${model}`);
      }
    }

    if (teams.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('## Teams');
      for (const t of teams) {
        lines.push(`- **${t.id}** (${t.name}): Leader: ${t.leaderAgentId}, Members: ${t.memberAgentIds.join(', ')}`);
      }
    }

    return lines.join('\n');
  }
}
