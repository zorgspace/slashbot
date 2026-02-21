/**
 * Wallet plugin — Solana wallet management with transfers, pricing, and token-mode usage tracking.
 *
 * Manages an encrypted Solana keypair (BIP39 seed or raw private key) with
 * AES-256-GCM encryption. Supports SOL and SLASHBOT token transfers, credit
 * redemption, exchange rate tracking (CoinGecko/Jupiter/DexScreener), and
 * token-mode proxy authentication for LLM requests (Ed25519 signatures).
 *
 * Tools:
 *  - `wallet.status` — Get wallet existence, public key, balances (SOL + SLASHBOT), credits, and payment mode.
 *  - `wallet.send`   — Send SOL or SLASHBOT tokens to an address (requires approval).
 *  - `wallet.redeem`  — Redeem SLASHBOT tokens for API credits via treasury transfer (requires approval).
 *
 * Commands:
 *  - `/solana create <password>`                              — Create a new BIP39 wallet.
 *  - `/solana import <private-key> <password>`                — Import from base58 private key.
 *  - `/solana import seed <password> <seed phrase...>`        — Import from seed phrase.
 *  - `/solana export <password>`                              — Export private key (base58).
 *  - `/solana export seed <password>`                         — Export seed phrase.
 *  - `/solana balance`                                        — Show SOL, SLASHBOT, and credit balances.
 *  - `/solana send <sol|slashbot> <address> <amount> [pw]`    — Transfer tokens.
 *  - `/solana redeem <amount> [password]`                     — Redeem SLASHBOT for credits.
 *  - `/solana deposit`                                        — Show deposit instructions.
 *  - `/solana pricing [model|models]`                         — Show model pricing and exchange rates.
 *  - `/solana mode [apikey|token] [password]`                 — Get or switch payment mode.
 *  - `/solana usage [stats|history|models]`                   — Show usage stats (token mode only).
 *  - `/solana unlock <password>`                              — Unlock wallet session (30 min).
 *  - `/solana lock`                                           — Lock wallet session.
 *  - `/solana status`                                         — Full payment mode status.
 *
 * Services:
 *  - `wallet.proxyAuth` — TokenModeProxyAuthService for signing LLM proxy requests.
 */
import type { JsonValue, PathResolver, SlashbotPlugin } from '../../plugin-sdk/index.js';
import { asObject, asString } from '../utils.js';

import { PLUGIN_ID } from './types.js';
import { WalletService, asOptionalString, asTokenType } from './wallet-service.js';
import { createSolanaCommandHandler } from './wallet-commands.js';
import { createTokenModeProxyAuth } from './proxy-auth.js';

