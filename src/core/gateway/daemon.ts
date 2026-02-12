import { basename, dirname } from 'path';
import { mkdir, writeFile } from 'fs/promises';

import { display } from '../ui';
import { Slashbot } from '../app/kernel';
import { createGatewayAuthManager } from './auth';
import { GatewayServer } from './server';
import { getLocalGatewayLogFile } from '../config/constants';
import {
  clearGatewayState,
  getGatewayDaemonStatus,
  stopGatewayProcess,
  waitForGatewayStart,
  waitForGatewayStop,
  writeGatewayPid,
  writeGatewayState,
} from './state';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 7788;

export interface GatewayLaunchOptions {
  host: string;
  port: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readStreamTextWithTimeout(
  stream: ReadableStream<Uint8Array> | null,
  timeoutMs: number,
): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader();
  let output = '';

  const pump = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          output += Buffer.from(value).toString('utf8');
        }
      }
    } catch {
      // Ignore stream read failures for diagnostics.
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Ignore lock release errors.
      }
    }
  })();

  await Promise.race([pump, sleep(timeoutMs)]);
  return output.trim();
}

function tailLines(value: string, maxLines: number): string {
  const lines = value
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean);
  return lines.slice(-maxLines).join('\n');
}

function parseFlags(args: string[]): GatewayLaunchOptions {
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  for (let i = 0; i < args.length; i++) {
    const item = args[i];
    if (item === '--host' && args[i + 1]) {
      host = args[i + 1];
      i++;
      continue;
    }
    if (item === '--port' && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
        port = Math.floor(parsed);
      }
      i++;
      continue;
    }
  }
  return { host, port };
}

function buildDaemonCommand(options: GatewayLaunchOptions): string[] {
  const argv0 = process.argv[0];
  const argv1 = process.argv[1];
  const scriptLike = argv1 && /\.[cm]?[jt]s$/i.test(argv1);

  if (scriptLike) {
    return [
      argv0,
      argv1,
      'gateway',
      'daemon',
      '--host',
      options.host,
      '--port',
      String(options.port),
    ];
  }

  return [argv0, 'gateway', 'daemon', '--host', options.host, '--port', String(options.port)];
}

async function printGatewayStatusSummary(): Promise<void> {
  const status = await getGatewayDaemonStatus();
  const auth = createGatewayAuthManager();
  const authSummary = await auth.getSummary();

  if (!status.running) {
    display.warningText('Gateway is not running');
    if (status.state) {
      display.muted(`Last known endpoint: ws://${status.state.host}:${status.state.port}/ws`);
    }
  } else {
    display.successText('Gateway is running');
    display.muted(`PID: ${status.pid}`);
    if (status.state) {
      display.muted(`Endpoint: ws://${status.state.host}:${status.state.port}/ws`);
      display.muted(`Started: ${status.state.startedAt}`);
    }
  }
  display.muted(`Active clients: ${authSummary.activeTokens}`);
  display.muted(`Pending pairing codes: ${authSummary.pendingPairingCodes}`);
}

