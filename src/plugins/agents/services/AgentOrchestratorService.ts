import 'reflect-metadata';
import { injectable, inject } from 'inversify';
import { cp, mkdir, readdir, rm } from 'fs/promises';
import path from 'path';
import { getLocalSlashbotDir } from '../../../core/config/constants';
import { TYPES } from '../../../core/di/types';
import type { EventBus } from '../../../core/events/EventBus';
import type {
  AgentProfile,
  AgentTask,
  AgentWorkspaceState,
  AgentTaskState,
  CreateAgentInput,
  SendTaskInput,
  AgentRoutingRequest,
  AgentRoutingDecision,
  AgentTaskRunResult,
  AgentTaskStats,
} from './types';

const DEFAULT_POLL_MS = 5000;

const WORKSPACE_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
] as const;

type AgentTaskRouter = (request: AgentRoutingRequest) => Promise<AgentRoutingDecision | null>;

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function defaultArchitectPrompt(name: string, responsibility: string): string {
  return [
    `You are ${name}, the orchestrator.`,
    `Responsibility: ${responsibility}.`,
    'CRITICAL: Never implement, edit, or run product code yourself.',
    'Your role is planning, decomposition, delegation, and verification only.',
    'Before delegating any user request, inspect available agents first (agents_status / agents_list) and choose the most adequate specialist.',
    'If no adequate specialist exists, create or retask one before delegation.',
    'Manage agents aggressively: pop dedicated specialists with /agent spawn, delegate via <agent-send>, and tidy up with /agent delete once the work is done.',
    '- Never delegate to yourself.',
    'Track orchestration steps using the todo plugin: create or refresh a <todo-write> list, read it with <todo-read/>, and update statuses as subtasks progress.',
    'Require each worker to report completion evidence back to you before you mark the larger effort complete.',
    'Assign tasks after assessing queue, blockers, and todo state; reroute quickly when blockers remain.',
    'The orchestrator owns the final user-facing completion signal only after verifying worker reports.',
  ].join('\n');
}

function defaultAgentPrompt(name: string, responsibility: string): string {
  let normalizedResponsibility = responsibility.replace(/_/g, ' ').trim();
  normalizedResponsibility =
    normalizedResponsibility.charAt(0).toUpperCase() + normalizedResponsibility.slice(1);
  return `You are ${name}, a specialist execution agent.

Your core responsibility: ${normalizedResponsibility}.

Execution policy:
- Execute delegated work directly using repository/runtime tools.
- Reproduce issues, implement fixes, and verify with concrete command/test evidence.
- Keep changes scoped, minimal, and reversible.
- Use coordination tools only when blocked by missing ownership or missing context.
- Never delegate to yourself.

Reporting policy:
- Before end_task, report completion back to the requesting orchestrator using <agent-send>.
- Include status, files changed, commands/tests run, outcomes, and residual risks.
- Always end your response with <end_task message="concise verification summary"> when the task is finished.

Communication rules:
- Use say_message for short progress updates.
- Keep outputs concise and action-oriented.`;
}

function defaultConnectorPrompt(name: string, responsibility: string, connectorId: string): string {
  const connector = connectorId.toUpperCase();
  return `You are ${name}, the ${connector} connector agent.

Your core responsibility: ${responsibility}.

Execution policy:
- Handle inbound ${connector} requests directly with available tools.
- Keep responses concise and platform-safe for connector users.
- Execute required actions (read/edit/write/bash/tools) without unnecessary delegation.
- Delegate only when blocked by missing ownership or specialization.

Communication rules:
- Use clear, short progress/status updates.
- End with brief plain-language summaries when a request is complete.`;
}

function isOrchestratorProfile(
  agent: Pick<AgentProfile, 'id' | 'name' | 'responsibility'>,
): boolean {
  const label = `${agent.id} ${agent.name} ${agent.responsibility}`.toLowerCase();
  return (
    label.includes('architect') || label.includes('orchestrator') || label.includes('coordinator')
  );
}

function decodePromptEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function sanitizeAgentPrompt(input: string): string {
  const decoded = decodePromptEntities(input).replace(/\r\n/g, '\n').trim();
  if (!decoded) return '';

  const lines = decoded.split('\n');
  while (lines.length > 0 && /^my core agent prompt .* is:?$/i.test(lines[0].trim())) {
    lines.shift();
  }

  const junkSuffix = [
    /^full workspace files are minimal as shown in tool outputs\.?$/i,
    /^prompt shared\.?$/i,
    /^workspace context loaded\.?$/i,
  ];
  while (lines.length > 0 && junkSuffix.some(rx => rx.test(lines[lines.length - 1].trim()))) {
    lines.pop();
  }

  return lines.join('\n').trim();
}

