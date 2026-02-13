import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { EventBus } from '../../../core/events/EventBus';
import { createAgentOrchestratorService } from './AgentOrchestratorService';

async function createTempService() {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'slashbot-agents-'));
  const service = createAgentOrchestratorService(new EventBus());
  service.setWorkDir(workDir);
  await service.init();
  return { service, workDir };
}

const cleanupDirs: string[] = [];
let originalBun: any;

beforeAll(() => {
  originalBun = (globalThis as any).Bun;
  (globalThis as any).Bun = {
    file(filePath: string) {
      return {
        async exists(): Promise<boolean> {
          try {
            await access(filePath);
            return true;
          } catch {
            return false;
          }
        },
        async text(): Promise<string> {
          return readFile(filePath, 'utf8');
        },
        async json(): Promise<any> {
          return JSON.parse(await readFile(filePath, 'utf8'));
        },
      };
    },
    async write(filePath: string, content: string): Promise<void> {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, String(content), 'utf8');
    },
    spawn() {
      return { exited: Promise.resolve(1) };
    },
  };
});

afterAll(() => {
  (globalThis as any).Bun = originalBun;
});

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('AgentOrchestratorService.sendTask', () => {
  it('queues task without router and keeps requested target', async () => {
    const { service, workDir } = await createTempService();
    cleanupDirs.push(workDir);
    const developer = await service.createAgent({
      name: 'Developer',
      responsibility: 'Implementation specialist',
    });

    const task = await service.sendTask({
      fromAgentId: 'agent-1',
      toAgentId: developer.id,
      title: 'Fix notify',
      content: 'notify command does not trigger',
    });

    expect(task.status).toBe('queued');
    expect(task.toAgentId).toBe(developer.id);
    expect(task.content).toContain('[task-contract]');
    expect(task.content).toContain(`assigned-target: ${developer.id}`);
  });

  it('falls back to requested target when router throws', async () => {
    const { service, workDir } = await createTempService();
    cleanupDirs.push(workDir);
    const developer = await service.createAgent({
      name: 'Developer',
      responsibility: 'Implementation specialist',
    });
    service.setTaskRouter(async () => {
      throw new Error('router failed');
    });

    const task = await service.sendTask({
      fromAgentId: 'agent-1',
      toAgentId: developer.id,
      title: 'Investigate failure',
      content: 'service crashes on start',
    });

    expect(task.status).toBe('queued');
    expect(task.toAgentId).toBe(developer.id);
    expect(task.content).toContain(`requested-target: ${developer.id}`);
    expect(task.content).toContain(`assigned-target: ${developer.id}`);
  });
});