export function createWalletPlugin(): SlashbotPlugin {
  return {
    manifest: {
      id: PLUGIN_ID,
      name: 'Slashbot Wallet',
      version: '0.2.0',
      main: 'bundled',
      description: 'Solana wallet management with transfers, pricing, and token-mode usage tracking',
    },
    setup: async (context) => {
      const paths = context.getService<PathResolver>('kernel.paths')!;
      const homeDir = paths.home();
      const walletPath = paths.home('wallet.json');
      const walletSettingsPath = paths.home('wallet-settings.json');

      const svc = new WalletService(walletPath, walletSettingsPath, homeDir);
      svc.paymentMode = (await svc.readSettings()).paymentMode;

      // ── Proxy auth service ──────────────────────────────────────────

      const tokenModeProxyAuth = createTokenModeProxyAuth({
        readSettings: () => svc.readSettings(),
        readWalletPublicKey: async () => {
          const w = await svc.readWallet();
          return w?.publicKey ?? null;
        },
        isSessionActive: () => svc.isSessionActive(),
        getActiveSessionKeypair: () => svc.getActiveSessionKeypair(),
        resolveProxyBaseUrl: (settings) => svc.resolveProxyBaseUrl(settings),
        refreshSessionExpiry: () => svc.refreshSessionExpiry(),
      });

      context.registerService({
        id: 'wallet.proxyAuth',
        pluginId: PLUGIN_ID,
        description: 'Token-mode proxy auth resolver for LLM requests',
        implementation: tokenModeProxyAuth,
      });

      // ── Tools ───────────────────────────────────────────────────────

      context.registerTool({
        id: 'wallet.status',
        title: 'Status',
        pluginId: PLUGIN_ID,
        description: 'Get wallet status, balances, and payment mode. Args: {}',
        execute: async () => {
          try {
            const exists = await svc.walletExists();
            if (!exists) {
              return {
                ok: true,
                output: {
                  exists: false,
                  mode: svc.paymentMode,
                  message: 'No wallet found. Use /solana create or /solana import.',
                } as unknown as JsonValue,
              };
            }

            const wallet = await svc.readWallet();
            if (!wallet) {
              return { ok: false, error: { code: 'WALLET_READ_ERROR', message: 'Failed to parse wallet file' } };
            }

            const [balances, credits, settings] = await Promise.all([
              svc.getBalances(wallet.publicKey).catch(() => ({ sol: 0, slashbot: 0 })),
              svc.getCreditBalance(wallet.publicKey),
              svc.readSettings(),
            ]);

            return {
              ok: true,
              output: {
                exists: true,
                publicKey: wallet.publicKey,
                balance: balances,
                credits,
                sessionActive: svc.isSessionActive(),
                mode: settings.paymentMode,
                proxyBaseUrl: svc.resolveProxyBaseUrl(settings),
              } as unknown as JsonValue,
            };
          } catch (err) {
            return { ok: false, error: { code: 'WALLET_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'wallet.send',
        title: 'Send',
        pluginId: PLUGIN_ID,
        description: 'Send SOL or SLASHBOT. Args: { token?: "sol"|"slashbot", to: string, amount: number|string, password?: string }',
        requiresApproval: true,
        execute: async (args) => {
          try {
            const input = asObject(args);
            const token = input.token ? asTokenType(asString(input.token, 'token')) : 'sol';
            const to = asString(input.to, 'to');
            const amount = typeof input.amount === 'number' ? String(input.amount) : asString(input.amount, 'amount');
            const password = asOptionalString(input.password);

            const result = await svc.sendToken(token, to, amount, password);
            return {
              ok: true,
              output: {
                token,
                to,
                amount: result.amount,
                signature: result.signature,
              } as unknown as JsonValue,
            };
          } catch (err) {
            return { ok: false, error: { code: 'SEND_ERROR', message: String(err) } };
          }
        },
      });

      context.registerTool({
        id: 'wallet.redeem',
        title: 'Redeem',
        pluginId: PLUGIN_ID,
        description: 'Redeem SLASHBOT to credits via treasury transfer. Args: { amount: number|string, password?: string }',
        requiresApproval: true,
        execute: async (args) => {
          try {
            const input = asObject(args);
            const amount = typeof input.amount === 'number' ? String(input.amount) : asString(input.amount, 'amount');
            const password = asOptionalString(input.password);
            const result = await svc.redeemCredits(amount, password);
            return {
              ok: true,
              output: {
                amount: result.amount,
                signature: result.signature,
                creditsAwarded: result.creditsAwarded,
                newBalance: result.newBalance,
              } as unknown as JsonValue,
            };
          } catch (err) {
            return { ok: false, error: { code: 'REDEEM_ERROR', message: String(err) } };
          }
        },
      });

      // ── Commands ────────────────────────────────────────────────────

      const executeSolanaCommand = createSolanaCommandHandler(svc);

      context.registerCommand({
        id: 'solana',
        pluginId: PLUGIN_ID,
        description: 'Solana wallet management (create, import, export, balance, send, redeem, deposit, pricing, mode, usage, unlock, lock, status)',
        subcommands: ['create', 'import', 'export', 'balance', 'send', 'redeem', 'deposit', 'pricing', 'mode', 'usage', 'unlock', 'lock', 'status'],
        execute: executeSolanaCommand,
      });

      // Tool descriptions are self-explanatory; no extra prompt section needed.
    },
  };
}

export { createWalletPlugin as createPlugin };
