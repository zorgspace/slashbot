/**
 * Feature Wallet Plugin - Solana wallet management
 *
 * Handles wallet lifecycle via plugin hooks:
 * - onBeforeGrokInit: password prompting for token mode
 * - onAfterGrokInit: wiring ProxyAuthProvider if in token mode
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
  SidebarContribution,
} from '../types';
import type { CommandHandler } from '../../core/commands/registry';
import { registerActionParser } from '../../core/actions/parser';
import { executeWalletStatus, executeWalletSend } from './executors';
import { getWalletParserConfigs } from './parser';
import {
  walletExists,
  getPublicKey,
  getBalances,
  isSessionActive,
  getSessionAuthHeaders,
  sendSol,
  sendSlashbot,
  unlockSession,
  getCreditBalance,
} from './services';
import { getPaymentMode } from './provider';
export class WalletPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'feature.wallet',
    name: 'Wallet',
    version: '1.0.0',
    category: 'feature',
    description: 'Solana wallet management and token transfers',
  };

  private context!: PluginContext;

  async init(context: PluginContext): Promise<void> {
    this.context = context;
    for (const config of getWalletParserConfigs()) {
      registerActionParser(config);
    }
    await this.loadCommands();
  }

  async onBeforeGrokInit(context: PluginContext): Promise<void> {
    // If in token mode with a wallet, prompt for password to unlock session at startup
    const configManager = context.configManager as any;
    const savedConfig = configManager?.getConfig?.();
    if (!savedConfig) return;

    if (savedConfig.paymentMode === 'token' && walletExists() && !isSessionActive()) {
      const { display } = await import('../../core/ui');
      const { promptPassword } = await import('../../core/utils/input');

      display.muted('\n  Token mode requires wallet authentication.');
      display.muted('  Enter password to unlock, or type "apikey" to switch mode.\n');
      let unlocked = false;
      let attempts = 0;
      const maxAttempts = 3;

      while (!unlocked && attempts < maxAttempts) {
        attempts++;
        const password = await promptPassword('  Wallet password: ');

        if (!password) {
          // User cancelled (Ctrl+C)
          display.warningText('  Cancelled. Switching to API key mode.');
          await configManager.saveConfig?.({ paymentMode: 'apikey' });
          break;
        }

        // Check if user wants to switch to API key mode
        if (password.toLowerCase() === 'apikey') {
          display.successText('  Switched to API key mode.\n');
          await configManager.saveConfig?.({ paymentMode: 'apikey' });
          break;
        }

        unlocked = unlockSession(password);
        if (!unlocked) {
          const remaining = maxAttempts - attempts;
          if (remaining > 0) {
            display.errorText(`  Invalid password. ${remaining} attempt(s) remaining.`);
          } else {
            display.errorText('  Too many failed attempts. Switching to API key mode.');
            await configManager.saveConfig?.({ paymentMode: 'apikey' });
          }
        } else {
          display.successText('  Wallet unlocked.\n');
        }
      }
    }
  }

  async onAfterGrokInit(context: PluginContext): Promise<void> {
    // Wire billing auth provider if in token mode
    const configManager = context.configManager as any;
    const savedConfig = configManager?.getConfig?.();
    if (!savedConfig) return;

    if (savedConfig.paymentMode === 'token') {
      const getClient = context.getGrokClient;
      if (!getClient) return;
      const grokClient = getClient() as any;
      if (!grokClient) return;

      const { ProxyAuthProvider, setPaymentMode } = await import('./provider');
      setPaymentMode('token');
      grokClient.setAuthProvider(new ProxyAuthProvider());
    }
  }

  getActionContributions(): ActionContribution[] {
    return [
      {
        type: 'wallet-status',
        tagName: 'wallet-status',
        handler: {
          onWalletStatus: async () => {
            const exists = walletExists();
            const publicKey = getPublicKey();
            const sessionActive = isSessionActive();
            const mode = getPaymentMode();
            let balances: { sol: number; slashbot: number } | null = null;
            let credits: number | null = null;

            if (exists) {
              try {
                balances = await getBalances();
                credits = await getCreditBalance();
              } catch {
                // Unable to fetch balances/credits
              }
            }

            return { exists, publicKey, balances, sessionActive, mode, credits };
          },
        },
        execute: executeWalletStatus as any,
      },
      {
        type: 'wallet-send',
        tagName: 'wallet-send',
        handler: {
          onWalletSend: async (token: 'sol' | 'slashbot', toAddress: string, amount: number) => {
            if (!isSessionActive()) {
              return {
                success: false,
                error: 'Wallet session not active. Use /wallet unlock first.',
              };
            }

            // Use session auth headers to get the password context
            // The session keypair is already cached in memory
            const authHeaders = getSessionAuthHeaders();
            if (!authHeaders) {
              return {
                success: false,
                error: 'Session expired. Use /wallet unlock to re-authenticate.',
              };
            }

            return {
              success: false,
              error:
                'Wallet send via action tags requires an active session with cached keypair. Use /wallet send command instead.',
            };
          },
        },
        execute: executeWalletSend as any,
      },
    ];
  }

  private walletCmds: CommandHandler[] | null = null;

  private async loadCommands(): Promise<void> {
    const { walletCommands } = await import('./commands');
    this.walletCmds = walletCommands;
  }

  getCommandContributions(): CommandHandler[] {
    return this.walletCmds || [];
  }

  getSidebarContributions(): SidebarContribution[] {
    return [
      {
        id: 'wallet',
        label: 'Wallet',
        order: 30,
        getStatus: () => walletExists() && isSessionActive(),
      },
    ];
  }

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'feature.wallet.docs',
        title: 'Wallet - Solana Wallet Management',
        priority: 150,
        content: [
          'The wallet system allows checking balances and managing Solana tokens and sending SOL and SLASHBOT.',
          '',
          '**Check wallet status (read-only, always safe):**',
          '```',
          '<wallet-status/>',
          '```',
          '',
          '**Send tokens (requires unlocked wallet session):**',
          '```',
          '<wallet-send token="sol" to="ADDRESS" amount="0.1"/>',
          '<wallet-send token="slashbot" to="ADDRESS" amount="100"/>',
          '```',
          '',
          'Always confirm with the user before initiating any transfer.',
          '',
          '**Commands:** /wallet, /wallet create, /wallet balance, /wallet send, /wallet unlock, /wallet status',
        ].join('\n'),
      },
    ];
  }
}
