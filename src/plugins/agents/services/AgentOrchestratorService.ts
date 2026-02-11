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
  AgentTaskRunResult,
  AgentTaskStats,
} from './types';

const DEFAULT_POLL_MS = 5000;
const DEFAULT_AGENT_ID = 'agent-1';

const WORKSPACE_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
] as const;

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

function defaultAgentPrompt(name: string, responsibility: string): string {
  const normalizedResponsibility = responsibility.trim().replace(/[.]+$/, '');
  return [
    `You are ${name}.`,
    `Responsibility: ${normalizedResponsibility}.`,
    'Read AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md in your workspace before acting.',
    'Coordinate with other agents using .agents/tasks.json.',
    'Preferred orchestration tools: agents_status, agents_send, sessions_list, sessions_history, sessions_send.',
    'For coordination, do NOT use bash/ls/glob/read_file to inspect .agents or route work.',
    'When delegating work, emit <agent-send to="agent-id" title="short title">task details</agent-send>.',
    'Use say_message for progress updates and end_task only when complete.',
    'Keep outputs concise and execution-focused.',
  ].join('\n');
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
      '- Delegate to other agents via <agent-send> when needed.',
      '- Record key decisions in TOOLS.md when helpful.',
      '',
      '## Prompt',
      agent.systemPrompt,
      '',
    ].join('\n');
  }
  if (fileName === 'SOUL.md') {
    return ['# SOUL.md', '', `You are ${agent.name}.`, 'Work deliberately and communicate clearly.', ''].join(
      '\n',
    );
  }
  if (fileName === 'TOOLS.md') {
    return ['# TOOLS.md', '', '- Add local tool notes here.', '- Add conventions for this agent here.', ''].join(
      '\n',
    );
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
    return ['# HEARTBEAT.md', '', '- [ ] Check delegated queue.', '- [ ] Report blockers to architect.', ''].join(
      '\n',
    );
  }
  return [
    '# BOOTSTRAP.md',
    '',
    `Welcome ${agent.name}.`,
    'This workspace was created automatically in OpenClaw-style layout.',
    '',
  ].join('\n');
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
    activeAgentId: DEFAULT_AGENT_ID,
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

  constructor(@inject(TYPES.EventBus) private readonly eventBus: EventBus) {}

  setWorkDir(workDir: string): void {
    this.workDir = workDir;
  }

  setTaskExecutor(
    executor: ((agent: AgentProfile, task: AgentTask) => Promise<AgentTaskRunResult>) | null,
  ): void {
    this.taskExecutor = executor;
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
    const id = rawId || (index === 0 ? DEFAULT_AGENT_ID : `agent-${index + 1}`);
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

    return {
      id,
      name,
      kind: raw.kind || 'custom',
      responsibility,
      systemPrompt:
        rawPrompt || defaultAgentPrompt(name, responsibility),
      sessionId:
        typeof raw.sessionId === 'string' && raw.sessionId.trim() ? raw.sessionId : `agent:${id}`,
      workspaceDir,
      agentDir,
      enabled: raw.enabled ?? true,
      autoPoll: raw.autoPoll ?? true,
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

  async init(): Promise<void> {
    await mkdir(this.getAgentsRootDir(), { recursive: true });
    await this.migrateLegacyStorageIfNeeded();
    await this.loadState();
    await this.loadTasks();
    await this.ensureDefaultAgent();
    await this.ensureAllAgentStorage();
    if (!this.getAgent(this.state.activeAgentId)) {
      this.state.activeAgentId = this.state.agents[0]?.id || DEFAULT_AGENT_ID;
    }
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
            ? raw.activeAgentId
            : DEFAULT_AGENT_ID,
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

  private async ensureDefaultAgent(): Promise<void> {
    if (this.state.agents.some(a => a.id === DEFAULT_AGENT_ID)) {
      return;
    }

    const createdAt = nowIso();
    const responsibility =
      'Architect and coordinator. Break down tasks and delegate to specialist agents.';
    const defaultAgent: AgentProfile = {
      id: DEFAULT_AGENT_ID,
      name: 'Agent 1',
      kind: 'architect',
      responsibility,
      systemPrompt: defaultAgentPrompt('Agent 1 (Architect)', responsibility),
      sessionId: `agent:${DEFAULT_AGENT_ID}`,
      workspaceDir: this.resolveAgentWorkspaceDir(DEFAULT_AGENT_ID),
      agentDir: this.resolveAgentDir(DEFAULT_AGENT_ID),
      enabled: true,
      autoPoll: false,
      createdAt,
      updatedAt: createdAt,
    };

    this.state.agents.push(defaultAgent);
    this.state.activeAgentId = DEFAULT_AGENT_ID;
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

  async createAgent(input: CreateAgentInput): Promise<AgentProfile> {
    const createdAt = nowIso();
    const name = input.name.trim() || `Agent ${this.state.agents.length + 1}`;
    const id = this.nextAgentId(name);
    const responsibility =
      input.responsibility?.trim() || 'Specialist worker. Execute delegated tasks and report results.';

    const inputPrompt =
      typeof input.systemPrompt === 'string' ? sanitizeAgentPrompt(input.systemPrompt) : '';

    const agent: AgentProfile = {
      id,
      name,
      kind: input.kind || 'custom',
      responsibility,
      systemPrompt: inputPrompt || defaultAgentPrompt(name, responsibility),
      sessionId: `agent:${id}`,
      workspaceDir: this.resolveAgentWorkspaceDir(id),
      agentDir: this.resolveAgentDir(id),
      enabled: true,
      autoPoll: input.autoPoll ?? true,
      createdAt,
      updatedAt: createdAt,
    };

    this.state.agents.push(agent);
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

  resolveAgentId(input: string): string | null {
    const normalized = input.trim().toLowerCase();
    if (!normalized) return null;
    const byId = this.state.agents.find(a => a.id.toLowerCase() === normalized);
    if (byId) return byId.id;
    const byName = this.state.agents.find(a => a.name.toLowerCase() === normalized);
    if (byName) return byName.id;
    return null;
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
    if (this.state.agents.length <= 1) return false;

    this.state.agents.splice(index, 1);
    this.inFlightAgents.delete(agentId);
    this.tasks.tasks = this.tasks.tasks.filter(t => t.fromAgentId !== agentId && t.toAgentId !== agentId);

    if (this.state.activeAgentId === agentId) {
      this.state.activeAgentId = this.state.agents[0]?.id || DEFAULT_AGENT_ID;
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
    const task: AgentTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      title: input.title.trim() || 'Task',
      content: input.content.trim(),
      status: 'queued',
      createdAt,
      updatedAt: createdAt,
    };
    this.tasks.tasks.push(task);
    await this.saveTasks();
    this.eventBus.emit({ type: 'agents:task-queued', task, agentId: input.toAgentId });
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
