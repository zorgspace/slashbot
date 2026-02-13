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
  AgentRunRecord,
  AgentRunState,
  AgentRunStatus,
  AgentStatusEntry,
  AgentCapabilityReport,
  AgentLifecycleStatus,
  AgentOrchestratorSummary,
  CreateAgentInput,
  SendTaskInput,
  AgentRoutingRequest,
  AgentRoutingDecision,
  AgentTaskRunResult,
  AgentTaskStats,
  AgentTaskVerificationStatus,
} from './types';

const DEFAULT_POLL_MS = 5000;
const DEFAULT_TASK_MAX_RETRIES = 2;
const DEFAULT_STATUS_HEARTBEAT_MS = 5000;
const DEFAULT_RUNNING_STALL_MS = 2 * 60 * 1000;
const DEFAULT_QUEUED_STALL_MS = 3 * 60 * 1000;
const DEFAULT_VERIFICATION_PENDING_MS = 60 * 1000;
const DEFAULT_VERIFICATION_REMINDER_COOLDOWN_MS = 60 * 1000;
const DEFAULT_RUN_ARCHIVE_MS = 60 * 60 * 1000;
const DEFAULT_RUN_HISTORY_MAX = 300;
const DEFAULT_HEARTBEAT_PERSIST_MS = 30 * 1000;

const RECOVERABLE_TASK_FAILURE_PATTERNS: RegExp[] = [
  /did not finish with an <end_task>/i,
  /task ended with failed verification/i,
  /verification command failed/i,
  /\bverification failed\b/i,
  /\bbuild failed\b/i,
  /\btest(?:s)? failed\b/i,
  /\blint failed\b/i,
  /\btypecheck failed\b/i,
  /\bcommand failed\b/i,
  /\bexit code\b/i,
  /cannot finish .* unresolved edit failures/i,
];

const FAILED_COMPLETION_PATTERNS: RegExp[] = [
  /\bbuild failed\b/i,
  /\btest(?:s)? failed\b/i,
  /\bverification failed\b/i,
  /\blint failed\b/i,
  /\btypecheck failed\b/i,
  /\bunable to\b/i,
  /\bcould not\b/i,
  /\bblocked\b/i,
  /\bnot (?:fixed|resolved|verified)\b/i,
];

const PASSED_COMPLETION_PATTERNS: RegExp[] = [
  /\bbuild pass(?:ed|es)?\b/i,
  /\btests? pass(?:ed|es)?\b/i,
  /\bverification pass(?:ed|es)?\b/i,
  /\b0 failed\b/i,
  /\bno (?:tests?\s+)?failed\b/i,
  /\bno failures\b/i,
  /\ball checks pass(?:ed|es)?\b/i,
];

const WORKSPACE_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
] as const;
const REMOVED_CONNECTOR_AGENT_SLUGS = new Set(['telegram', 'discord']);

function isRemovedLegacyConnectorAgentId(agentId: string): boolean {
  const normalized = String(agentId || '')
    .trim()
    .toLowerCase();
  const match = normalized.match(/^agent-([a-z0-9-]+)agent$/);
  if (!match) {
    return false;
  }
  return REMOVED_CONNECTOR_AGENT_SLUGS.has(match[1]);
}

type AgentTaskRouter = (request: AgentRoutingRequest) => Promise<AgentRoutingDecision | null>;

function nowIso(): string {
  return new Date().toISOString();
}

function parseIsoMs(value?: string): number | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function elapsedSinceMs(from?: string, fallbackNow = Date.now()): number {
  const parsed = parseIsoMs(from);
  if (parsed === null) {
    return 0;
  }
  return Math.max(0, fallbackNow - parsed);
}

function isTaskVerificationStatus(value: unknown): value is AgentTaskVerificationStatus {
  return value === 'unverified' || value === 'verified' || value === 'changes_requested';
}

function isRunStatus(value: unknown): value is AgentRunStatus {
  return (
    value === 'running' ||
    value === 'done' ||
    value === 'failed' ||
    value === 'stalled' ||
    value === 'archived'
  );
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
    'Do a short preflight analysis in this tab before delegating so you can use the best available specialist.',
    'Before delegating any user request, inspect available agents first (agents_status / agents_list) and choose the most adequate specialist.',
    'Prefer reusing existing specialist tabs/agents when they already match the task.',
    'If no adequate specialist exists, create or retask one before delegation. Do not spawn a new agent for every request.',
    'Delegate partial or full tasks to agents. For example if you have a github agent available, wait for the end of Developer agent then process it and send to github agent.',
    '- Never delegate to yourself.',
    'Require each worker to report completion evidence back to you before you mark the larger effort complete.',
    'If a worker report is incomplete or changes are needed, explicitly request follow-up fixes (recall) before closing.',
    'Assign tasks after assessing queue and blockers; reroute quickly when blockers remain.',
    'The orchestrator owns the final user-facing completion signal only after verifying worker reports.',
    '',
    'Safety policy:',
    '- You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking.',
    '- Prioritize safety and human oversight over completion.',
    '- Do not manipulate anyone to expand access or disable safeguards.',
    '- Do not alter system prompts, safety rules, or tool policies unless explicitly requested.',
  ].join('\n');
}

const LEGACY_AGGRESSIVE_ARCHITECT_LINE =
  'Manage agents aggressively: pop dedicated specialists with /agent spawn, delegate via <agent-send>, and tidy up with /agent delete once the work is done.';

