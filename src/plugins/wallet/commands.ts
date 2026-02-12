/**
 * Wallet Command Handlers
 * Full Solana wallet management with proxy billing
 */

import type { CommandHandler, CommandContext } from '../../core/commands/registry';
import type { TUIApp } from '../tui/TUIApp';
import { PROXY_CONFIG } from '../../core/config/constants';
import { display } from '../../core/ui';
import { container } from '../../core/di/container';
import { TYPES } from '../../core/di/types';
import type { EventBus } from '../../core/events/EventBus';
import { getPricingService, XAI_MODEL_PRICING } from './services';
import {
  walletExists,
  getPublicKey,
  createWallet,
  importWallet,
  importWalletFromSeed,
  isValidSeedPhrase,
  exportPrivateKey,
  exportSeedPhrase,
  hasSeedPhrase,
  getBalances,
  sendSol,
  sendSlashbot,
  redeemCredits,
  getCreditBalance,
  isValidAddress,
  getMaxSendableSol,
  unlockSession,
  isSessionActive,
  clearSession,
  getSessionAuthHeaders,
  WALLET_PATH,
  TREASURY_ADDRESS,
} from './services';
import { setPaymentMode, getPaymentMode, ProxyAuthProvider } from './provider';
import { PublicKey } from '@solana/web3.js';

// Active TUI reference — set per-command execution via setActiveTUI()
let activeTUI: TUIApp | undefined;

function setActiveTUI(tui?: TUIApp): void {
  activeTUI = tui;
}

/**
 * Prompt for password (hidden input)
 * Uses TUI promptInput when available, falls back to raw stdin
 */
