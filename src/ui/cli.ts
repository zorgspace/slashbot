import React from 'react';
import { render } from 'ink';
import { randomUUID } from 'node:crypto';
import type { RuntimeFlags } from '../core/kernel/contracts.js';
import { SlashbotKernel } from '../core/kernel/kernel.js';
import type { KernelLogger } from '../core/kernel/logger.js';
import { getBundledPlugins } from '../plugins/index.js';
import { SlashbotTui } from './tui.js';
import { runSinglePromptNonInteractive } from './non-interactive.js';
import { isConfigurationMissing } from './first-run.js';

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'tui', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    i += 1;
  }

  return {
    command,
    positionals,
    flags
  };
}

function getStringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

export async function runCli(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const nonInteractive = Boolean(parsed.flags['non-interactive']);

  const flags: RuntimeFlags = {
    nonInteractive,
    gatewayToken: getStringFlag(parsed.flags, 'gateway-token'),
    configPath: getStringFlag(parsed.flags, 'config-path')
  };

  const showFirstRunOnboarding = parsed.command === 'tui' && (await isConfigurationMissing(process.cwd(), flags));

  const { factories, discovered } = await getBundledPlugins();
  const kernel = await SlashbotKernel.create({
    workspaceRoot: process.cwd(),
    flags,
    bundledPlugins: factories,
    bundledDiscovered: discovered
  });

  if (parsed.command === 'tui') {
    (kernel.logger as KernelLogger).setTerminalOutputEnabled(false);
  }

  await kernel.startup();
  await kernel.hooks.dispatchLifecycle('cli_init', { command: parsed.command }, {});

  const sessionId = getStringFlag(parsed.flags, 'session-id') ?? randomUUID();
  const agentId = getStringFlag(parsed.flags, 'agent-id') ?? 'default-agent';
  await kernel.startSession(sessionId, agentId);
  let gatewayStarted = false;

  if (parsed.command === 'tui') {
    try {
      await kernel.startGateway();
      gatewayStarted = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Gateway auto-start failed (${reason}). Continuing without websocket monitor.\n`);
    }
  }

  const exitGracefully = async (code: number): Promise<number> => {
    await kernel.hooks.dispatchLifecycle('cli_exit', { exitCode: code }, {});
    await kernel.endSession(sessionId, agentId);
    if (gatewayStarted) {
      await kernel.stopGateway();
      gatewayStarted = false;
    }
    await kernel.shutdown();
    return code;
  };

  if (parsed.command === 'gateway') {
    const sub = parsed.positionals[0] ?? 'start';
    if (sub === 'start') {
      await kernel.startGateway();
      process.stdout.write('Gateway running. Press Ctrl+C to stop.\n');
      await new Promise<void>((resolve) => {
        process.on('SIGINT', () => resolve());
      });
      await kernel.stopGateway();
      return exitGracefully(0);
    }

    process.stderr.write(`Unknown gateway command: ${sub}\n`);
    return exitGracefully(1);
  }

  if (parsed.command === 'run') {
    const prompt = getStringFlag(parsed.flags, 'prompt') ?? parsed.positionals.join(' ');
    const code = await runSinglePromptNonInteractive(kernel, prompt, sessionId, agentId);
    return exitGracefully(code);
  }

  if (parsed.command === 'tui') {
    const app = render(
      React.createElement(SlashbotTui, {
        kernel,
        sessionId,
        agentId,
        requireOnboarding: showFirstRunOnboarding
      }),
      {
        patchConsole: false,
      },
    );
    await app.waitUntilExit();
    return exitGracefully(0);
  }

  const command = kernel.commands.get(parsed.command);
  if (command) {
    const exitCode = await kernel.runCommand(parsed.command, parsed.positionals, {
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
      env: process.env,
      nonInteractive,
      flags: parsed.flags
    });

    return exitGracefully(exitCode);
  }

  process.stderr.write(`Unknown command: ${parsed.command}\n`);
  return exitGracefully(1);
}