describe('AgentOrchestratorService default agent behavior', () => {
  it('starts with architect agent by default', async () => {
    const { service, workDir } = await createTempService();
    cleanupDirs.push(workDir);

    const agents = service.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].kind).toBe('architect');
    expect(service.getActiveAgentId()).toBe(agents[0].id);
    expect(agents[0].systemPrompt.toLowerCase()).not.toContain('todo plugin');
    expect(agents[0].systemPrompt.toLowerCase()).not.toContain('todo state');
    expect(agents[0].systemPrompt).not.toContain('<todo-write>');
    expect(agents[0].systemPrompt).not.toContain('<todo-read');
  });

  it('keeps architect as active after creating specialists', async () => {
    const { service, workDir } = await createTempService();
    cleanupDirs.push(workDir);

    const created = await service.createAgent({
      name: 'Developer',
      responsibility: 'Implementation specialist',
    });

    expect(service.getActiveAgentId()).not.toBe(created.id);
  });

  it('keeps architect after deleting the only specialist', async () => {
    const { service, workDir } = await createTempService();
    cleanupDirs.push(workDir);

    const created = await service.createAgent({
      name: 'Developer',
      responsibility: 'Implementation specialist',
    });

    const ok = await service.deleteAgent(created.id);
    expect(ok).toBe(true);
    const agents = service.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].kind).toBe('architect');
    expect(service.getActiveAgentId()).toBe(agents[0].id);
  });

  it('creates protected connector agents with workspace files', async () => {
    const { service, workDir } = await createTempService();
    cleanupDirs.push(workDir);

    const connector = await service.ensureConnectorAgent({
      connectorId: 'slack',
      label: 'Slack',
    });

    expect(connector).not.toBeNull();
    expect(connector?.id).toBe('agent-slackagent');
    expect(connector?.kind).toBe('connector');
    expect(connector?.autoPoll).toBe(false);
    expect(connector?.removable).toBe(false);

    const removable = await service.deleteAgent('agent-slackagent');
    expect(removable).toBe(false);

    const heartbeatPath = path.join(
      workDir,
      '.agents',
      'agent-slackagent',
      'workspace',
      'HEARTBEAT.md',
    );
    const heartbeat = await readFile(heartbeatPath, 'utf8');
    expect(heartbeat).toContain('# HEARTBEAT.md');
  });

  it('runs ready autopoll agents in parallel', async () => {
    const { service, workDir } = await createTempService();
    cleanupDirs.push(workDir);

    const workerA = await service.createAgent({
      name: 'Worker A',
      responsibility: 'Implementation specialist A',
    });
    const workerB = await service.createAgent({
      name: 'Worker B',
      responsibility: 'Implementation specialist B',
    });

    await service.sendTask({
      fromAgentId: 'agent-architect',
      toAgentId: workerA.id,
      title: 'Task A',
      content: 'Execute A',
    });
    await service.sendTask({
      fromAgentId: 'agent-architect',
      toAgentId: workerB.id,
      title: 'Task B',
      content: 'Execute B',
    });

    const startedAt = new Map<string, number>();
    service.setTaskExecutor(async agent => {
      startedAt.set(agent.id, Date.now());
      await new Promise(resolve => setTimeout(resolve, 75));
      return { summary: `done:${agent.id}` };
    });

    await (service as any).poll();

    expect(startedAt.size).toBe(2);
    const a = startedAt.get(workerA.id)!;
    const b = startedAt.get(workerB.id)!;
    expect(Math.abs(a - b)).toBeLessThan(50);
  });

  it('requeues recoverable failures and retries until success', async () => {
    const { service, workDir } = await createTempService();
    cleanupDirs.push(workDir);

    const worker = await service.createAgent({
      name: 'Worker',
      responsibility: 'Implementation specialist',
    });

    await service.sendTask({
      fromAgentId: 'agent-architect',
      toAgentId: worker.id,
      title: 'Fix build',
      content: 'Fix failing build pipeline',
    });

    let attempts = 0;
    service.setTaskExecutor(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('build failed: npm run build exited with code 1');
      }
      return { summary: 'Build passed and tests passed' };
    });

    const firstRun = await service.runNextForAgent(worker.id);
    expect(firstRun).toBe(true);

    const firstTask = service.listTasks().find(task => task.toAgentId === worker.id);
    expect(firstTask?.status).toBe('queued');
    expect(firstTask?.retryCount).toBe(1);
    expect(firstTask?.content).toContain('[retry-attempt 1/2]');

    const secondRun = await service.runNextForAgent(worker.id);
    expect(secondRun).toBe(true);

    const finalTask = service.listTasks().find(task => task.toAgentId === worker.id);
    expect(finalTask?.status).toBe('done');
    expect(finalTask?.retryCount).toBe(1);
    expect(attempts).toBe(2);
  });

  it('marks task failed after retry budget is exhausted', async () => {
    const { service, workDir } = await createTempService();
    cleanupDirs.push(workDir);

    const worker = await service.createAgent({
      name: 'Worker',
      responsibility: 'Implementation specialist',
    });

    await service.sendTask({
      fromAgentId: 'agent-architect',
      toAgentId: worker.id,
      title: 'Fix build',
      content: 'Fix failing build pipeline',
    });

    let attempts = 0;
    service.setTaskExecutor(async () => {
      attempts += 1;
      throw new Error('build failed: npm run build exited with code 1');
    });

    await service.runNextForAgent(worker.id);
    await service.runNextForAgent(worker.id);
    await service.runNextForAgent(worker.id);

    const task = service.listTasks().find(t => t.toAgentId === worker.id);
    expect(task?.status).toBe('failed');
    expect(task?.retryCount).toBe(2);
    expect(attempts).toBe(3);
  });

  it('lets architect verify completed task and store verification metadata', async () => {
    const { service, workDir } = await createTempService();
    cleanupDirs.push(workDir);

    const worker = await service.createAgent({
      name: 'Worker',
      responsibility: 'Implementation specialist',
    });

    await service.sendTask({
      fromAgentId: 'agent-architect',
      toAgentId: worker.id,
      title: 'Fix command',
      content: 'Implement and verify command behavior',
    });

    service.setTaskExecutor(async () => ({ summary: 'Build passed and tests passed' }));
    await service.runNextForAgent(worker.id);

    const doneTask = service.listTasks().find(task => task.toAgentId === worker.id);
    expect(doneTask?.status).toBe('done');
    expect(doneTask?.verificationStatus).toBe('unverified');

    const verified = await service.verifyTask({
      taskId: doneTask!.id,
      verifierAgentId: 'agent-architect',
      status: 'verified',
      notes: 'Reviewed output and checks look good',
    });

    expect(verified).not.toBeNull();
    expect(verified?.verificationStatus).toBe('verified');
    expect(verified?.verifiedByAgentId).toBe('agent-architect');
    expect(verified?.verificationNotes).toContain('Reviewed output');
  });

  it('recalls completed task into a follow-up task for the same specialist', async () => {
    const { service, workDir } = await createTempService();
    cleanupDirs.push(workDir);

    const worker = await service.createAgent({
      name: 'Worker',
      responsibility: 'Implementation specialist',
    });

    await service.sendTask({
      fromAgentId: 'agent-architect',
      toAgentId: worker.id,
      title: 'Initial fix',
      content: 'Fix issue and provide verification evidence',
    });

    service.setTaskExecutor(async () => ({ summary: 'Fixed bug and tests passed' }));
    await service.runNextForAgent(worker.id);

    const completed = service.listTasks().find(task => task.toAgentId === worker.id);
    expect(completed?.status).toBe('done');

    const recalled = await service.recallTask({
      taskId: completed!.id,
      fromAgentId: 'agent-architect',
      reason: 'Add a regression test and extend docs',
    });

    expect(recalled).not.toBeNull();
    expect(recalled?.status).toBe('queued');
    expect(recalled?.toAgentId).toBe(worker.id);
    expect(recalled?.recallOfTaskId).toBe(completed?.id);
    expect(recalled?.content).toContain('Add a regression test and extend docs');

    const sourceAfterRecall = service.getTask(completed!.id);
    expect(sourceAfterRecall?.verificationStatus).toBe('changes_requested');
    expect(sourceAfterRecall?.verificationNotes).toContain('regression test');
  });

  it('exposes current running task in agent status snapshots', async () => {
    const { service, workDir } = await createTempService();
    cleanupDirs.push(workDir);

    const worker = await service.createAgent({
      name: 'Worker',
      responsibility: 'Implementation specialist',
    });

    await service.sendTask({
      fromAgentId: 'agent-architect',
      toAgentId: worker.id,
      title: 'Long running task',
      content: 'Execute a long running operation',
    });

    let releaseExecution!: () => void;
    const executionGate = new Promise<void>(resolve => {
      releaseExecution = () => resolve();
    });
    service.setTaskExecutor(async () => {
      await executionGate;
      return { summary: 'Build passed and tests passed' };
    });

    const runPromise = service.runNextForAgent(worker.id);
    await new Promise(resolve => setTimeout(resolve, 20));

    const statusEntry = service.getAgentStatuses().find(entry => entry.agentId === worker.id);
    expect(statusEntry?.currentTask).toBeTruthy();
    expect(statusEntry?.currentTask?.status).toBe('running');
    expect(statusEntry?.currentTask?.title).toContain('Long running task');
    expect(statusEntry?.lifecycle).toBe('running');

    releaseExecution();
    await runPromise;
  });

  it('autonomously marks stale queued tasks so status can self-manage health', async () => {
    const { service, workDir } = await createTempService();
    cleanupDirs.push(workDir);

    const worker = await service.createAgent({
      name: 'Worker',
      responsibility: 'Implementation specialist',
    });

    const task = await service.sendTask({
      fromAgentId: 'agent-architect',
      toAgentId: worker.id,
      title: 'Queued too long',
      content: 'This task will stay in queue for too long',
    });

    const oldDate = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const mutableTask = service.getTask(task.id);
    expect(mutableTask).not.toBeNull();
    if (mutableTask) {
      mutableTask.createdAt = oldDate;
      mutableTask.updatedAt = oldDate;
    }

    await (service as any).runAutonomousStatusMaintenance();

    const staleTask = service.getTask(task.id);
    expect(staleTask?.stalledAt).toBeTruthy();
    expect(staleTask?.staleReason).toContain('queued');

    const statusEntry = service.getAgentStatuses().find(entry => entry.agentId === worker.id);
    expect(statusEntry?.lifecycle).toBe('stalled');
    expect(statusEntry?.currentTask?.id).toBe(task.id);
  });
});