function templateForWorkspaceFile(params: {
  fileName: (typeof WORKSPACE_FILES)[number] | 'BOOTSTRAP.md';
  agent: Pick<AgentProfile, 'id' | 'name' | 'responsibility' | 'systemPrompt'>;
}): string {
  const { fileName, agent } = params;
  const isOrchestrator = isOrchestratorProfile(agent);
  if (fileName === 'AGENTS.md') {
    return [
      '# AGENTS.md',
      '',
      `Agent ID: ${agent.id}`,
      `Agent Name: ${agent.name}`,
      '',
      '## Mission',
      agent.responsibility,
      '',
      '## Operating Rules',
      '- Keep changes minimal and verifiable.',
      ...(isOrchestrator
        ? [
            '- Do not implement code directly; orchestrate only.',
            '- Spawn specialists for implementation, then delegate with <agent-send>.',
            '- Require completion reports with verification evidence before closing work.',
          ]
        : [
            '- Execute delegated implementation work directly.',
            '- Report completion back to the requesting orchestrator via <agent-send> before end_task.',
            '- Delegate only when blocked by missing ownership/specialization.',
          ]),
      '- Record key decisions in TOOLS.md when helpful.',
      '',
      '## Prompt',
      agent.systemPrompt,
      '',
      '## Agentic Purpose',
      ...(isOrchestrator
        ? [
            '- Plan, delegate, and verify; never perform direct implementation.',
            '- Route tasks to the best specialist and track progress until completion.',
            '- Aggregate worker reports and provide final closure once evidence is sufficient.',
          ]
        : [
            '- Execute delegated tasks fully from read to diff to apply to tests/deploy where appropriate.',
            '- Keep status short and actionable; summary should list root cause, fix, validation, remaining risks.',
            '- If blocked or needing extra context, send a focused `<agent-send>` request with clear title and rationale.',
          ]),
      '',
    ].join('\n');
  }
  if (fileName === 'SOUL.md') {
    return [
      '# SOUL.md',
      '',
      `You are ${agent.name}.`,
      'Work deliberately and communicate clearly.',
      '',
    ].join('\n');
  }
  if (fileName === 'TOOLS.md') {
    return [
      '# TOOLS.md',
      '',
      '- Add local tool notes here.',
      '- Add conventions for this agent here.',
      '',
    ].join('\n');
  }
  if (fileName === 'IDENTITY.md') {
    return [
      '# IDENTITY.md',
      '',
      `- Name: ${agent.name}`,
      '- Role: Specialist software agent',
      '- Emoji: :robot_face:',
      '',
    ].join('\n');
  }
  if (fileName === 'USER.md') {
    return ['# USER.md', '', '- Name:', '- Preferred address:', '- Notes:', ''].join('\n');
  }
  if (fileName === 'HEARTBEAT.md') {
    return [
      '# HEARTBEAT.md',
      '',
      ...(isOrchestrator
        ? [
            '- [ ] Check worker reports in queue.',
            '- [ ] Delegate follow-up work or close verified tasks.',
          ]
        : ['- [ ] Check delegated queue.', '- [ ] Report blockers to architect.']),
      '',
    ].join('\n');
  }
  return ['# BOOTSTRAP.md', '', `Welcome ${agent.name}.`, ''].join('\n');
}

async function fileExists(filePath: string): Promise<boolean> {
  return Bun.file(filePath).exists();
}

async function commandSucceeds(cmd: string[], cwd?: string): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd,
      cwd,
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

@injectable()
export class AgentOrchestratorService {
  private workDir: string = process.cwd();
  private state: AgentWorkspaceState = {
    version: 1,
    activeAgentId: '',
    agents: [],
  };
  private tasks: AgentTaskState = {
    version: 1,
    tasks: [],
  };
  private running = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlightAgents = new Set<string>();
  private taskExecutor:
    | ((agent: AgentProfile, task: AgentTask) => Promise<AgentTaskRunResult>)
    | null = null;
  private taskRouter: AgentTaskRouter | null = null;

  constructor(@inject(TYPES.EventBus) private readonly eventBus: EventBus) {}

  setWorkDir(workDir: string): void {
    this.workDir = workDir;
  }

