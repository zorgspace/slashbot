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
      connectorId: 'telegram',
      label: 'Telegram',
    });

    expect(connector).not.toBeNull();
    expect(connector?.id).toBe('agent-telegramagent');
    expect(connector?.kind).toBe('connector');
    expect(connector?.autoPoll).toBe(false);
    expect(connector?.removable).toBe(false);

    const removable = await service.deleteAgent('agent-telegramagent');
    expect(removable).toBe(false);

    const heartbeatPath = path.join(
      workDir,
      '.agents',
      'agent-telegramagent',
      'workspace',
      'HEARTBEAT.md',
    );
    const heartbeat = await readFile(heartbeatPath, 'utf8');
    expect(heartbeat).toContain('# HEARTBEAT.md');
  });
});