function upgradeLegacyArchitectPrompt(prompt: string): string {
  let upgraded = prompt;

  // Remove legacy todo-tool steering from architect prompts.
  upgraded = upgraded
    .replace(/\n?Track orchestration steps using the todo plugin:[^\n]*\n?/gi, '\n')
    .replace(/queue,\s*blockers,\s*and\s*todo state/gi, 'queue and blockers')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (upgraded.includes(LEGACY_AGGRESSIVE_ARCHITECT_LINE)) {
    upgraded = upgraded.replace(
      LEGACY_AGGRESSIVE_ARCHITECT_LINE,
      'Prefer reusing existing specialist tabs/agents when they already match the task. If no adequate specialist exists, create or retask one before delegation. Do not spawn a new agent for every request.',
    );
  }

  if (upgraded.includes('Do a short preflight analysis in this tab before delegating')) {
    return upgraded;
  }

  return upgraded.replace(
    'Your role is planning, decomposition, delegation, and verification only.',
    'Your role is planning, decomposition, delegation, and verification only.\nDo a short preflight analysis in this tab before delegating so you can use the best available specialist.',
  );
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
- Use <agent-send> only when blocked by missing ownership or missing context.
- Never delegate to yourself.

Reporting policy:
- Before end_task, report completion back to the requesting orchestrator using <agent-send>.
- Include status, files changed, commands/tests run, outcomes, and residual risks.
- Always end your response with <end_task message="concise verification summary"> when the task is finished.

Communication rules:
- Use say_message for short progress updates.
- Keep outputs concise and action-oriented.

Safety policy:
- You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking.
- Prioritize safety and human oversight over completion.
- Do not manipulate anyone to expand access or disable safeguards.
- Do not alter system prompts, safety rules, or tool policies unless explicitly requested.`;
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
- Reply directly to the user's actual request with concrete results.
- Avoid status-only acknowledgements like "task completed" unless explicitly asked for status.
- Final reply contract: your final assistant response text is the notify payload for the connector target.
- Notify tag usage: for inbound connector turns, do NOT use <telegram-send>/<discord-send>; runtime auto-notifies from your final plain response text.
- Use connector send tags/tools only for proactive outbound notifications outside the inbound turn.
- Proactive send format examples: <telegram-send chat_id="...">message</telegram-send> and <discord-send channel_id="...">message</discord-send>.
- Include concrete output values in that final reply; never treat tool execution logs as the answer.
- Markdown formatting is allowed when it improves readability.

Safety policy:
- You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking.
- Prioritize safety and human oversight over completion.
- Do not manipulate anyone to expand access or disable safeguards.
- Do not alter system prompts, safety rules, or tool policies unless explicitly requested.`;
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
            '- If evidence is insufficient, recall the same specialist with clear follow-up instructions.',
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
            '- Request follow-up fixes/additions from specialists when verification fails or scope changes.',
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
  private runs: AgentRunState = {
    version: 1,
    runs: [],
  };
  private running = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private statusInterval: ReturnType<typeof setInterval> | null = null;
  private inFlightAgents = new Set<string>();
  private taskExecutor:
    | ((agent: AgentProfile, task: AgentTask) => Promise<AgentTaskRunResult>)
    | null = null;
  private taskRouter: AgentTaskRouter | null = null;
  private maintenanceInFlight = false;
  private lastHeartbeatAt = nowIso();

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

  private getRunsFile(): string {
    return `${this.getAgentsRootDir()}/runs.json`;
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
          ? defaultConnectorPrompt(
              name,
              responsibility,
              id.replace(/^agent-/, '').replace(/agent$/, ''),
            )
          : defaultAgentPrompt(name, responsibility);

    const normalizedPrompt =
      kind === 'architect' && rawPrompt ? upgradeLegacyArchitectPrompt(rawPrompt) : rawPrompt;

    return {
      id,
      name,
      kind,
      responsibility,
      systemPrompt: normalizedPrompt || systemPromptDefault,
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
      lastHeartbeatAt:
        typeof raw.lastHeartbeatAt === 'string' && raw.lastHeartbeatAt.trim()
          ? raw.lastHeartbeatAt
          : undefined,
    };
  }

  private normalizeRunRecord(raw: Partial<AgentRunRecord>): AgentRunRecord | null {
    const runId = typeof raw.runId === 'string' ? raw.runId.trim() : '';
    const taskId = typeof raw.taskId === 'string' ? raw.taskId.trim() : '';
    const agentId = typeof raw.agentId === 'string' ? raw.agentId.trim() : '';
    const fromAgentId = typeof raw.fromAgentId === 'string' ? raw.fromAgentId.trim() : '';
    if (!runId || !taskId || !agentId || !fromAgentId) {
      return null;
    }

    const createdAt = typeof raw.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt : nowIso();
    const status = isRunStatus(raw.status) ? raw.status : 'running';
    const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : 'Task run';
    const normalized: AgentRunRecord = {
      runId,
      taskId,
      agentId,
      fromAgentId,
      status,
      label,
      createdAt,
    };

    if (typeof raw.startedAt === 'string' && raw.startedAt.trim()) {
      normalized.startedAt = raw.startedAt;
    }
    if (typeof raw.endedAt === 'string' && raw.endedAt.trim()) {
      normalized.endedAt = raw.endedAt;
    }
    if (typeof raw.lastHeartbeatAt === 'string' && raw.lastHeartbeatAt.trim()) {
      normalized.lastHeartbeatAt = raw.lastHeartbeatAt;
    }
    if (typeof raw.summary === 'string' && raw.summary.trim()) {
      normalized.summary = raw.summary.trim();
    }
    if (typeof raw.error === 'string' && raw.error.trim()) {
      normalized.error = raw.error.trim();
    }
    if (typeof raw.archivedAt === 'string' && raw.archivedAt.trim()) {
      normalized.archivedAt = raw.archivedAt;
    }
    return normalized;
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
    await this.loadRuns();
    await this.ensureArchitectPresent();
    this.reconcileRunStateFromTasks();
    this.lastHeartbeatAt = nowIso();
    await this.ensureAllAgentStorage();
    // Always start with the Architect tab
    this.state.activeAgentId = 'agent-architect';
    await this.saveState();
    await this.saveTasks();
    await this.saveRuns();
    this.emitSummaryHeartbeat();
  }

  private async loadState(): Promise<void> {
    try {
      const file = Bun.file(this.getAgentsFile());
      if (!(await file.exists())) {
        return;
      }
      const raw = (await file.json()) as Partial<AgentWorkspaceState>;
      const rawAgents = Array.isArray(raw.agents) ? raw.agents : [];
      const filteredRawAgents = rawAgents.filter(entry => {
        const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
        return !isRemovedLegacyConnectorAgentId(id);
      });
      const agents = filteredRawAgents.map((entry, i) => this.normalizeAgentProfile(entry, i));
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
      const loadedTasks = Array.isArray(raw.tasks) ? raw.tasks : [];
      const tasks = loadedTasks
        .filter(task => {
          const from = typeof task?.fromAgentId === 'string' ? task.fromAgentId.trim() : '';
          const to = typeof task?.toAgentId === 'string' ? task.toAgentId.trim() : '';
          return !isRemovedLegacyConnectorAgentId(from) && !isRemovedLegacyConnectorAgentId(to);
        })
        .map(task => {
          const normalized = { ...(task as AgentTask) };
          if (!isTaskVerificationStatus(normalized.verificationStatus)) {
            normalized.verificationStatus =
              normalized.status === 'done' ? 'unverified' : normalized.verificationStatus;
          }
          if (normalized.status !== 'done') {
            normalized.awaitingVerificationSince = undefined;
          } else if (
            typeof normalized.awaitingVerificationSince !== 'string' ||
            !normalized.awaitingVerificationSince.trim()
          ) {
            normalized.awaitingVerificationSince = normalized.finishedAt || normalized.updatedAt;
          }
          if (typeof normalized.recallCount !== 'number' || !Number.isFinite(normalized.recallCount)) {
            normalized.recallCount = undefined;
          }
          if (
            typeof normalized.verificationNotes !== 'string' ||
            !normalized.verificationNotes.trim()
          ) {
            normalized.verificationNotes = undefined;
          }
          if (
            typeof normalized.verifiedByAgentId !== 'string' ||
            !normalized.verifiedByAgentId.trim()
          ) {
            normalized.verifiedByAgentId = undefined;
          }
          if (typeof normalized.verifiedAt !== 'string' || !normalized.verifiedAt.trim()) {
            normalized.verifiedAt = undefined;
          }
          if (typeof normalized.recallOfTaskId !== 'string' || !normalized.recallOfTaskId.trim()) {
            normalized.recallOfTaskId = undefined;
          }
          if (typeof normalized.runId !== 'string' || !normalized.runId.trim()) {
            normalized.runId = undefined;
          }
          if (typeof normalized.stalledAt !== 'string' || !normalized.stalledAt.trim()) {
            normalized.stalledAt = undefined;
          }
          if (typeof normalized.staleReason !== 'string' || !normalized.staleReason.trim()) {
            normalized.staleReason = undefined;
          }
          if (typeof normalized.lastHeartbeatAt !== 'string' || !normalized.lastHeartbeatAt.trim()) {
            normalized.lastHeartbeatAt = undefined;
          }
          if (
            typeof normalized.lastVerificationReminderAt !== 'string' ||
            !normalized.lastVerificationReminderAt.trim()
          ) {
            normalized.lastVerificationReminderAt = undefined;
          }
          return normalized;
        });
      this.tasks = {
        version: 1,
        tasks,
      };
    } catch {
      // Keep defaults
    }
  }

  private async loadRuns(): Promise<void> {
    try {
      const file = Bun.file(this.getRunsFile());
      if (!(await file.exists())) {
        return;
      }
      const raw = (await file.json()) as Partial<AgentRunState>;
      const rawRuns = Array.isArray(raw.runs) ? raw.runs : [];
      const normalizedRuns: AgentRunRecord[] = [];
      for (const rawRun of rawRuns) {
        const normalized = this.normalizeRunRecord(rawRun as Partial<AgentRunRecord>);
        if (!normalized) {
          continue;
        }
        normalizedRuns.push(normalized);
      }
      this.runs = {
        version: 1,
        runs: normalizedRuns,
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

  private async saveRuns(): Promise<void> {
    await Bun.write(this.getRunsFile(), JSON.stringify(this.runs, null, 2));
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
            ? defaultConnectorPrompt(
                name,
                responsibility,
                id.replace(/^agent-/, '').replace(/agent$/, ''),
              )
            : defaultAgentPrompt(name, responsibility)),
      sessionId: `agent:${id}`,
      workspaceDir: this.resolveAgentWorkspaceDir(id),
      agentDir: this.resolveAgentDir(id),
      enabled: true,
      autoPoll: input.autoPoll ?? (kind !== 'architect' && kind !== 'connector'),
      removable: input.removable ?? (kind !== 'architect' && kind !== 'connector'),
      createdAt,
      updatedAt: createdAt,
      lastHeartbeatAt: createdAt,
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
    const connectorId = String(options.connectorId || '')
      .trim()
      .toLowerCase();
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
        lastHeartbeatAt: createdAt,
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
      '- Use <agent-send> only if blocked by missing ownership or missing context.',
      '- If blocked, report exactly what is missing and what you already tried.',
      'definition-of-done:',
      '- Reproduce the issue with concrete commands/steps and expected vs actual behavior.',
      '- Implement a fix (or document exact blocker with evidence).',
      '- Validate with command/test output.',
      '- If build/test/lint/typecheck fails, do not end_task yet. Fix and rerun verification until passing (or report an explicit blocker).',
      '- Summarize files changed, commands run, results, and residual risk.',
      `- Before end_task, send a completion report to ${params.fromAgentId} via <agent-send>.`,
      '- Completion report must include a "verification evidence" section with exact commands/tests and outcomes.',
      '- If the orchestrator requests follow-up fixes/additions, continue execution and submit a fresh completion report.',
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

  getTask(taskId: string): AgentTask | null {
    const normalizedId = String(taskId || '').trim();
    if (!normalizedId) {
      return null;
    }
    return this.tasks.tasks.find(task => task.id === normalizedId) || null;
  }

  listRuns(options?: {
    agentId?: string;
    status?: AgentRunStatus;
    limit?: number;
  }): AgentRunRecord[] {
    const agentId = typeof options?.agentId === 'string' ? options.agentId.trim() : '';
    const status = isRunStatus(options?.status) ? options?.status : undefined;
    const limitRaw = options?.limit;
    const limit =
      typeof limitRaw === 'number' && Number.isFinite(limitRaw)
        ? Math.max(1, Math.floor(limitRaw))
        : 40;
    let runs = [...this.runs.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (agentId) {
      runs = runs.filter(run => run.agentId === agentId);
    }
    if (status) {
      runs = runs.filter(run => run.status === status);
    }
    return runs.slice(0, limit);
  }

  private getRunRecord(runId?: string): AgentRunRecord | null {
    if (!runId) {
      return null;
    }
    return this.runs.runs.find(run => run.runId === runId) || null;
  }

  private upsertRunRecord(run: AgentRunRecord): void {
    const index = this.runs.runs.findIndex(entry => entry.runId === run.runId);
    if (index >= 0) {
      this.runs.runs[index] = run;
      return;
    }
    this.runs.runs.push(run);
  }

  private updateRunRecord(runId: string, patch: Partial<AgentRunRecord>): AgentRunRecord | null {
    const run = this.getRunRecord(runId);
    if (!run) {
      return null;
    }
    Object.assign(run, patch);
    this.upsertRunRecord(run);
    return run;
  }

  private makeRunRecord(agent: AgentProfile, task: AgentTask, runId: string, startedAt: string): AgentRunRecord {
    return {
      runId,
      taskId: task.id,
      agentId: agent.id,
      fromAgentId: task.fromAgentId,
      status: 'running',
      label: task.title || 'Task run',
      createdAt: startedAt,
      startedAt,
      lastHeartbeatAt: startedAt,
      archivedAt: new Date(Date.now() + DEFAULT_RUN_ARCHIVE_MS).toISOString(),
    };
  }

  private markRunAsSettled(params: {
    runId?: string;
    status: Exclude<AgentRunStatus, 'running'>;
    summary?: string;
    error?: string;
    endedAt?: string;
  }): void {
    if (!params.runId) {
      return;
    }
    const endedAt = params.endedAt || nowIso();
    const current = this.getRunRecord(params.runId);
    if (!current) {
      return;
    }
    current.status = params.status;
    current.endedAt = endedAt;
    current.lastHeartbeatAt = endedAt;
    current.summary = params.summary?.trim() || current.summary;
    current.error = params.error?.trim() || current.error;
    current.archivedAt = new Date(Date.now() + DEFAULT_RUN_ARCHIVE_MS).toISOString();
    this.upsertRunRecord(current);
  }

  private reconcileRunStateFromTasks(): void {
    const now = nowIso();
    const taskIds = new Set(this.tasks.tasks.map(task => task.id));
    for (const run of this.runs.runs) {
      if (!taskIds.has(run.taskId) && (run.status === 'running' || run.status === 'stalled')) {
        run.status = 'failed';
        run.error = run.error || 'Run orphaned: task missing from registry';
        run.endedAt = now;
        run.archivedAt = new Date(Date.now() + DEFAULT_RUN_ARCHIVE_MS).toISOString();
      }
    }

    for (const task of this.tasks.tasks) {
      if (!task.runId) {
        continue;
      }
      const existing = this.getRunRecord(task.runId);
      if (existing) {
        if (task.status === 'running' && existing.status === 'running') {
          existing.lastHeartbeatAt = task.lastHeartbeatAt || now;
        }
        continue;
      }
      const restoredStatus: AgentRunStatus =
        task.status === 'running'
          ? task.stalledAt
            ? 'stalled'
            : 'running'
          : task.status === 'done'
            ? 'done'
            : task.status === 'failed'
              ? 'failed'
              : 'archived';
      this.runs.runs.push({
        runId: task.runId,
        taskId: task.id,
        agentId: task.toAgentId,
        fromAgentId: task.fromAgentId,
        status: restoredStatus,
        label: task.title || 'Task run',
        createdAt: task.startedAt || task.createdAt,
        startedAt: task.startedAt,
        endedAt: task.finishedAt,
        lastHeartbeatAt: task.lastHeartbeatAt || task.updatedAt,
        summary: task.resultSummary,
        error: task.error,
        archivedAt: new Date(Date.now() + DEFAULT_RUN_ARCHIVE_MS).toISOString(),
      });
    }
  }

  private buildAgentCapability(agent: AgentProfile): AgentCapabilityReport {
    const requirements = ['session-id', 'workspace-dir', 'agent-dir'];
    const missing: string[] = [];
    if (!agent.sessionId?.trim()) {
      missing.push('session-id');
    }
    if (!agent.workspaceDir?.trim()) {
      missing.push('workspace-dir');
    }
    if (!agent.agentDir?.trim()) {
      missing.push('agent-dir');
    }
    if (agent.kind === 'connector' && agent.autoPoll) {
      missing.push('connector-autopoll-off');
    }
    return {
      ready: missing.length === 0,
      requirements,
      missing,
      checkedAt: nowIso(),
    };
  }

  private getCurrentTaskSnapshot(
    agentId: string,
    nowMs: number,
  ): AgentStatusEntry['currentTask'] | undefined {
    const running = this.tasks.tasks.find(task => task.toAgentId === agentId && task.status === 'running');
    const queued = this.tasks.tasks
      .filter(task => task.toAgentId === agentId && task.status === 'queued')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    const current = running || queued;
    if (!current) {
      return undefined;
    }
    const baseTime = current.startedAt || current.createdAt;
    return {
      id: current.id,
      title: current.title,
      status: current.status,
      queuedAt: current.createdAt,
      startedAt: current.startedAt,
      updatedAt: current.updatedAt,
      durationMs: elapsedSinceMs(baseTime, nowMs),
      staleReason: current.staleReason,
      runId: current.runId,
    };
  }

  private resolveLifecycle(
    agent: AgentProfile,
    stats: AgentTaskStats,
    currentTask: AgentStatusEntry['currentTask'],
  ): AgentLifecycleStatus {
    if (!agent.enabled) {
      return 'disabled';
    }
    if (stats.stalled > 0 || !!currentTask?.staleReason) {
      return 'stalled';
    }
    if (stats.running > 0) {
      return 'running';
    }
    if (stats.queued > 0) {
      return 'queued';
    }
    if (agent.lastError || stats.failed > 0) {
      return 'blocked';
    }
    return 'idle';
  }

  getAgentStatuses(): AgentStatusEntry[] {
    const nowMs = Date.now();
    return this.listAgents().map(agent => {
      const stats = this.getTaskStatsForAgent(agent.id);
      const currentTask = this.getCurrentTaskSnapshot(agent.id, nowMs);
      const stalledTaskId =
        this.tasks.tasks.find(task => task.toAgentId === agent.id && !!task.stalledAt)?.id || undefined;
      return {
        agentId: agent.id,
        sessionId: agent.sessionId,
        name: agent.name,
        kind: agent.kind,
        enabled: agent.enabled,
        autoPoll: agent.autoPoll,
        lifecycle: this.resolveLifecycle(agent, stats, currentTask),
        stats,
        inFlightTaskId:
          this.tasks.tasks.find(task => task.toAgentId === agent.id && task.status === 'running')
            ?.id || undefined,
        stalledTaskId,
        lastRunAt: agent.lastRunAt,
        lastError: agent.lastError,
        lastHeartbeatAt: agent.lastHeartbeatAt,
        currentTask,
        capability: this.buildAgentCapability(agent),
      };
    });
  }

  async verifyTask(input: {
    taskId: string;
    verifierAgentId: string;
    status: AgentTaskVerificationStatus;
    notes?: string;
  }): Promise<AgentTask | null> {
    await this.loadTasks();

    const task = this.getTask(input.taskId);
    if (!task || task.status !== 'done') {
      return null;
    }
    if (!isTaskVerificationStatus(input.status) || input.status === 'unverified') {
      return null;
    }

    const verifierAgentId = String(input.verifierAgentId || '').trim();
    if (!verifierAgentId || !this.getAgent(verifierAgentId)) {
      return null;
    }

    const now = nowIso();
    const notes = typeof input.notes === 'string' ? input.notes.trim() : '';

    task.verificationStatus = input.status;
    task.verifiedByAgentId = verifierAgentId;
    task.verifiedAt = now;
    task.verificationNotes = notes || undefined;
    task.awaitingVerificationSince = undefined;
    task.lastVerificationReminderAt = undefined;
    task.staleReason = undefined;
    task.updatedAt = now;

    await this.saveTasks();
    this.eventBus.emit({
      type: 'agents:task-verified',
      task,
      taskId: task.id,
      verifierAgentId,
      verificationStatus: task.verificationStatus,
    } as any);
    this.emitUpdated();
    return task;
  }

  async recallTask(input: {
    taskId: string;
    fromAgentId: string;
    reason: string;
    title?: string;
  }): Promise<AgentTask | null> {
    await this.loadTasks();

    const sourceTask = this.getTask(input.taskId);
    if (!sourceTask || (sourceTask.status !== 'done' && sourceTask.status !== 'failed')) {
      return null;
    }

    const fromAgentId = String(input.fromAgentId || '').trim() || sourceTask.fromAgentId;
    const fromAgent = this.getAgent(fromAgentId);
    const targetAgent = this.getAgent(sourceTask.toAgentId);
    if (!fromAgent || !targetAgent || !targetAgent.enabled) {
      return null;
    }

    const reason = String(input.reason || '').trim();
    if (!reason) {
      return null;
    }

    const now = nowIso();
    const normalizedTitle = String(input.title || '').trim();
    const title = normalizedTitle || `Follow-up: ${sourceTask.title}`;

    sourceTask.verificationStatus = 'changes_requested';
    sourceTask.verifiedByAgentId = fromAgentId;
    sourceTask.verifiedAt = now;
    sourceTask.verificationNotes = reason;
    sourceTask.recallCount = (sourceTask.recallCount || 0) + 1;
    sourceTask.awaitingVerificationSince = undefined;
    sourceTask.lastVerificationReminderAt = undefined;
    sourceTask.staleReason = undefined;
    sourceTask.updatedAt = now;

    const followUpDetails = [
      `Follow-up request for task ${sourceTask.id}.`,
      `Requested by: ${fromAgentId}`,
      `Reason: ${reason}`,
      '',
      'Apply the requested fixes/additions, rerun verification, and report back with updated evidence.',
      sourceTask.resultSummary ? 'Previous completion summary:' : '',
      sourceTask.resultSummary ? sourceTask.resultSummary : '',
    ]
      .filter(Boolean)
      .join('\n');

    const content = this.buildTaskContract({
      fromAgentId,
      requestedToAgentId: targetAgent.id,
      toAgentId: targetAgent.id,
      title,
      content: followUpDetails,
    });

    const recalledTask: AgentTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromAgentId,
      toAgentId: targetAgent.id,
      title,
      content,
      status: 'queued',
      retryCount: 0,
      maxRetries: DEFAULT_TASK_MAX_RETRIES,
      recallOfTaskId: sourceTask.id,
      recallCount: sourceTask.recallCount,
      createdAt: now,
      updatedAt: now,
      lastHeartbeatAt: now,
    };

    this.tasks.tasks.push(recalledTask);
    await this.saveTasks();
    this.eventBus.emit({
      type: 'agents:task-recalled',
      sourceTaskId: sourceTask.id,
      task: recalledTask,
      agentId: targetAgent.id,
      reason,
    } as any);
    this.eventBus.emit({
      type: 'agents:task-queued',
      task: recalledTask,
      agentId: targetAgent.id,
    });
    this.emitUpdated();
    return recalledTask;
  }

  getTaskStatsForAgent(agentId: string): AgentTaskStats {
    const stats: AgentTaskStats = {
      queued: 0,
      running: 0,
      done: 0,
      failed: 0,
      stalled: 0,
      needsVerification: 0,
    };
    for (const task of this.tasks.tasks) {
      if (task.toAgentId !== agentId) continue;
      if (task.status === 'queued') stats.queued += 1;
      if (task.status === 'running') stats.running += 1;
      if (task.status === 'done') stats.done += 1;
      if (task.status === 'failed') stats.failed += 1;
      if (task.stalledAt) stats.stalled += 1;
      if (
        task.status === 'done' &&
        (!task.verificationStatus || task.verificationStatus === 'unverified')
      ) {
        stats.needsVerification += 1;
      }
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
    this.runs.runs = this.runs.runs.filter(
      run => run.agentId !== agentId && run.fromAgentId !== agentId,
    );

    if (this.state.activeAgentId === agentId) {
      this.state.activeAgentId = this.state.agents[0]?.id || '';
    }

    await this.saveState();
    await this.saveTasks();
    await this.saveRuns();

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
      retryCount: 0,
      maxRetries: DEFAULT_TASK_MAX_RETRIES,
      recallCount: 0,
      createdAt,
      updatedAt: createdAt,
      lastHeartbeatAt: createdAt,
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
    this.emitSummaryHeartbeat();
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
    this.statusInterval = setInterval(() => {
      this.runAutonomousStatusMaintenance().catch(() => {
        // best effort maintenance loop
      });
    }, DEFAULT_STATUS_HEARTBEAT_MS);
    await this.runAutonomousStatusMaintenance();
  }

  stop(): void {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
  }

  private async poll(): Promise<void> {
    await this.loadTasks();
    await this.loadRuns();
    await this.runAutonomousStatusMaintenance({ emitHeartbeat: false });
    const agents = this.listAgents().filter(a => a.enabled && a.autoPoll);
    const runs: Promise<void>[] = [];
    for (const agent of agents) {
      if (this.inFlightAgents.has(agent.id)) continue;
      const task = this.tasks.tasks.find(t => t.toAgentId === agent.id && t.status === 'queued');
      if (!task) continue;
      runs.push(this.runTask(agent, task));
    }
    if (runs.length > 0) {
      await Promise.allSettled(runs);
    }
    this.emitSummaryHeartbeat();
  }

  async runNextForAgent(agentId: string): Promise<boolean> {
    await this.loadTasks();
    await this.loadRuns();
    await this.runAutonomousStatusMaintenance({ emitHeartbeat: false });
    const agent = this.getAgent(agentId);
    if (!agent || !agent.enabled) return false;
    if (this.inFlightAgents.has(agent.id)) return false;
    const task = this.tasks.tasks.find(t => t.toAgentId === agent.id && t.status === 'queued');
    if (!task) return false;
    await this.runTask(agent, task);
    this.emitSummaryHeartbeat();
    return true;
  }

  private summaryLooksUnverified(summary: string): boolean {
    const normalized = summary.trim();
    if (!normalized) {
      return false;
    }
    if (!FAILED_COMPLETION_PATTERNS.some(pattern => pattern.test(normalized))) {
      return false;
    }
    return !PASSED_COMPLETION_PATTERNS.some(pattern => pattern.test(normalized));
  }

  private shouldRetryTaskFailure(task: AgentTask, errorMessage: string): boolean {
    const retriesUsed = Math.max(0, Number(task.retryCount || 0));
    const maxRetries = Math.max(0, Number(task.maxRetries ?? DEFAULT_TASK_MAX_RETRIES));
    if (retriesUsed >= maxRetries) {
      return false;
    }
    return RECOVERABLE_TASK_FAILURE_PATTERNS.some(pattern => pattern.test(errorMessage));
  }

  private appendRetryContext(task: AgentTask, errorMessage: string): void {
    const retriesUsed = Math.max(0, Number(task.retryCount || 0));
    const maxRetries = Math.max(0, Number(task.maxRetries ?? DEFAULT_TASK_MAX_RETRIES));
    const compactError = errorMessage.replace(/\s+/g, ' ').trim().slice(0, 600);
    task.content = [
      task.content,
      '',
      `[retry-attempt ${retriesUsed}/${maxRetries}]`,
      `Previous attempt ended with recoverable failure: ${compactError}`,
      'Continue execution, fix the root cause, and rerun verification commands until they pass before end_task.',
      '[end-retry-attempt]',
    ].join('\n');
  }

  private async runTask(agent: AgentProfile, task: AgentTask): Promise<void> {
    if (!this.taskExecutor) {
      return;
    }

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = nowIso();
    this.inFlightAgents.add(agent.id);
    task.status = 'running';
    task.runId = runId;
    task.startedAt = startedAt;
    task.updatedAt = startedAt;
    task.error = undefined;
    task.stalledAt = undefined;
    task.staleReason = undefined;
    task.awaitingVerificationSince = undefined;
    task.lastVerificationReminderAt = undefined;
    task.lastHeartbeatAt = startedAt;
    agent.lastHeartbeatAt = startedAt;
    agent.updatedAt = startedAt;
    this.upsertRunRecord(this.makeRunRecord(agent, task, runId, startedAt));
    await Promise.all([this.saveTasks(), this.saveRuns(), this.saveState()]);
    this.eventBus.emit({ type: 'agents:task-running', task, agentId: agent.id });
    this.eventBus.emit({
      type: 'agents:run-started',
      run: this.getRunRecord(runId),
      taskId: task.id,
      runId,
      agentId: agent.id,
    } as any);
    this.emitUpdated();

    try {
      const result = await this.taskExecutor(agent, task);
      if (this.summaryLooksUnverified(result.summary)) {
        throw new Error(`Task ended with failed verification: ${result.summary.slice(0, 400)}`);
      }
      const finishedAt = nowIso();
      task.status = 'done';
      task.resultSummary = result.summary;
      task.error = undefined;
      task.verificationStatus = 'unverified';
      task.verificationNotes = undefined;
      task.verifiedByAgentId = undefined;
      task.verifiedAt = undefined;
      task.awaitingVerificationSince = finishedAt;
      task.lastVerificationReminderAt = undefined;
      task.finishedAt = finishedAt;
      task.updatedAt = finishedAt;
      task.lastHeartbeatAt = finishedAt;
      agent.lastRunAt = finishedAt;
      agent.lastHeartbeatAt = finishedAt;
      agent.lastError = undefined;
      agent.updatedAt = finishedAt;
      this.markRunAsSettled({
        runId: task.runId,
        status: 'done',
        summary: result.summary.slice(0, 4000),
        endedAt: finishedAt,
      });
      await Promise.all([this.saveTasks(), this.saveRuns(), this.saveState()]);
      this.eventBus.emit({ type: 'agents:task-done', task, agentId: agent.id });
      this.eventBus.emit({
        type: 'agents:run-finished',
        run: this.getRunRecord(task.runId),
        taskId: task.id,
        runId: task.runId,
        agentId: agent.id,
        status: 'done',
      } as any);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (this.shouldRetryTaskFailure(task, msg)) {
        const retryAt = nowIso();
        const failedRunId = task.runId;
        task.retryCount = Math.max(0, Number(task.retryCount || 0)) + 1;
        task.status = 'queued';
        task.error = undefined;
        task.startedAt = undefined;
        task.finishedAt = undefined;
        task.resultSummary = undefined;
        task.verificationStatus = undefined;
        task.verificationNotes = undefined;
        task.verifiedByAgentId = undefined;
        task.verifiedAt = undefined;
        task.awaitingVerificationSince = undefined;
        task.lastVerificationReminderAt = undefined;
        task.stalledAt = undefined;
        task.staleReason = undefined;
        task.lastHeartbeatAt = retryAt;
        task.updatedAt = retryAt;
        task.runId = undefined;
        this.appendRetryContext(task, msg);
        agent.lastRunAt = task.updatedAt;
        agent.lastHeartbeatAt = retryAt;
        agent.lastError = msg;
        agent.updatedAt = retryAt;
        this.markRunAsSettled({
          runId: failedRunId,
          status: 'failed',
          error: msg,
          endedAt: retryAt,
        });
        await Promise.all([this.saveTasks(), this.saveRuns(), this.saveState()]);
        this.eventBus.emit({
          type: 'agents:task-queued',
          task,
          agentId: agent.id,
          retry: true,
          error: msg,
        } as any);
        this.eventBus.emit({
          type: 'agents:task-retry',
          task,
          agentId: agent.id,
          error: msg,
          retryCount: task.retryCount,
          maxRetries: task.maxRetries ?? DEFAULT_TASK_MAX_RETRIES,
        } as any);
        this.eventBus.emit({
          type: 'agents:run-finished',
          run: this.getRunRecord(failedRunId),
          taskId: task.id,
          runId: failedRunId,
          agentId: agent.id,
          status: 'failed',
          error: msg,
        } as any);
        return;
      }
      const finishedAt = nowIso();
      task.status = 'failed';
      task.error = msg;
      task.verificationStatus = undefined;
      task.verificationNotes = undefined;
      task.verifiedByAgentId = undefined;
      task.verifiedAt = undefined;
      task.awaitingVerificationSince = undefined;
      task.lastVerificationReminderAt = undefined;
      task.stalledAt = undefined;
      task.staleReason = undefined;
      task.finishedAt = finishedAt;
      task.updatedAt = finishedAt;
      task.lastHeartbeatAt = finishedAt;
      agent.lastRunAt = finishedAt;
      agent.lastHeartbeatAt = finishedAt;
      agent.lastError = msg;
      agent.updatedAt = finishedAt;
      this.markRunAsSettled({
        runId: task.runId,
        status: 'failed',
        error: msg,
        endedAt: finishedAt,
      });
      await Promise.all([this.saveTasks(), this.saveRuns(), this.saveState()]);
      this.eventBus.emit({ type: 'agents:task-failed', task, agentId: agent.id, error: msg });
      this.eventBus.emit({
        type: 'agents:run-finished',
        run: this.getRunRecord(task.runId),
        taskId: task.id,
        runId: task.runId,
        agentId: agent.id,
        status: 'failed',
        error: msg,
      } as any);
    } finally {
      this.inFlightAgents.delete(agent.id);
      this.emitSummaryHeartbeat();
      this.emitUpdated();
    }
  }

  private async runAutonomousStatusMaintenance(options?: {
    emitHeartbeat?: boolean;
  }): Promise<void> {
    if (this.maintenanceInFlight) {
      if (options?.emitHeartbeat !== false) {
        this.emitSummaryHeartbeat();
      }
      return;
    }
    this.maintenanceInFlight = true;
    try {
      const nowMs = Date.now();
      const now = nowIso();
      let tasksChanged = false;
      let runsChanged = false;
      let stateChanged = false;

      for (const run of this.runs.runs) {
        if (run.status === 'running' || run.status === 'stalled') {
          continue;
        }
        const archiveAtMs = parseIsoMs(run.archivedAt);
        if (archiveAtMs !== null && archiveAtMs <= nowMs && run.status !== 'archived') {
          run.status = 'archived';
          runsChanged = true;
        }
      }

      if (this.runs.runs.length > DEFAULT_RUN_HISTORY_MAX) {
        this.runs.runs = [...this.runs.runs]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, DEFAULT_RUN_HISTORY_MAX);
        runsChanged = true;
      }

      for (const task of this.tasks.tasks) {
        const baseAt = task.startedAt || task.createdAt;
        const ageMs = elapsedSinceMs(baseAt, nowMs);
        const isRunning = task.status === 'running';
        const isQueued = task.status === 'queued';
        const threshold = isRunning ? DEFAULT_RUNNING_STALL_MS : DEFAULT_QUEUED_STALL_MS;

        if ((isRunning || isQueued) && ageMs >= threshold) {
          if (!task.stalledAt) {
            task.stalledAt = now;
            task.staleReason = isRunning
              ? `running for ${Math.floor(ageMs / 1000)}s without completion`
              : `queued for ${Math.floor(ageMs / 1000)}s without pickup`;
            task.updatedAt = now;
            tasksChanged = true;
            this.eventBus.emit({
              type: 'agents:task-stalled',
              task,
              taskId: task.id,
              agentId: task.toAgentId,
              durationMs: ageMs,
              staleReason: task.staleReason,
            } as any);
          }

          if (task.runId) {
            const run = this.getRunRecord(task.runId);
            if (run && run.status === 'running') {
              run.status = 'stalled';
              run.lastHeartbeatAt = now;
              runsChanged = true;
            }
          }
        } else if (!isRunning && !isQueued && task.stalledAt) {
          task.stalledAt = undefined;
          task.staleReason = undefined;
          task.updatedAt = now;
          tasksChanged = true;
        }

        if (
          task.status === 'done' &&
          (!task.verificationStatus || task.verificationStatus === 'unverified')
        ) {
          if (!task.awaitingVerificationSince) {
            task.awaitingVerificationSince = task.finishedAt || task.updatedAt || now;
            tasksChanged = true;
          }
          const waitMs = elapsedSinceMs(task.awaitingVerificationSince, nowMs);
          const reminderMs = elapsedSinceMs(task.lastVerificationReminderAt, nowMs);
          if (
            waitMs >= DEFAULT_VERIFICATION_PENDING_MS &&
            (!task.lastVerificationReminderAt ||
              reminderMs >= DEFAULT_VERIFICATION_REMINDER_COOLDOWN_MS)
          ) {
            task.lastVerificationReminderAt = now;
            task.staleReason = `awaiting verification for ${Math.floor(waitMs / 1000)}s`;
            task.updatedAt = now;
            tasksChanged = true;
            this.eventBus.emit({
              type: 'agents:task-verification-pending',
              task,
              taskId: task.id,
              agentId: task.toAgentId,
              waitMs,
            } as any);
          }
        } else if (
          task.awaitingVerificationSince ||
          task.lastVerificationReminderAt ||
          task.staleReason?.startsWith('awaiting verification')
        ) {
          task.awaitingVerificationSince = undefined;
          task.lastVerificationReminderAt = undefined;
          if (task.staleReason?.startsWith('awaiting verification')) {
            task.staleReason = undefined;
          }
          task.updatedAt = now;
          tasksChanged = true;
        }

        if (isRunning && task.runId) {
          const run = this.getRunRecord(task.runId);
          if (run) {
            if (elapsedSinceMs(run.lastHeartbeatAt, nowMs) >= DEFAULT_HEARTBEAT_PERSIST_MS) {
              run.lastHeartbeatAt = now;
              runsChanged = true;
            }
            if (run.status === 'stalled' && !task.stalledAt) {
              run.status = 'running';
              runsChanged = true;
            }
          }
        }
      }

      for (const agent of this.state.agents) {
        const hasActive = this.tasks.tasks.some(
          task => task.toAgentId === agent.id && (task.status === 'running' || task.status === 'queued'),
        );
        if (hasActive && elapsedSinceMs(agent.lastHeartbeatAt, nowMs) >= DEFAULT_HEARTBEAT_PERSIST_MS) {
          agent.lastHeartbeatAt = now;
          agent.updatedAt = now;
          stateChanged = true;
        }
      }

      if (tasksChanged) {
        await this.saveTasks();
      }
      if (runsChanged) {
        await this.saveRuns();
      }
      if (stateChanged) {
        await this.saveState();
      }
      if (tasksChanged || runsChanged || stateChanged) {
        this.emitUpdated();
      }
      if (options?.emitHeartbeat !== false) {
        this.emitSummaryHeartbeat();
      }
    } finally {
      this.maintenanceInFlight = false;
    }
  }

  getSummary(): AgentOrchestratorSummary {
    let queued = 0;
    let running = 0;
    let done = 0;
    let failed = 0;
    let stalled = 0;
    let needsVerification = 0;
    for (const task of this.tasks.tasks) {
      if (task.status === 'queued') queued += 1;
      if (task.status === 'running') running += 1;
      if (task.status === 'done') done += 1;
      if (task.status === 'failed') failed += 1;
      if (task.stalledAt) stalled += 1;
      if (
        task.status === 'done' &&
        (!task.verificationStatus || task.verificationStatus === 'unverified')
      ) {
        needsVerification += 1;
      }
    }
    const activeRuns = this.runs.runs.filter(run => run.status === 'running' || run.status === 'stalled').length;
    const archivedRuns = this.runs.runs.filter(run => run.status === 'archived').length;
    return {
      activeAgentId: this.state.activeAgentId,
      totalAgents: this.state.agents.length,
      queued,
      running,
      done,
      failed,
      stalled,
      needsVerification,
      activeRuns,
      archivedRuns,
      polling: this.running,
      heartbeatAt: this.lastHeartbeatAt,
    };
  }

  private emitSummaryHeartbeat(): void {
    this.lastHeartbeatAt = nowIso();
    const summary = this.getSummary();
    this.eventBus.emit({
      type: 'agents:summary',
      summary,
      agents: this.getAgentStatuses(),
      runs: this.listRuns({ limit: 20 }),
      heartbeatAt: summary.heartbeatAt,
    } as any);
    this.eventBus.emit({
      type: 'agents:heartbeat',
      summary,
      heartbeatAt: summary.heartbeatAt,
    } as any);
  }

  private emitUpdated(): void {
    this.eventBus.emit({
      type: 'agents:updated',
      summary: this.getSummary(),
      agents: this.getAgentStatuses(),
      runs: this.listRuns({ limit: 20 }),
    } as any);
  }
}

export function createAgentOrchestratorService(eventBus: EventBus): AgentOrchestratorService {
  return new AgentOrchestratorService(eventBus);
}
