import { createHmac } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { EventBus } from '../../../core/events/EventBus';
import { AutomationService } from './AutomationService';

describe('AutomationService', () => {
  async function withService<T>(
    run: (service: AutomationService, deps: { notifications: any[]; chatCalls: string[] }) => Promise<T>,
  ): Promise<T> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'slashbot-automation-'));
    const jobsFile = path.join(dir, 'automation-jobs.json');
    const notifications: any[] = [];
    const chatCalls: string[] = [];
    const eventBus = new EventBus();
    const connectorRegistry = {
      notify: async (message: string, target?: string, targetId?: string) => {
        notifications.push({ message, target, targetId });
        return { sent: target ? [target] : [], failed: [] };
      },
    } as any;

    const service = new AutomationService({
      eventBus,
      connectorRegistry,
      jobsFile,
    });
    service.setGrokClientResolver(() => ({
      chat: async (message: string) => {
        chatCalls.push(message);
        return { response: `result:${message}`, thinking: '' };
      },
    }));
    await service.init();

    try {
      return await run(service, { notifications, chatCalls });
    } finally {
      service.stop();
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('runs due cron jobs and dispatches connector notifications', async () => {
    await withService(async (service, deps) => {
      const job = await service.createCronJob({
        name: 'daily',
        expression: '* * * * *',
        prompt: 'summarize repo state',
        target: { source: 'telegram', targetId: '123' },
      });
      expect(job.trigger.type).toBe('cron');
      if (job.trigger.type !== 'cron') {
        throw new Error('expected cron trigger');
      }
      expect(job.trigger.nextRunAt).toBeTruthy();

      const nextRunAtMs = Date.parse(job.trigger.nextRunAt!);
      await service.tick(new Date(nextRunAtMs + 1000));

      expect(deps.chatCalls.length).toBe(1);
      expect(deps.chatCalls[0]).toContain('summarize repo state');
      expect(deps.notifications.length).toBe(1);
      expect(deps.notifications[0].target).toBe('telegram');
      expect(deps.notifications[0].targetId).toBe('123');

      const jobs = service.listJobs();
      expect(jobs[0].lastStatus).toBe('ok');
      expect(jobs[0].lastRunAt).toBeTruthy();
    });
  });

  it('validates webhook signatures before running webhook jobs', async () => {
    await withService(async (service, deps) => {
      await service.createWebhookJob({
        name: 'deploy-hook',
        webhookName: 'deploy',
        secret: 'top-secret',
        prompt: 'announce deploy',
      });

      const body = JSON.stringify({ version: '1.2.3' });
      const signature = createHmac('sha256', 'top-secret').update(body).digest('hex');
      const matched = await service.handleWebhookTrigger({
        name: 'deploy',
        rawBody: body,
        body: { version: '1.2.3' },
        headers: {
          'x-slashbot-signature': `sha256=${signature}`,
        },
        receivedAt: new Date().toISOString(),
      });
      expect(matched).toBe(1);
      expect(deps.chatCalls.length).toBe(1);

      const unmatched = await service.handleWebhookTrigger({
        name: 'deploy',
        rawBody: body,
        body: { version: '1.2.3' },
        headers: {
          'x-slashbot-signature': 'sha256=bad',
        },
        receivedAt: new Date().toISOString(),
      });
      expect(unmatched).toBe(0);
      expect(deps.chatCalls.length).toBe(1);
    });
  });
});