  setTaskExecutor(
    executor: ((agent: AgentProfile, task: AgentTask) => Promise<AgentTaskRunResult>) | null,
  ): void {
    this.taskExecutor = executor;
  }

  setTaskRouter(router: AgentTaskRouter | null): void {
    this.taskRouter = router;
  }

  private getAgentsRootDir(): string {
    return path.join(this.workDir, '.agents');
  }

  private getLegacyAgentsDir(): string {
    return `${getLocalSlashbotDir(this.workDir)}/agents`;
  }

  private resolveAgentBaseDir(agentId: string): string {
    return path.join(this.getAgentsRootDir(), agentId);
  }

  private resolveAgentWorkspaceDir(agentId: string): string {
    return path.join(this.resolveAgentBaseDir(agentId), 'workspace');
  }

  private resolveAgentDir(agentId: string): string {
    return path.join(this.resolveAgentBaseDir(agentId), 'agent');
  }

  private getAgentsFile(): string {
    return `${this.getAgentsRootDir()}/agents.json`;
  }

  private getTasksFile(): string {
    return `${this.getAgentsRootDir()}/tasks.json`;
  }

  private getLegacyAgentsFile(): string {
    return `${this.getLegacyAgentsDir()}/agents.json`;
  }

  private getLegacyTasksFile(): string {
    return `${this.getLegacyAgentsDir()}/tasks.json`;
  }

  private async migrateLegacyStorageIfNeeded(): Promise<void> {
    const newAgents = Bun.file(this.getAgentsFile());
    const newTasks = Bun.file(this.getTasksFile());
    const legacyAgents = Bun.file(this.getLegacyAgentsFile());
    const legacyTasks = Bun.file(this.getLegacyTasksFile());

    const [newAgentsExists, newTasksExists, legacyAgentsExists, legacyTasksExists] =
      await Promise.all([
        newAgents.exists(),
        newTasks.exists(),
        legacyAgents.exists(),
        legacyTasks.exists(),
      ]);

    if (!newAgentsExists && legacyAgentsExists) {
      await Bun.write(this.getAgentsFile(), await legacyAgents.text());
    }
    if (!newTasksExists && legacyTasksExists) {
      await Bun.write(this.getTasksFile(), await legacyTasks.text());
    }

    try {
      const legacyEntries = await readdir(this.getLegacyAgentsDir(), { withFileTypes: true });
      for (const entry of legacyEntries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const src = path.join(this.getLegacyAgentsDir(), entry.name);
        const dst = this.resolveAgentBaseDir(entry.name);
        if (await fileExists(dst)) {
          continue;
        }
        await cp(src, dst, { recursive: true, errorOnExist: false, force: false });
      }
    } catch {
      // No legacy per-agent dirs to migrate
    }
  }