async function promptPassword(prompt: string): Promise<string> {
  if (activeTUI) {
    return activeTUI.promptInput(prompt, { masked: true });
  }

  return new Promise(resolve => {
    process.stdout.write(prompt);
    let password = '';

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeyPress = (key: Buffer) => {
      const char = key.toString();
      if (char === '\r' || char === '\n') {
        cleanup();
        process.stdout.write('\n');
        resolve(password);
      } else if (char === '\x03') {
        cleanup();
        process.stdout.write('\n');
        resolve('');
      } else if (char === '\x7f' || char === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (char.length === 1 && char >= ' ') {
        password += char;
        process.stdout.write('*');
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onKeyPress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    };

    process.stdin.on('data', onKeyPress);
  });
}

/**
 * Prompt for text input (visible)
 * Uses TUI promptInput when available, falls back to raw stdin
 */
async function promptText(prompt: string): Promise<string> {
  if (activeTUI) {
    return activeTUI.promptInput(prompt);
  }

  return new Promise(resolve => {
    process.stdout.write(prompt);
    let text = '';

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeyPress = (key: Buffer) => {
      const char = key.toString();
      if (char === '\r' || char === '\n') {
        cleanup();
        process.stdout.write('\n');
        resolve(text);
      } else if (char === '\x03') {
        cleanup();
        process.stdout.write('\n');
        resolve('');
      } else if (char === '\x7f' || char === '\b') {
        if (text.length > 0) {
          text = text.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (char.length === 1 && char >= ' ') {
        text += char;
        process.stdout.write(char);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onKeyPress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    };

    process.stdin.on('data', onKeyPress);
  });
}

/**
 * Format number with appropriate precision
 */
function formatNumber(num: number, decimals = 6): string {
  if (num === 0) return '0';
  if (num < 0.000001) return num.toExponential(2);
  if (num < 1) return num.toFixed(decimals);
  if (num < 1000) return num.toFixed(4);
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ===== Usage helpers =====

function formatUsageNumber(num: number): string {
  return num.toLocaleString();
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

function formatUsd(usd: number): string {
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}

function renderWalletBlock(lines: string[]): void {
  display.renderMarkdown(lines.join('\n'), true);
}

async function fetchUsage(
  type: 'summary' | 'stats' | 'history',
  options: { period?: string; limit?: number } = {},
): Promise<any> {
  const publicKey = getPublicKey();
  if (!publicKey) {
    throw new Error('No wallet configured');
  }

  if (!isSessionActive()) {
    throw new Error('Wallet session not active. Run /solana mode token to unlock.');
  }

  const proxyUrl = PROXY_CONFIG.BASE_URL;
  const params = new URLSearchParams({ type });

  if (options.period) {
    params.set('period', options.period);
  }
  if (options.limit) {
    params.set('limit', options.limit.toString());
  }

  const authHeaders = getSessionAuthHeaders();
  if (!authHeaders) {
    throw new Error('Failed to sign request. Session may have expired.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders,
  };

  const response = await fetch(`${proxyUrl}/api/usage?${params}`, { headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export const walletCommands: CommandHandler[] = [
  {
    name: 'solana',
    aliases: ['wallet'],
    description: 'Manage Solana wallet, billing, and payments',
    group: 'Solana',
    subcommands: ['create', 'import', 'export', 'balance', 'send', 'redeem', 'deposit', 'unlock', 'lock', 'status', 'pricing', 'mode', 'usage'],
    usage: `/solana - Show wallet overview
/solana create - Create new wallet
/solana import <privatekey> - Import from private key
/solana import seed - Import from seed phrase (12/24 words)
/solana export - Export private key
/solana export seed - Export seed phrase (if available)
/solana balance - Show SOL & SLASHBOT balances
/solana send <sol|slashbot> <address> <amount|all> - Send tokens
/solana redeem <amount|all> - Send SLASHBOT to treasury for credits
/solana unlock - Unlock wallet for proxy session (30 min)
/solana lock - Lock wallet session
/solana status - Show proxy mode status
/solana pricing [model] - Show pricing
/solana pricing models - List all models
/solana mode - Show current payment mode
/solana mode apikey - Use API key for payments
/solana mode token - Pay with tokens
/solana usage - Show usage summary
/solana usage stats [day|week|month] - Detailed statistics
/solana usage history [limit] - Recent API calls
/solana usage models - Breakdown by model`,
    execute: async (args, context: CommandContext) => {
      setActiveTUI(context.tuiApp);
      const subcommand = args[0]?.toLowerCase();

      // /solana create
      if (subcommand === 'create') {
        if (walletExists()) {
          renderWalletBlock([
            'Wallet already exists. Export and backup before creating a new one.',
            `Location: ${WALLET_PATH}`,
          ]);
          return false;
        }

        const password = await promptPassword('Enter password for new wallet: ');
        if (!password || password.length < 8) {
          display.errorText('Password must be at least 8 characters.');
          return false;
        }

        const confirmPassword = await promptPassword('Confirm password: ');
        if (password !== confirmPassword) {
          display.errorText('Passwords do not match.');
          return false;
        }

        try {
          const { publicKey, seedPhrase } = createWallet(password);
          renderWalletBlock([
            'Wallet Created',
            '',
            `Address: ${publicKey}`,
            `File:    ${WALLET_PATH}`,
            '',
            'SEED PHRASE - BACKUP NOW!',
            '',
            seedPhrase,
            '',
            'WARNING: Write this down and store it securely!',
            'Anyone with this phrase can access your funds.',
            'You can export it later with: /solana export seed',
          ]);
          return true;
        } catch (error) {
          display.errorText(
            'Failed to create wallet: ' + (error instanceof Error ? error.message : String(error)),
          );
          return false;
        }
      }

      // /solana import <privatekey> OR /solana import seed
      if (subcommand === 'import') {
        const importType = args[1]?.toLowerCase();

        if (walletExists()) {
          renderWalletBlock([
            'Wallet already exists. Backup and delete it first.',
            `Location: ${WALLET_PATH}`,
          ]);
          return false;
        }

        // /solana import seed - Import from seed phrase
        if (importType === 'seed') {
          display.info('Enter your seed phrase (12 or 24 words):');
          const seedPhrase = await promptText('> ');

          if (!seedPhrase || !isValidSeedPhrase(seedPhrase.trim().toLowerCase())) {
            display.errorText('Invalid seed phrase. Must be 12 or 24 valid BIP39 words.');
            return false;
          }

          const password = await promptPassword('Enter password for wallet: ');
          if (!password || password.length < 8) {
            display.errorText('Password must be at least 8 characters.');
            return false;
          }

          try {
            const { publicKey } = importWalletFromSeed(seedPhrase, password);
            renderWalletBlock([
              'Wallet Imported from Seed',
              '',
              `Address: ${publicKey}`,
              `Path:    m/44'/501'/0'/0'`,
            ]);
            return true;
          } catch (error) {
            display.errorText('Failed to import wallet from seed phrase.');
            return false;
          }
        }

        // /solana import <privatekey> - Import from private key
        if (!importType) {
          renderWalletBlock([
            'Usage:',
            '/solana import <base58-private-key>',
            '/solana import seed',
          ]);
          return false;
        }

        const password = await promptPassword('Enter password for wallet: ');
        if (!password || password.length < 8) {
          display.errorText('Password must be at least 8 characters.');
          return false;
        }

        try {
          const { publicKey } = importWallet(importType, password);
          renderWalletBlock(['Wallet Imported', '', `Address: ${publicKey}`]);
          return true;
        } catch (error) {
          display.errorText('Failed to import wallet. Check your private key.');
          return false;
        }
      }

      // /solana export OR /solana export seed
      if (subcommand === 'export') {
        if (!walletExists()) {
          display.errorText('No wallet found. Run /solana create first.');
          return false;
        }

        const exportType = args[1]?.toLowerCase();

        // /solana export seed - Export seed phrase
        if (exportType === 'seed') {
          if (!hasSeedPhrase()) {
            renderWalletBlock([
              'No seed phrase available for this wallet.',
              'Wallets imported from a private key do not have a seed phrase.',
            ]);
            return false;
          }

          const password = await promptPassword('Enter wallet password: ');
          const seedPhrase = exportSeedPhrase(password);

          if (!seedPhrase) {
            display.errorText('Invalid password.');
            return false;
          }

          renderWalletBlock([
            'Seed Phrase Export',
            '',
            'WARNING: Never share your seed phrase!',
            '',
            seedPhrase,
          ]);
          return true;
        }

        // /solana export - Export private key
        const password = await promptPassword('Enter wallet password: ');
        const privateKey = exportPrivateKey(password);

        if (!privateKey) {
          display.errorText('Invalid password.');
          return false;
        }

        renderWalletBlock([
          'Private Key Export',
          '',
          'WARNING: Never share your private key!',
          '',
          privateKey,
        ]);
        return true;
      }

      // /solana balance
      if (subcommand === 'balance') {
        if (!walletExists()) {
          display.errorText('No wallet found. Run /solana create first.');
          return false;
        }

        display.info('Fetching balances...');

        const [balances, credits] = await Promise.all([getBalances(), getCreditBalance()]);

        const lines = ['Wallet Balance', '', `Address:  ${getPublicKey() || 'Unknown'}`, ''];
        if (balances) {
          lines.push(`SOL:      ${formatNumber(balances.sol, 9)} SOL`);
          lines.push(`SLASHBOT: ${formatNumber(balances.slashbot, 4)} tokens`);
        } else {
          lines.push('Unable to fetch on-chain balances');
        }
        lines.push('');
        lines.push(
          credits !== null ? `Credits:  ${credits.toLocaleString()}` : 'Credits:  (proxy offline)',
        );
        renderWalletBlock(lines);
        return true;
      }

      // /solana send <sol|slashbot> <address> <amount|all|max>
      if (subcommand === 'send') {
        const tokenType = args[1]?.toLowerCase();
        const toAddress = args[2];
        const amountArg = args[3]?.toLowerCase();

        if (!tokenType || !toAddress || !amountArg) {
          renderWalletBlock([
            'Usage: /solana send <sol|slashbot> <address> <amount|all|max>',
            '',
            'Examples:',
            '/solana send sol 7xKX...abc 0.1',
            '/solana send sol 7xKX...abc all    # Send all SOL minus fees',
            '/solana send slashbot 7xKX...abc 1000',
            '/solana send slashbot 7xKX...abc all',
          ]);
          return false;
        }

        if (tokenType !== 'sol' && tokenType !== 'slashbot') {
          display.errorText('Token type must be "sol" or "slashbot".');
          return false;
        }

        if (!isValidAddress(toAddress)) {
          display.errorText('Invalid Solana address.');
          return false;
        }

        const publicKeyStr = getPublicKey();
        if (!publicKeyStr) {
          display.errorText('No wallet configured.');
          return false;
        }

        // Handle "all" or "max" amounts
        let amount: number;
        const isMaxAmount = amountArg === 'all' || amountArg === 'max';

        if (isMaxAmount) {
          display.info('Calculating maximum sendable amount...');

          if (tokenType === 'sol') {
            amount = await getMaxSendableSol(new PublicKey(publicKeyStr), toAddress);
          } else {
            // For SLASHBOT, get full balance
            const balances = await getBalances();
            amount = balances?.slashbot || 0;
          }

          if (amount <= 0) {
            display.errorText('Insufficient balance to cover transaction fees.');
            return false;
          }

          display.info(`Maximum sendable: ${formatNumber(amount, 9)} ${tokenType.toUpperCase()}`);
        } else {
          amount = parseFloat(amountArg);
          if (isNaN(amount) || amount <= 0) {
            display.errorText('Amount must be a positive number or "all".');
            return false;
          }
        }

        const password = await promptPassword('Enter wallet password: ');

        display.info(`Sending ${formatNumber(amount, 9)} ${tokenType.toUpperCase()} to ${toAddress}...`);

        const result =
          tokenType === 'sol'
            ? await sendSol(password, toAddress, amount)
            : await sendSlashbot(password, toAddress, amount);

        if (result.success) {
          const signature = result.signature || 'Unknown';
          renderWalletBlock([
            'Transaction Sent',
            '',
            `Amount:    ${formatNumber(amount, 9)} ${tokenType.toUpperCase()}`,
            `Signature: ${signature}`,
            `Explorer:  https://solscan.io/tx/${result.signature || ''}`,
          ]);
          return true;
        } else {
          display.errorText(`Transaction failed: ${result.error}`);
          return false;
        }
      }

      // /solana redeem <amount|all>
      if (subcommand === 'redeem') {
        const amountArg = args[1]?.toLowerCase();

        if (!amountArg) {
          renderWalletBlock([
            'Usage: /solana redeem <amount|all>',
            'Sends SLASHBOT tokens to treasury and credits your account instantly.',
            'Examples:',
            '/solana redeem 1000',
            '/solana redeem all    # Redeem all SLASHBOT tokens',
          ]);
          return false;
        }

        if (!walletExists()) {
          display.errorText('No wallet found. Run /solana create first.');
          return false;
        }

        // Handle "all" or "max" amounts
        let amount: number;
        const isMaxAmount = amountArg === 'all' || amountArg === 'max';

        if (isMaxAmount) {
          display.info('Fetching SLASHBOT balance...');
          const balances = await getBalances();
          amount = balances?.slashbot || 0;

          if (amount <= 0) {
            display.errorText('No SLASHBOT tokens to redeem.');
            return false;
          }

          display.info(`Redeeming all: ${formatNumber(amount, 4)} SLASHBOT`);
        } else {
          amount = parseFloat(amountArg);
          if (isNaN(amount) || amount <= 0) {
            display.errorText('Amount must be a positive number or "all".');
            return false;
          }
        }

        const password = await promptPassword('Enter wallet password: ');

        display.info(
          `Sending ${formatNumber(amount, 4)} SLASHBOT to treasury and claiming credits...`,
        );

        const result = await redeemCredits(password, amount);

        if (result.success) {
          renderWalletBlock([
            'Credits Redeemed',
            '',
            `Tokens sent:     ${formatNumber(amount, 4)} SLASHBOT`,
            `Credits awarded: ${result.creditsAwarded?.toLocaleString() || '0'}`,
            `New balance:     ${(result.newBalance?.toLocaleString() || '0')} credits`,
          ]);
          return true;
        } else {
          display.errorText(`Redemption failed: ${result.error}`);
          return false;
        }
      }

      // /solana deposit
      if (subcommand === 'deposit') {
        const publicKey = getPublicKey();

        const lines = ['Deposit Instructions', ''];
        if (publicKey) {
          lines.push('Your wallet address:');
          lines.push(`  ${publicKey}`);
          lines.push('');
        }
        lines.push('Treasury address (for credit redemption):');
        lines.push(`  ${TREASURY_ADDRESS}`);
        lines.push('');
        lines.push('To add credits:');
        lines.push('1. Send SLASHBOT tokens to your wallet');
        lines.push('2. Run: /solana redeem <amount>');
        renderWalletBlock(lines);
        return true;
      }

      // /solana pricing [model]
      if (subcommand === 'pricing') {
        const pricingService = getPricingService();
        const model_arg = args[1];

        if (model_arg === 'models') {
          const lines = [
            'Available Models (xAI base prices x 5)',
            '',
            'Model                         | Input/1M | Output/1M',
            '------------------------------|----------|----------',
          ];

          for (const m of XAI_MODEL_PRICING) {
            const inputPrice = (m.inputPricePerMillion * 5).toFixed(2);
            const outputPrice = (m.outputPricePerMillion * 5).toFixed(2);
            const name = m.model.padEnd(29);
            lines.push(`${name} | $${inputPrice.padStart(6)} | $${outputPrice.padStart(7)}`);
          }

          lines.push('');
          lines.push('Prices shown in USD. Run /solana pricing <model> for full details.');
          renderWalletBlock(lines);

          return true;
        }

        const currentModel = context.grokClient?.getCurrentModel() || 'grok-4-1-fast-reasoning';
        const model = model_arg || currentModel;

        try {
          display.info('Fetching current exchange rates...');

          const info = await pricingService.getPricingInfo(model);

          const exampleCost = await pricingService.calculateCost(model, 1000, 500);
          renderWalletBlock([
            'SLASHBOT API Pricing',
            '',
            `Exchange Rates (updated ${new Date(info.exchangeRates.updatedAt).toLocaleTimeString()})`,
            `  SOL/USD:      $${formatNumber(info.exchangeRates.solUsd, 2)}`,
            `  SLASHBOT/SOL: ${formatNumber(info.exchangeRates.slashbotSol, 9)} SOL`,
            '',
            `Model: ${info.model}`,
            '',
            'Input Token Pricing (per 1M tokens):',
            `  USD:      $${formatNumber(info.inputPricePerMillion.usd)}`,
            `  SOL:      ${formatNumber(info.inputPricePerMillion.sol, 9)}`,
            `  SLASHBOT: ${formatNumber(info.inputPricePerMillion.slashbot)}`,
            '',
            'Output Token Pricing (per 1M tokens):',
            `  USD:      $${formatNumber(info.outputPricePerMillion.usd)}`,
            `  SOL:      ${formatNumber(info.outputPricePerMillion.sol, 9)}`,
            `  SLASHBOT: ${formatNumber(info.outputPricePerMillion.slashbot)}`,
            '',
            'Example (1000 in / 500 out tokens):',
            `  USD:      $${formatNumber(exampleCost.usd)}`,
            `  SOL:      ${formatNumber(exampleCost.sol, 9)}`,
            `  SLASHBOT: ${formatNumber(exampleCost.slashbot)}`,
            '',
            'Usage: /solana pricing [model]',
            '       /solana pricing models - List all models',
          ]);

          return true;
        } catch (error) {
          display.errorText(
            'Failed to fetch pricing: ' + (error instanceof Error ? error.message : String(error)),
          );
          return false;
        }
      }

      // /solana mode [apikey|token]
      if (subcommand === 'mode') {
        const mode = args[1]?.toLowerCase();

        if (!mode) {
          const currentMode =
            getPaymentMode() || context.configManager.getConfig().paymentMode || 'apikey';
          const lines = [`Current payment mode: ${currentMode}`];

          if (currentMode === 'token') {
            const publicKey = getPublicKey();
            const sessionActive = isSessionActive();
            lines.push(`  Wallet: ${publicKey || 'Not configured'}`);
            lines.push(
              `  Session: ${sessionActive ? 'Active (requests signed)' : 'Inactive (run /solana mode token to unlock)'}`,
            );
          }

          lines.push('');
          lines.push('Available modes: apikey, token');
          lines.push('Usage: /solana mode <apikey|token>');
          renderWalletBlock(lines);
          return true;
        }

        if (mode === 'apikey') {
          await context.configManager.saveConfig({ paymentMode: 'apikey' });
          setPaymentMode('apikey');
          renderWalletBlock([
            'Switched to API key payment mode',
            'API calls will be charged to your xAI API key.',
          ]);
          return true;
        }

        if (mode === 'token') {
          if (!walletExists()) {
            renderWalletBlock([
              'Cannot switch to token mode: no wallet configured.',
              'Run /solana create or /solana import first.',
            ]);
            return false;
          }

          if (!isSessionActive()) {
            renderWalletBlock([
              'Token mode requires wallet authentication.',
              'Every request will be signed with your private key.',
            ]);

            const password = await promptPassword('Enter wallet password: ');
            if (!password) {
              display.errorText('Cancelled.');
              return false;
            }

            const success = unlockSession(password);
            if (!success) {
              display.errorText('Invalid password.');
              return false;
            }
            try {
              container.get<EventBus>(TYPES.EventBus).emit({ type: 'wallet:unlocked' });
            } catch {}
          }

          await context.configManager.saveConfig({ paymentMode: 'token' });
          setPaymentMode('token');
          // Wire proxy auth into GrokClient
          if (context.grokClient) {
            context.grokClient.setAuthProvider(new ProxyAuthProvider());
          }

          const publicKey = getPublicKey();
          renderWalletBlock([
            'Switched to token payment mode',
            `  Wallet: ${publicKey}`,
            '  Session: Active (auto-extends on activity)',
            '  All API requests will be cryptographically signed.',
          ]);
          return true;
        }

        display.errorText('Invalid mode. Use "apikey" or "token".');
        return false;
      }

      // /solana usage [stats|history|models]
      if (subcommand === 'usage') {
        if (!walletExists()) {
          display.errorText('No wallet configured. Run /solana create first.');
          return false;
        }

        const currentMode = getPaymentMode() || context.configManager.getConfig().paymentMode;
        if (currentMode !== 'token') {
          renderWalletBlock([
            'Usage tracking is only available in token mode.',
            'Run /solana mode token to switch.',
          ]);
          return false;
        }

        const usageSubcmd = args[1]?.toLowerCase();

        try {
          if (usageSubcmd === 'stats') {
            const period = args[2]?.toLowerCase() || 'month';
            if (!['day', 'week', 'month', 'all'].includes(period)) {
              display.errorText('Invalid period. Use: day, week, month, or all');
              return false;
            }

            display.info(`Fetching ${period} statistics...`);
            const data = await fetchUsage('stats', { period });

            const lines = [
              `Usage Statistics (${period})`,
              '',
              'Requests',
              `  Total:      ${formatUsageNumber(data.totalRequests)}`,
              `  Successful: ${formatUsageNumber(data.successfulRequests)}`,
              `  Failed:     ${formatUsageNumber(data.failedRequests)}`,
              '',
              'Tokens',
              `  Input:     ${formatTokens(data.totalInputTokens)}`,
              `  Output:    ${formatTokens(data.totalOutputTokens)}`,
              `  Total:     ${formatTokens(data.totalTokens)}`,
            ];
            if (data.totalCachedTokens > 0) {
              lines.push(`  Cached:    ${formatTokens(data.totalCachedTokens)}`);
            }
            if (data.totalReasoningTokens > 0) {
              lines.push(`  Reasoning: ${formatTokens(data.totalReasoningTokens)}`);
            }
            lines.push('');
            lines.push('Cost');
            lines.push(`  USD:     ${formatUsd(data.totalCostUsd)}`);
            lines.push(`  Credits: ${formatUsageNumber(data.totalCreditsSpent)}`);
            lines.push('');
            lines.push('Averages (per request)');
            lines.push(`  Input:      ${formatTokens(data.avgInputTokens)} tokens`);
            lines.push(`  Output:     ${formatTokens(data.avgOutputTokens)} tokens`);
            lines.push(`  Cost:       ${data.avgCostCredits.toFixed(2)} credits`);
            lines.push(`  Latency:    ${formatUsageNumber(data.avgProcessingTimeMs)}ms`);

            if (data.byModel && Object.keys(data.byModel).length > 0) {
              lines.push('');
              lines.push('By Model');
              for (const [model, stats] of Object.entries(data.byModel) as [string, any][]) {
                lines.push(`  ${model}`);
                lines.push(`    Requests: ${formatUsageNumber(stats.requests)}`);
                lines.push(`    Tokens:   ${formatTokens(stats.inputTokens + stats.outputTokens)}`);
                lines.push(`    Credits:  ${formatUsageNumber(stats.costCredits)}`);
              }
            }

            renderWalletBlock(lines);
            return true;
          }

          if (usageSubcmd === 'history') {
            const limit = parseInt(args[2] || '10', 10);
            if (isNaN(limit) || limit < 1 || limit > 50) {
              display.errorText('Limit must be between 1 and 50.');
              return false;
            }

            display.info(`Fetching last ${limit} API calls...`);
            const data = await fetchUsage('history', { limit });

            const lines = ['Recent API Calls', ''];

            if (data.records.length === 0) {
              lines.push('No usage history found.');
            } else {
              for (const record of data.records) {
                const time = new Date(record.timestamp).toLocaleString();
                const status = record.success ? '✓' : '✗';
                const tokens = `${formatTokens(record.tokens.input)}→${formatTokens(record.tokens.output)}`;
                lines.push(`${status} ${time}`);
                lines.push(`  Model:   ${record.model}`);
                lines.push(`  Tokens:  ${tokens} (${formatTokens(record.tokens.total)} total)`);
                lines.push(`  Cost:    ${record.cost.credits} credits (${formatUsd(record.cost.usd)})`);
                lines.push(`  Latency: ${record.processingTimeMs}ms`);
                lines.push('');
              }
            }

            if (data.pagination) {
              lines.push(`Showing ${data.records.length} of ${data.pagination.total} records`);
            }

            renderWalletBlock(lines);
            return true;
          }

          if (usageSubcmd === 'models') {
            display.info('Fetching model breakdown...');
            const data = await fetchUsage('stats', { period: 'month' });

            const lines = ['Usage by Model (Last 30 Days)', ''];

            if (!data.byModel || Object.keys(data.byModel).length === 0) {
              lines.push('No model usage data found.');
            } else {
              const models = Object.entries(data.byModel).sort(
                (a: [string, any], b: [string, any]) => b[1].costCredits - a[1].costCredits,
              );

              lines.push('Model                          │ Requests │  Tokens  │ Credits');
              lines.push('───────────────────────────────┼──────────┼──────────┼────────');

              for (const [model, stats] of models as [string, any][]) {
                const name = model.padEnd(30);
                const reqs = formatUsageNumber(stats.requests).padStart(8);
                const tokens = formatTokens(stats.inputTokens + stats.outputTokens).padStart(8);
                const credits = formatUsageNumber(stats.costCredits).padStart(7);
                lines.push(`${name} │ ${reqs} │ ${tokens} │ ${credits}`);
              }

              lines.push('───────────────────────────────┼──────────┼──────────┼────────');
              const totalReqs = formatUsageNumber(data.totalRequests).padStart(8);
              const totalTokens = formatTokens(data.totalTokens).padStart(8);
              const totalCredits = formatUsageNumber(data.totalCreditsSpent).padStart(7);
              lines.push(`${'Total'.padEnd(30)} │ ${totalReqs} │ ${totalTokens} │ ${totalCredits}`);
            }

            renderWalletBlock(lines);
            return true;
          }

          // Default: /solana usage - Show summary
          display.info('Fetching usage summary...');
          const data = await fetchUsage('summary');

          const formatRow = (label: string, stats: any) => {
            const lbl = label.padEnd(10);
            const reqs = formatUsageNumber(stats.requests).padStart(8);
            const tokens = formatTokens(stats.tokens).padStart(10);
            const credits = formatUsageNumber(stats.credits).padStart(7);
            return `${lbl} │ ${reqs} │ ${tokens} │ ${credits}`;
          };

          renderWalletBlock([
            'Usage Summary',
            '',
            `Wallet: ${data.walletAddress}`,
            '',
            '           │ Requests │   Tokens   │ Credits',
            '───────────┼──────────┼────────────┼────────',
            formatRow('Today', data.today),
            formatRow('This Week', data.thisWeek),
            formatRow('This Month', data.thisMonth),
            '',
            'Commands:',
            '/solana usage stats [day|week|month]  - Detailed statistics',
            '/solana usage history [limit]         - Recent API calls',
            '/solana usage models                  - Breakdown by model',
          ]);

          return true;
        } catch (error) {
          display.errorText(
            `Failed to fetch usage data: ${error instanceof Error ? error.message : error}`,
          );
          return false;
        }
      }

      // /solana unlock - Start proxy session
      if (subcommand === 'unlock') {
        if (!walletExists()) {
          display.errorText('No wallet found. Run /solana create first.');
          return false;
        }

        if (isSessionActive()) {
          display.info('Wallet session already active.');
          return true;
        }

        const password = await promptPassword('Enter wallet password: ');
        const success = unlockSession(password);

        if (success) {
          renderWalletBlock([
            'Wallet Unlocked',
            '',
            'Session active for 30 minutes (auto-extends on activity)',
            'API requests will be authenticated with your wallet.',
          ]);
          try {
            container.get<EventBus>(TYPES.EventBus).emit({ type: 'wallet:unlocked' });
          } catch {}
          return true;
        } else {
          display.errorText('Invalid password.');
          return false;
        }
      }

      // /solana lock - End proxy session
      if (subcommand === 'lock') {
        clearSession();
        display.info('Wallet session locked.');
        try {
          container.get<EventBus>(TYPES.EventBus).emit({ type: 'wallet:locked' });
        } catch {}
        return true;
      }

      // /solana status - Show proxy mode status
      if (subcommand === 'status') {
        const publicKey = getPublicKey();
        const sessionActive = isSessionActive();
        const proxyConfigured = !!(PROXY_CONFIG.BASE_URL && publicKey);

        const currentMode = getPaymentMode() || context.configManager.getConfig().paymentMode || 'apikey';

        let modeDisplay: string;
        if (currentMode === 'apikey') {
          modeDisplay = 'API Key (direct)';
        } else if (!publicKey) {
          modeDisplay = 'Token (no wallet)';
        } else if (!sessionActive) {
          modeDisplay = 'Proxy (needs unlock)';
        } else {
          modeDisplay = 'Proxy (authenticated)';
        }

        const statusLines = [
          'Payment Mode Status',
          `Wallet:      ${publicKey || 'Not configured'}`,
          `Proxy URL:   ${PROXY_CONFIG.BASE_URL || 'Not configured'}`,
          `Session:     ${sessionActive ? 'Active (unlocked)' : 'Inactive (locked)'}`,
          `Mode:        ${modeDisplay}`,
        ];
        if (!proxyConfigured && !process.env.GROK_API_KEY && !process.env.XAI_API_KEY) {
          statusLines.push('');
          statusLines.push('WARNING: No API key or proxy configured!');
          statusLines.push('Set GROK_API_KEY or configure wallet for proxy mode.');
        }
        renderWalletBlock(statusLines);
        return true;
      }

      // Default: /solana - Show overview
      const publicKey = getPublicKey();

      let balances: any = null;
      let credits: number | null = null;
      if (publicKey) {
        [balances, credits] = await Promise.all([getBalances(), getCreditBalance()]);
      }

      const overviewLines: string[] = ['Solana Overview', ''];
      if (publicKey) {
        overviewLines.push(`Address: ${publicKey}`);
        overviewLines.push('');

        if (balances) {
          overviewLines.push(`SOL:      ${formatNumber(balances.sol, 9)} SOL`);
          overviewLines.push(`SLASHBOT: ${formatNumber(balances.slashbot, 4)} tokens`);
        }

        if (credits !== null) {
          overviewLines.push(`Credits:  ${credits.toLocaleString()}`);
        }
      } else {
        overviewLines.push('No wallet configured.');
        overviewLines.push('Run /solana create to create a new wallet');
        overviewLines.push('Or  /solana import <key> to import existing');
      }

      overviewLines.push('');
      overviewLines.push('Commands:');
      overviewLines.push('/solana create                  - Create new wallet');
      overviewLines.push('/solana import <key>            - Import private key');
      overviewLines.push('/solana import seed             - Import from seed phrase');
      overviewLines.push('/solana export                  - Export private key');
      overviewLines.push('/solana export seed             - Export seed phrase');
      overviewLines.push('/solana balance                 - Show balances');
      overviewLines.push('/solana send <type> <to> <amt>  - Send tokens');
      overviewLines.push('/solana redeem <amount>         - Redeem for credits');
      overviewLines.push('/solana unlock                  - Unlock for proxy mode');
      overviewLines.push('/solana lock                    - Lock wallet session');
      overviewLines.push('/solana status                  - Show proxy status');
      overviewLines.push('/solana pricing [model]         - Show pricing');
      overviewLines.push('/solana mode [apikey|token]     - Switch payment mode');
      overviewLines.push('/solana usage [stats|history|models] - Usage tracking');
      renderWalletBlock(overviewLines);

      return true;
    },
  },
];