export async function handleGatewayCliCommand(version: string, args: string[]): Promise<boolean> {
  if (args[0] !== 'gateway') {
    return false;
  }

  const sub = (args[1] || 'status').toLowerCase();
  const options = parseFlags(args.slice(2));

  if (sub === 'status') {
    await printGatewayStatusSummary();
    return true;
  }

  if (sub === 'stop') {
    const status = await getGatewayDaemonStatus();
    if (!status.pid || !status.running) {
      await clearGatewayState();
      display.warningText('Gateway is not running');
      return true;
    }

    await stopGatewayProcess(status.pid);
    const stopped = await waitForGatewayStop(status.pid);
    if (!stopped) {
      try {
        process.kill(status.pid, 'SIGKILL');
      } catch {
        // Ignore if already stopped.
      }
    }
    await clearGatewayState();
    display.successText('Gateway stopped');
    return true;
  }

  if (sub === 'pair') {
    const auth = createGatewayAuthManager();
    const labelArgIndex = args.findIndex(item => item === '--label');
    const label = labelArgIndex >= 0 ? args[labelArgIndex + 1] : 'gateway-client';
    const code = await auth.createPairingCode(label);
    display.successText('Pairing code generated');
    display.append(code.code);
    display.muted(`Label: ${code.label}`);
    display.muted(`Expires: ${code.expiresAt}`);
    return true;
  }

  if (sub === 'start') {
    const status = await getGatewayDaemonStatus();
    if (status.running) {
      display.warningText('Gateway is already running');
      await printGatewayStatusSummary();
      return true;
    }

    await clearGatewayState();
    const logFile = getLocalGatewayLogFile();
    await mkdir(dirname(logFile), { recursive: true });
    await writeFile(logFile, '', 'utf8');

    const auth = createGatewayAuthManager();
    const pairing = await auth.createPairingCode('bootstrap-client');

    const cmd = buildDaemonCommand(options);
    const child = Bun.spawn({
      cmd,
      cwd: process.cwd(),
      env: {
        ...process.env,
        SLASHBOT_GATEWAY_DAEMON: '1',
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      detached: true,
    });
    child.unref();

    const started = await waitForGatewayStart();
    if (!started) {
      const stderrOutput = await readStreamTextWithTimeout(child.stderr, 700);
      const stdoutOutput = await readStreamTextWithTimeout(child.stdout, 300);
      const combined = `${stderrOutput}\n${stdoutOutput}`.trim();
      if (combined) {
        await writeFile(logFile, `${combined}\n`, 'utf8');
      }
      display.errorText('Gateway failed to start');
      if (combined) {
        display.muted(tailLines(combined, 8));
      } else {
        display.muted('No startup output captured from daemon process.');
      }
      display.muted(`Logs: ${logFile}`);
      const statusAfterFailure = await getGatewayDaemonStatus();
      if (statusAfterFailure.running) {
        display.muted('Daemon appears to be running now; check with: slashbot gateway status');
      }
      return true;
    }

    display.successText('Gateway started');
    display.muted(`Endpoint: ws://${started.host}:${started.port}/ws`);
    display.muted(`Daemon PID: ${started.pid}`);
    display.append('');
    display.violet('Initial pairing code');
    display.append(pairing.code);
    display.muted(`Expires: ${pairing.expiresAt}`);
    display.muted(
      `Connect then send {"type":"pair","code":"${pairing.code}"} or authenticate with a token.`,
    );
    display.muted(`slashbot v${version} (${basename(process.cwd())})`);
    return true;
  }

  if (sub === 'help') {
    display.renderMarkdown(
      [
        'Gateway commands',
        '',
        '- `slashbot gateway start [--host 127.0.0.1] [--port 7788]`',
        '- `slashbot gateway status`',
        '- `slashbot gateway stop`',
        '- `slashbot gateway pair [--label my-client]`',
      ].join('\n'),
      true,
    );
    return true;
  }

  return false;
}

export async function runGatewayDaemon(version: string, args: string[]): Promise<void> {
  const options = parseFlags(args);
  const bot = new Slashbot();
  bot.setVersion(version);
  await bot.startGateway();

  const auth = createGatewayAuthManager();
  await auth.load();

  const gateway = new GatewayServer({
    host: options.host,
    port: options.port,
    version,
    auth,
    eventBus: bot.getEventBus(),
    handlers: {
      processMessage: ({ message, sessionId, clientId, onChunk }) =>
        bot.processGatewayMessage({
          message,
          sessionId,
          clientId,
          onChunk,
        }),
      listSessions: () =>
        bot.getSessionSummaries().map(item => ({
          id: item.id,
          messageCount: item.messageCount,
          lastActivity: item.lastActivity,
          preview: item.preview,
        })),
      getStatus: () => {
        const model = bot.getCurrentModel();
        return {
          connected: bot.isConnected(),
          model: model || undefined,
          provider: bot.getCurrentProvider() || undefined,
          connectors: bot.getConnectorSnapshots().map(item => ({
            id: item.id,
            configured: item.configured,
            running: item.running,
          })),
        };
      },
      handleWebhook: payload => bot.handleGatewayWebhook(payload),
    },
  });

  await gateway.start();
  await writeGatewayPid(process.pid);
  await writeGatewayState({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    host: options.host,
    port: gateway.port,
    version,
  });

  const shutdown = async () => {
    await gateway.stop();
    await bot.stop();
    await clearGatewayState();
  };

  let stopping = false;
  const handleStopSignal = async () => {
    if (stopping) return;
    stopping = true;
    await shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', () => {
    void handleStopSignal();
  });
  process.on('SIGINT', () => {
    void handleStopSignal();
  });

  await new Promise<void>(() => {
    // Keep daemon alive. Bun.serve keeps event loop running.
  });
}