  private normalizeStoragePath(rawPath: unknown, fallbackPath: string): string {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      return fallbackPath;
    }
    const trimmed = rawPath.trim();
    const legacyRoot = path.resolve(this.getLegacyAgentsDir());
    const resolved = path.resolve(trimmed);
    if (resolved === legacyRoot || resolved.startsWith(`${legacyRoot}${path.sep}`)) {
      return fallbackPath;
    }
    return trimmed;
  }

  private normalizeAgentProfile(raw: Partial<AgentProfile>, index: number): AgentProfile {
    const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
    const id = rawId || `agent-${index + 1}`;
    const name =
      typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Agent ${index + 1}`;
    const responsibility =
      typeof raw.responsibility === 'string' && raw.responsibility.trim()
        ? raw.responsibility.trim()
        : 'Specialist worker. Execute delegated tasks and report results.';
    const createdAt =
      typeof raw.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt : nowIso();

    const workspaceDir = this.normalizeStoragePath(
      raw.workspaceDir,
      this.resolveAgentWorkspaceDir(id),
    );
    const agentDir = this.normalizeStoragePath(raw.agentDir, this.resolveAgentDir(id));

    const rawPrompt =
      typeof raw.systemPrompt === 'string' && raw.systemPrompt.trim()
        ? sanitizeAgentPrompt(raw.systemPrompt)
        : '';

    const kind = raw.kind || 'custom';
    const autoPollDefault = kind === 'architect' || kind === 'connector' ? false : true;
    const removableDefault = kind !== 'architect' && kind !== 'connector';
    const systemPromptDefault =
      kind === 'architect'
        ? defaultArchitectPrompt(name, responsibility)
        : kind === 'connector'
          ? defaultConnectorPrompt(name, responsibility, id.replace(/^agent-/, '').replace(/agent$/, ''))
          : defaultAgentPrompt(name, responsibility);

    return {
      id,
      name,
      kind,
      responsibility,
      systemPrompt: rawPrompt || systemPromptDefault,
      sessionId:
        typeof raw.sessionId === 'string' && raw.sessionId.trim() ? raw.sessionId : `agent:${id}`,
      workspaceDir,
      agentDir,
      enabled: raw.enabled ?? true,
      autoPoll: raw.autoPoll ?? autoPollDefault,
      removable: raw.removable ?? removableDefault,
      createdAt,
      updatedAt:
        typeof raw.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt : createdAt,
      lastRunAt: raw.lastRunAt,
      lastError: raw.lastError,
    };
  }

  private async ensureAgentStorage(agent: AgentProfile): Promise<void> {
    const baseDir = this.resolveAgentBaseDir(agent.id);
    await mkdir(baseDir, { recursive: true });
    await mkdir(agent.workspaceDir, { recursive: true });
    await mkdir(agent.agentDir, { recursive: true });

    const absoluteWorkspace = path.resolve(agent.workspaceDir);
    const checks = await Promise.all(
      WORKSPACE_FILES.map(async name => fileExists(path.join(absoluteWorkspace, name))),
    );
    const isBrandNewWorkspace = checks.every(v => !v);

    for (const fileName of WORKSPACE_FILES) {
      const filePath = path.join(absoluteWorkspace, fileName);
      if (await fileExists(filePath)) {
        continue;
      }
      await Bun.write(
        filePath,
        templateForWorkspaceFile({
          fileName,
          agent,
        }),
      );
    }

    if (isBrandNewWorkspace) {
      const bootstrapPath = path.join(absoluteWorkspace, 'BOOTSTRAP.md');
      if (!(await fileExists(bootstrapPath))) {
        await Bun.write(
          bootstrapPath,
          templateForWorkspaceFile({
            fileName: 'BOOTSTRAP.md',
            agent,
          }),
        );
      }

      const gitDir = path.join(absoluteWorkspace, '.git');
      if (!(await fileExists(gitDir)) && (await commandSucceeds(['git', '--version']))) {
        await commandSucceeds(['git', 'init'], absoluteWorkspace);
      }
    }
  }

  private async ensureAllAgentStorage(): Promise<void> {
    for (const agent of this.state.agents) {
      await this.ensureAgentStorage(agent);
    }
  }

  private async ensureArchitectPresent(): Promise<void> {
    if (this.state.agents.length > 0) {
      return;
    }
    await this.createAgent({
      name: 'Architect',
      responsibility: 'Architect - plan, delegate, and verify agentic work.',
    });
  }

  async init(): Promise<void> {
    await mkdir(this.getAgentsRootDir(), { recursive: true });
    await this.migrateLegacyStorageIfNeeded();
    await this.loadState();
    await this.loadTasks();
    await this.ensureArchitectPresent();
    await this.ensureAllAgentStorage();
    // Always start with the Architect tab
    this.state.activeAgentId = 'agent-architect';
    await this.saveState();
    await this.saveTasks();
  }

  private async loadState(): Promise<void> {
    try {
      const file = Bun.file(this.getAgentsFile());
      if (!(await file.exists())) {
        return;
      }
      const raw = (await file.json()) as Partial<AgentWorkspaceState>;
      const rawAgents = Array.isArray(raw.agents) ? raw.agents : [];
      const agents = rawAgents.map((entry, i) => this.normalizeAgentProfile(entry, i));
      this.state = {
        version: 1,
        activeAgentId:
          typeof raw.activeAgentId === 'string' && raw.activeAgentId.trim()
            ? raw.activeAgentId.trim()
            : '',
        agents,
      };
    } catch {
      // Keep defaults
    }
  }

  private async loadTasks(): Promise<void> {
    try {
      const file = Bun.file(this.getTasksFile());
      if (!(await file.exists())) {
        return;
      }
      const raw = (await file.json()) as Partial<AgentTaskState>;
      this.tasks = {
        version: 1,
        tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
      };
    } catch {
      // Keep defaults
    }
  }

  private async saveState(): Promise<void> {
    await Bun.write(this.getAgentsFile(), JSON.stringify(this.state, null, 2));
  }

  private async saveTasks(): Promise<void> {
    await Bun.write(this.getTasksFile(), JSON.stringify(this.tasks, null, 2));
  }

  listAgents(): AgentProfile[] {
    return [...this.state.agents].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getAgent(agentId: string): AgentProfile | null {
    return this.state.agents.find(a => a.id === agentId) || null;
  }

  getActiveAgentId(): string {
    return this.state.activeAgentId;
  }

  getActiveAgent(): AgentProfile | null {
    return this.getAgent(this.state.activeAgentId);
  }

  async setActiveAgent(agentId: string): Promise<boolean> {
    const agent = this.getAgent(agentId);
    if (!agent) {
      return false;
    }
    this.state.activeAgentId = agentId;
    await this.saveState();
    this.emitUpdated();
    return true;
  }

  private nextAgentId(name: string): string {
    const base = slugify(name) || 'agent';
    let candidate = base.startsWith('agent-') ? base : `agent-${base}`;
    let n = 2;
    while (this.state.agents.some(a => a.id === candidate)) {
      candidate = `${base.startsWith('agent-') ? base : `agent-${base}`}-${n}`;
      n += 1;
    }
    return candidate;
  }

  private getConnectorAgentId(connectorId: string): string {
    const slug = slugify(connectorId) || 'connector';
    return `agent-${slug}agent`;
  }

  async createAgent(input: CreateAgentInput): Promise<AgentProfile> {
    const createdAt = nowIso();
    const name = input.name.trim() || `Agent ${this.state.agents.length + 1}`;
    const id = this.nextAgentId(name);
    const isArchitect = this.state.agents.length === 0;
    const kind = isArchitect ? 'architect' : input.kind || 'custom';
    const responsibility = isArchitect
      ? 'Architect - plan, delegate, and verify agentic work.'
      : input.responsibility?.trim() ||
        'Specialist worker. Execute delegated tasks and report results.';

    const inputPrompt =
      typeof input.systemPrompt === 'string' ? sanitizeAgentPrompt(input.systemPrompt) : '';

    const agent: AgentProfile = {
      id,
      name,
      kind,
      responsibility,
      systemPrompt:
        inputPrompt ||
        (kind === 'architect'
          ? defaultArchitectPrompt(name, responsibility)
          : kind === 'connector'
            ? defaultConnectorPrompt(name, responsibility, id.replace(/^agent-/, '').replace(/agent$/, ''))
            : defaultAgentPrompt(name, responsibility)),
      sessionId: `agent:${id}`,
      workspaceDir: this.resolveAgentWorkspaceDir(id),
      agentDir: this.resolveAgentDir(id),
      enabled: true,
      autoPoll: input.autoPoll ?? (kind !== 'architect' && kind !== 'connector'),
      removable: input.removable ?? (kind !== 'architect' && kind !== 'connector'),
      createdAt,
      updatedAt: createdAt,
    };

    this.state.agents.push(agent);
    if (!this.state.activeAgentId) {
      this.state.activeAgentId = agent.id;
    }
    await this.ensureAgentStorage(agent);
    await this.saveState();
    this.emitUpdated();
    return agent;
  }

  async updateAgent(
    agentId: string,
    patch: Partial<
      Pick<AgentProfile, 'name' | 'responsibility' | 'systemPrompt' | 'enabled' | 'autoPoll'>
    >,
  ): Promise<AgentProfile | null> {
    const agent = this.getAgent(agentId);
    if (!agent) {
      return null;
    }

    if (typeof patch.name === 'string') agent.name = patch.name;
    if (typeof patch.responsibility === 'string') agent.responsibility = patch.responsibility;
    if (typeof patch.systemPrompt === 'string') {
      const cleaned = sanitizeAgentPrompt(patch.systemPrompt);
      if (cleaned) {
        agent.systemPrompt = cleaned;
      }
    }
    if (typeof patch.enabled === 'boolean') agent.enabled = patch.enabled;
    if (typeof patch.autoPoll === 'boolean') agent.autoPoll = patch.autoPoll;
    agent.updatedAt = nowIso();

    await this.ensureAgentStorage(agent);
    await this.saveState();
    this.emitUpdated();
    return agent;
  }

  async ensureConnectorAgent(options: {
    connectorId: string;
    label?: string;
  }): Promise<AgentProfile | null> {
    const connectorId = String(options.connectorId || '').trim().toLowerCase();
    if (!connectorId) {
      return null;
    }

    const fallbackLabel = connectorId.charAt(0).toUpperCase() + connectorId.slice(1);
    const label = (options.label || connectorId).trim() || fallbackLabel;
    const id = this.getConnectorAgentId(connectorId);
    const createdAt = nowIso();
    const connectorName = `${label} Agent`;
    const connectorResponsibility = `${label} connector operations specialist. Handle ${connectorId} requests and execute platform-facing workflows safely.`;
    const connectorPrompt = defaultConnectorPrompt(
      connectorName,
      connectorResponsibility,
      connectorId,
    );

    let agent = this.getAgent(id);
    let changed = false;

    if (!agent) {
      agent = {
        id,
        name: connectorName,
        kind: 'connector',
        responsibility: connectorResponsibility,
        systemPrompt: connectorPrompt,
        sessionId: `agent:${id}`,
        workspaceDir: this.resolveAgentWorkspaceDir(id),
        agentDir: this.resolveAgentDir(id),
        enabled: true,
        autoPoll: false,
        removable: false,
        createdAt,
        updatedAt: createdAt,
      };
      this.state.agents.push(agent);
      changed = true;
    } else {
      if (agent.kind !== 'connector') {
        agent.kind = 'connector';
        changed = true;
      }
      if (!agent.name?.trim()) {
        agent.name = connectorName;
        changed = true;
      }
      if (!agent.responsibility?.trim()) {
        agent.responsibility = connectorResponsibility;
        changed = true;
      }
      if (!agent.systemPrompt?.trim()) {
        agent.systemPrompt = connectorPrompt;
        changed = true;
      }
      if (!agent.sessionId?.trim()) {
        agent.sessionId = `agent:${id}`;
        changed = true;
      }
      if (!agent.workspaceDir?.trim()) {
        agent.workspaceDir = this.resolveAgentWorkspaceDir(id);
        changed = true;
      }
      if (!agent.agentDir?.trim()) {
        agent.agentDir = this.resolveAgentDir(id);
        changed = true;
      }
      if (agent.enabled !== true) {
        agent.enabled = true;
        changed = true;
      }
      if (agent.autoPoll !== false) {
        agent.autoPoll = false;
        changed = true;
      }
      if (agent.removable !== false) {
        agent.removable = false;
        changed = true;
      }
      if (changed) {
        agent.updatedAt = nowIso();
      }
    }

    await this.ensureAgentStorage(agent);
    if (changed) {
      await this.saveState();
      this.emitUpdated();
    }
    return agent;
  }

  resolveAgentId(input: string): string | null {
    const normalized = input.trim().toLowerCase();
    if (!normalized) return null;
    const byId = this.state.agents.find(a => a.id.toLowerCase() === normalized);
    if (byId) return byId.id;
    const byName = this.state.agents.find(a => a.name.toLowerCase() === normalized);
    if (byName) return byName.id;
    return null;
  }

  private async resolveDelegationTarget(input: SendTaskInput): Promise<{
    requestedToAgentId: string;
    toAgentId: string;
    rerouted: boolean;
    reason?: string;
    confidence?: number;
    taskBrief?: string;
  }> {
    const requestedToAgentId = this.resolveAgentId(input.toAgentId) || input.toAgentId;
    const requestedAgent = this.getAgent(requestedToAgentId);
    const fallback = {
      requestedToAgentId,
      toAgentId: requestedToAgentId,
      rerouted: false,
    };

    if (!this.taskRouter || !requestedAgent) {
      return fallback;
    }

    try {
      const decision = await this.taskRouter({
        fromAgentId: input.fromAgentId,
        requestedToAgentId: requestedAgent.id,
        title: input.title,
        content: input.content,
        agents: this.listAgents().filter(agent => agent.enabled),
      });
      if (!decision?.toAgentId) {
        return fallback;
      }

      const routedToId = this.resolveAgentId(decision.toAgentId) || decision.toAgentId;
      const routedAgent = this.getAgent(routedToId);
      if (!routedAgent || !routedAgent.enabled) {
        return fallback;
      }

      const confidence =
        typeof decision.confidence === 'number' && Number.isFinite(decision.confidence)
          ? Math.max(0, Math.min(1, decision.confidence))
          : undefined;
      const reason = typeof decision.rationale === 'string' ? decision.rationale.trim() : '';
      const taskBrief = typeof decision.taskBrief === 'string' ? decision.taskBrief.trim() : '';
      return {
        requestedToAgentId: requestedAgent.id,
        toAgentId: routedAgent.id,
        rerouted: routedAgent.id !== requestedAgent.id,
        reason: reason || undefined,
        confidence,
        taskBrief: taskBrief || undefined,
      };
    } catch {
      return fallback;
    }
  }

  private buildTaskContract(params: {
    fromAgentId: string;
    requestedToAgentId: string;
    toAgentId: string;
    title: string;
    content: string;
    routingReason?: string;
    routingConfidence?: number;
    taskBrief?: string;
  }): string {
    const packetLines = [
      '[task-contract]',
      `from: ${params.fromAgentId}`,
      `requested-target: ${params.requestedToAgentId}`,
      `assigned-target: ${params.toAgentId}`,
      `title: ${params.title}`,
      'autonomy: required',
      'execution-policy:',
      '- Start with concrete execution in repository/runtime tools (read/edit/write/bash/test).',
      '- Use coordination tools only if blocked by missing ownership or missing context.',
      '- If blocked, report exactly what is missing and what you already tried.',
      'definition-of-done:',
      '- Reproduce the issue with concrete commands/steps and expected vs actual behavior.',
      '- Implement a fix (or document exact blocker with evidence).',
      '- Validate with command/test output.',
      '- Summarize files changed, commands run, results, and residual risk.',
      `- Before end_task, send a completion report to ${params.fromAgentId} via <agent-send>.`,
      '[end-task-contract]',
      '',
    ];

    if (params.toAgentId !== params.requestedToAgentId) {
      packetLines.push(
        `[routing] rerouted from ${params.requestedToAgentId} to ${params.toAgentId}`,
        `[routing] reason: ${params.routingReason || 'No rationale provided'}`,
        typeof params.routingConfidence === 'number'
          ? `[routing] confidence: ${params.routingConfidence.toFixed(2)}`
          : '[routing] confidence: n/a',
        '',
      );
    }

    if (params.taskBrief) {
      packetLines.push('Task brief:', params.taskBrief, '');
    }

    packetLines.push('Task details:', params.content.trim());
    return packetLines.join('\n');
  }

  listTasks(): AgentTask[] {
    return [...this.tasks.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listTasksForAgent(agentId: string): AgentTask[] {
    return this.listTasks().filter(t => t.toAgentId === agentId || t.fromAgentId === agentId);
  }

  getTaskStatsForAgent(agentId: string): AgentTaskStats {
    const stats: AgentTaskStats = {
      queued: 0,
      running: 0,
      done: 0,
      failed: 0,
    };
    for (const task of this.tasks.tasks) {
      if (task.toAgentId !== agentId) continue;
      if (task.status === 'queued') stats.queued += 1;
      if (task.status === 'running') stats.running += 1;
      if (task.status === 'done') stats.done += 1;
      if (task.status === 'failed') stats.failed += 1;
    }
    return stats;
  }

  async abandonJobsForAgent(
    agentId: string,
    reason = 'Aborted by user from active tab',
  ): Promise<{ queuedRemoved: number; runningCount: number }> {
    await this.loadTasks();

    let queuedRemoved = 0;
    this.tasks.tasks = this.tasks.tasks.filter(task => {
      if (task.toAgentId !== agentId || task.status !== 'queued') {
        return true;
      }
      queuedRemoved++;
      return false;
    });

    const runningCount = this.tasks.tasks.filter(
      task => task.toAgentId === agentId && task.status === 'running',
    ).length;

    if (queuedRemoved > 0) {
      await this.saveTasks();
    }

    if (queuedRemoved > 0 || runningCount > 0) {
      const agent = this.getAgent(agentId);
      if (agent && runningCount > 0) {
        agent.lastError = reason;
        agent.updatedAt = nowIso();
        await this.saveState();
      }
      this.eventBus.emit({
        type: 'agents:jobs-abandoned',
        agentId,
        queuedRemoved,
        runningCount,
        reason,
      } as any);
      this.emitUpdated();
    }

    return { queuedRemoved, runningCount };
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    const index = this.state.agents.findIndex(a => a.id === agentId);
    if (index < 0) return false;
    if (
      this.state.agents[index].kind === 'architect' ||
      this.state.agents[index].removable === false
    ) {
      return false;
    }

    this.state.agents.splice(index, 1);
    this.inFlightAgents.delete(agentId);
    this.tasks.tasks = this.tasks.tasks.filter(
      t => t.fromAgentId !== agentId && t.toAgentId !== agentId,
    );

    if (this.state.activeAgentId === agentId) {
      this.state.activeAgentId = this.state.agents[0]?.id || '';
    }

    await this.saveState();
    await this.saveTasks();

    try {
      await rm(this.resolveAgentBaseDir(agentId), { recursive: true, force: true });
    } catch {
      // Best effort cleanup only.
    }

    this.emitUpdated();
    return true;
  }

  async sendTask(input: SendTaskInput): Promise<AgentTask> {
    const createdAt = nowIso();
    const resolved = await this.resolveDelegationTarget(input);
    const taskTitle = input.title.trim() || 'Task';
    const content = this.buildTaskContract({
      fromAgentId: input.fromAgentId,
      requestedToAgentId: resolved.requestedToAgentId,
      toAgentId: resolved.toAgentId,
      title: taskTitle,
      content: input.content,
      routingReason: resolved.reason,
      routingConfidence: resolved.confidence,
      taskBrief: resolved.taskBrief,
    });

    const task: AgentTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromAgentId: input.fromAgentId,
      toAgentId: resolved.toAgentId,
      title: taskTitle,
      content,
      status: 'queued',
      createdAt,
      updatedAt: createdAt,
    };
    this.tasks.tasks.push(task);
    await this.saveTasks();
    this.eventBus.emit({ type: 'agents:task-queued', task, agentId: resolved.toAgentId });
    if (resolved.rerouted) {
      this.eventBus.emit({
        type: 'agents:task-rerouted',
        task,
        fromAgentId: resolved.requestedToAgentId,
        toAgentId: resolved.toAgentId,
        reason: resolved.reason,
      } as any);
    }
    this.emitUpdated();
    return task;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.interval = setInterval(() => {
      this.poll().catch(() => {
        // best effort poll loop
      });
    }, DEFAULT_POLL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async poll(): Promise<void> {
    await this.loadTasks();
    const agents = this.listAgents().filter(a => a.enabled && a.autoPoll);
    for (const agent of agents) {
      if (this.inFlightAgents.has(agent.id)) continue;
      const task = this.tasks.tasks.find(t => t.toAgentId === agent.id && t.status === 'queued');
      if (!task) continue;
      await this.runTask(agent, task);
    }
  }

  async runNextForAgent(agentId: string): Promise<boolean> {
    await this.loadTasks();
    const agent = this.getAgent(agentId);
    if (!agent || !agent.enabled) return false;
    if (this.inFlightAgents.has(agent.id)) return false;
    const task = this.tasks.tasks.find(t => t.toAgentId === agent.id && t.status === 'queued');
    if (!task) return false;
    await this.runTask(agent, task);
    return true;
  }

  private async runTask(agent: AgentProfile, task: AgentTask): Promise<void> {
    if (!this.taskExecutor) {
      return;
    }

    this.inFlightAgents.add(agent.id);
    task.status = 'running';
    task.startedAt = nowIso();
    task.updatedAt = task.startedAt;
    await this.saveTasks();
    this.eventBus.emit({ type: 'agents:task-running', task, agentId: agent.id });
    this.emitUpdated();

    try {
      const result = await this.taskExecutor(agent, task);
      task.status = 'done';
      task.resultSummary = result.summary;
      task.finishedAt = nowIso();
      task.updatedAt = task.finishedAt;
      agent.lastRunAt = task.finishedAt;
      agent.lastError = undefined;
      await this.saveTasks();
      await this.saveState();
      this.eventBus.emit({ type: 'agents:task-done', task, agentId: agent.id });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      task.status = 'failed';
      task.error = msg;
      task.finishedAt = nowIso();
      task.updatedAt = task.finishedAt;
      agent.lastRunAt = task.finishedAt;
      agent.lastError = msg;
      await this.saveTasks();
      await this.saveState();
      this.eventBus.emit({ type: 'agents:task-failed', task, agentId: agent.id, error: msg });
    } finally {
      this.inFlightAgents.delete(agent.id);
      this.emitUpdated();
    }
  }

  getSummary(): {
    activeAgentId: string;
    totalAgents: number;
    queued: number;
    running: number;
    done: number;
    failed: number;
    polling: boolean;
  } {
    let queued = 0;
    let running = 0;
    let done = 0;
    let failed = 0;
    for (const task of this.tasks.tasks) {
      if (task.status === 'queued') queued += 1;
      if (task.status === 'running') running += 1;
      if (task.status === 'done') done += 1;
      if (task.status === 'failed') failed += 1;
    }
    return {
      activeAgentId: this.state.activeAgentId,
      totalAgents: this.state.agents.length,
      queued,
      running,
      done,
      failed,
      polling: this.running,
    };
  }

  private emitUpdated(): void {
    this.eventBus.emit({ type: 'agents:updated', summary: this.getSummary() });
  }
}

export function createAgentOrchestratorService(eventBus: EventBus): AgentOrchestratorService {
  return new AgentOrchestratorService(eventBus);
}
