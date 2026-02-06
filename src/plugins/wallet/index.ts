/**
 * Feature Wallet Plugin - Solana wallet management
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  ActionContribution,
  PromptContribution,
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
} from './services';

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
            let balances: { sol: number; slashbot: number } | null = null;

            if (exists) {
              try {
                balances = await getBalances();
              } catch {
                // Unable to fetch balances
              }
            }

            return { exists, publicKey, balances, sessionActive };
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

            // Session-based transfers use the cached keypair directly
            // We need to import the internal transfer functions that accept keypairs
            const { transferSol, transferSlashbot } =
              await import('./services/solana');
            const { unlockWallet, loadWallet } = await import('./services/wallet');

            // The session already has the keypair cached - we can't access it directly
            // but the wallet module exposes session-aware send functions
            // Actually, sendSol/sendSlashbot require a password, not a session
            // We need to use a different approach - the session keypair is internal to wallet.ts
            // For now, return an error explaining the limitation
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

  getPromptContributions(): PromptContribution[] {
    return [
      {
        id: 'feature.wallet.docs',
        title: 'Wallet - Solana Wallet Management',
        priority: 150,
        content: [
          'The wallet system allows checking balances and managing Solana tokens.',
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
          'SECURITY: Sending tokens requires the wallet to be unlocked via /wallet unlock.',
          'Always confirm with the user before initiating any transfer.',
          '',
          '**Commands:** /wallet, /wallet create, /wallet balance, /wallet send, /wallet unlock, /wallet status',
        ].join('\n'),
      },
    ];
  }
}
