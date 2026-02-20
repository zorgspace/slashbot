/**
 * @module ui/onboarding
 *
 * CLI-based onboarding flow for provider authentication. Supports
 * API key, setup token, and OAuth PKCE flows. Used by the `slashbot setup`
 * command and the first-run setup wizard. Includes an embedded HTTP server
 * for receiving OAuth callbacks.
 *
 * @see {@link runOnboarding} -- Main onboarding entry point
 * @see {@link ensureBaseConfig} -- Creates default config if missing
 * @see {@link OnboardingOptions} -- Onboarding configuration options
 */
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import type { ProviderAuthMethod } from '../core/kernel/contracts.js';
import type { SlashbotKernel } from '../core/kernel/kernel.js';

/** Configuration options for the onboarding flow. */
export interface OnboardingOptions {
  /** Agent identifier for profile association. */
  agentId: string;
  /** Provider to authenticate against (e.g. 'anthropic', 'openai'). */
  providerId: string;
  /** Auth method override; defaults to the provider's preferred method. */
  method?: ProviderAuthMethod;
  /** Human-readable label for the saved auth profile. */
  profileLabel?: string;
  /** When true, disables interactive prompts (requires all credentials upfront). */
  nonInteractive: boolean;
  /** Pre-supplied API key for api_key auth method. */
  apiKey?: string;
  /** Pre-supplied setup token for setup_token auth method. */
  setupToken?: string;
  /** Pre-supplied OAuth authorization code. */
  code?: string;
  /** Pre-supplied OAuth state parameter. */
  state?: string;
  /** Pre-supplied PKCE verifier. */
  verifier?: string;
  /** Writable stream for status output; defaults to process.stdout. */
  stdout?: NodeJS.WritableStream;
}

/**
 * Ensures the ~/.slashbot directory and a default config.json exist.
 * Creates them if missing; does nothing if they already exist.
 */
export async function ensureBaseConfig(): Promise<void> {
  const base = join(homedir(), '.slashbot');
  await fs.mkdir(base, { recursive: true });
  const configPath = join(base, 'config.json');

  try {
    await fs.access(configPath);
  } catch {
    const config = {
      gateway: {
        host: '127.0.0.1',
        port: 7680,
        authToken: 'change-me'
      },
      plugins: {
        allow: [],
        deny: [],
        entries: [],
        paths: ['.slashbot/extensions']
      }
    };
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }
}

async function waitForOAuthCallback(expectedState: string, timeoutMs = 120_000): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = (value: { code: string; state: string }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const server = createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end('Invalid callback');
        return;
      }

      const callbackUrl = new URL(req.url, 'http://127.0.0.1:8787');
      const state = callbackUrl.searchParams.get('state') ?? '';
      const code = callbackUrl.searchParams.get('code') ?? '';

      if (!code || !state || state !== expectedState) {
        res.statusCode = 400;
        res.end('Invalid OAuth callback data.');
        return;
      }

      res.statusCode = 200;
      res.end('Slashbot auth complete. You can return to the terminal.');

      server.close();
      settleResolve({ code, state });
    });

    const timeout = setTimeout(() => {
      server.close();
      settleReject(new Error('Timed out waiting for OAuth callback. Use manual code paste fallback.'));
    }, timeoutMs);

    server.on('error', (cause) => {
      const err = cause as NodeJS.ErrnoException;
      const reason = err.code === 'EADDRINUSE'
        ? 'OAuth callback port 8787 is already in use. Use manual code/state paste fallback.'
        : `OAuth callback listener failed: ${err.message}`;
      clearTimeout(timeout);
      settleReject(new Error(reason));
    });

    server.listen(8787, '127.0.0.1', () => {
      void timeout;
    });

    server.on('close', () => clearTimeout(timeout));
  });
}

async function promptInteractive(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Runs the full provider onboarding flow: ensures base config, starts the
 * chosen auth method, collects credentials (interactively or from options),
 * and saves the resulting auth profile to the kernel's auth store.
 *
 * @param kernel - The initialized Slashbot kernel.
 * @param options - Onboarding configuration and pre-supplied credentials.
 * @throws If the provider or auth method is not found, or if credentials are invalid.
 */
export async function runOnboarding(kernel: SlashbotKernel, options: OnboardingOptions): Promise<void> {
  await ensureBaseConfig();

  const provider = kernel.providers.get(options.providerId);
  if (!provider) {
    throw new Error(`Provider not found: ${options.providerId}`);
  }

  const method = options.method ?? provider.preferredAuthOrder[0];
  const handler = provider.authHandlers.find((entry) => entry.method === method);

  if (!handler) {
    throw new Error(`Provider ${provider.id} does not support auth method ${method}`);
  }

  const profileLabel = options.profileLabel ?? `${provider.displayName} profile`;
  const startResult = await handler.start({
    agentId: options.agentId,
    profileLabel,
    nonInteractive: options.nonInteractive,
    redirectUri: method === 'oauth_pkce' ? 'http://127.0.0.1:8787/callback' : undefined
  });

  const out = options.stdout ?? process.stdout;

  if (startResult.authUrl) {
    out.write(`Auth URL: ${startResult.authUrl}\n`);
  }
  if (startResult.instructions) {
    out.write(`${startResult.instructions}\n`);
  }

  // Interactive prompt for API key / setup token when not pre-supplied
  let apiKey = options.apiKey;
  let setupToken = options.setupToken;

  if ((method === 'api_key' || method === 'setup_token') && !apiKey && !setupToken) {
    if (options.nonInteractive) {
      throw new Error(`Non-interactive mode requires --api-key or --setup-token`);
    }
    const label = method === 'setup_token' ? 'setup token' : 'API key';
    const value = await promptInteractive(`Paste your ${label}: `);
    if (!value) throw new Error(`${label} cannot be empty`);
    if (method === 'setup_token') {
      setupToken = value;
    } else {
      apiKey = value;
    }
  }

  let code = options.code;
  let state = options.state ?? startResult.state;

  if (method === 'oauth_pkce' && !code) {
    if (options.nonInteractive) {
      throw new Error('Non-interactive OAuth requires --code and --state');
    }

    const manualPaste = startResult.metadata?.manualCodePaste === true;

    if (manualPaste) {
      // Non-localhost redirect (e.g. Anthropic shows code on their page)
      code = await promptInteractive('Paste the authorization code: ');
    } else if (startResult.state) {
      try {
        const callback = await waitForOAuthCallback(startResult.state);
        code = callback.code;
        state = callback.state;
      } catch {
        code = await promptInteractive('Paste OAuth code: ');
        state = await promptInteractive('Paste OAuth state: ');
      }
    }
  }

  // Use verifier from CLI flags, or fall back to the one generated by start()
  const verifier = options.verifier
    ?? (typeof startResult.metadata?.verifier === 'string' ? startResult.metadata.verifier : undefined);

  const input = {
    apiKey,
    setupToken,
    code,
    state,
    verifier,
  };

  const profile = await handler.complete(
    {
      agentId: options.agentId,
      profileLabel,
      nonInteractive: options.nonInteractive,
      redirectUri: method === 'oauth_pkce' ? 'http://127.0.0.1:8787/callback' : undefined
    },
    input
  );

  await kernel.authStore.upsertProfile(options.agentId, profile);
  out.write(`Auth profile saved: ${profile.providerId}/${profile.profileId}\n`);
}
