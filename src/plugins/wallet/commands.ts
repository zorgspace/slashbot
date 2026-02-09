/**
 * Wallet Command Handlers
 * Full Solana wallet management with proxy billing
 */

import type { CommandHandler, CommandContext } from '../../core/commands/registry';
import type { TUIApp } from '../../core/ui/TUIApp';
import { PROXY_CONFIG } from '../../core/config/constants';
import { display } from '../../core/ui';
import { container } from '../../core/di/container';
import { TYPES } from '../../core/di/types';
import type { EventBus } from '../../core/events/EventBus';
import { getPricingService, XAI_MODEL_PRICING } from './services';
import {
  walletExists,
  loadWallet,
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

async function fetchUsage(
  type: 'summary' | 'stats' | 'history',
  options: { period?: string; limit?: number } = {},
): Promise<any> {
  const publicKey = getPublicKey();
  if (!publicKey) {
    throw new Error('No wallet configured');
  }

  if (!isSessionActive()) {
    throw new Error('Wallet session not active. Run /wallet mode token to unlock.');
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
    name: 'wallet',
    description: 'Manage Solana wallet, billing, and payments',
    group: 'Wallet',
    subcommands: ['create', 'import', 'export', 'balance', 'send', 'redeem', 'deposit', 'unlock', 'lock', 'status', 'pricing', 'mode', 'usage'],
    usage: `/wallet - Show wallet overview
/wallet create - Create new wallet
/wallet import <privatekey> - Import from private key
/wallet import seed - Import from seed phrase (12/24 words)
/wallet export - Export private key
/wallet export seed - Export seed phrase (if available)
/wallet balance - Show SOL & SLASHBOT balances
/wallet send <sol|slashbot> <address> <amount|all> - Send tokens
/wallet redeem <amount|all> - Send SLASHBOT to treasury for credits
/wallet unlock - Unlock wallet for proxy session (30 min)
/wallet lock - Lock wallet session
/wallet status - Show proxy mode status
/wallet pricing [model] - Show pricing
/wallet pricing models - List all models
/wallet mode - Show current payment mode
/wallet mode apikey - Use API key for payments
/wallet mode token - Pay with tokens
/wallet usage - Show usage summary
/wallet usage stats [day|week|month] - Detailed statistics
/wallet usage history [limit] - Recent API calls
/wallet usage models - Breakdown by model`,
    execute: async (args, context: CommandContext) => {
      setActiveTUI(context.tuiApp);
      const subcommand = args[0]?.toLowerCase();

      // /wallet create
      if (subcommand === 'create') {
        if (walletExists()) {
          display.append('\nWallet already exists. Export and backup before creating a new one.');
          display.append(`Location: ${WALLET_PATH}\n`);
          return false;
        }

        const password = await promptPassword('Enter password for new wallet: ');
        if (!password || password.length < 8) {
          display.append('\nPassword must be at least 8 characters.\n');
          return false;
        }

        const confirmPassword = await promptPassword('Confirm password: ');
        if (password !== confirmPassword) {
          display.append('\nPasswords do not match.\n');
          return false;
        }

        try {
          const { publicKey, seedPhrase } = createWallet(password);
          display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          display.append('Wallet Created');
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          display.append(`Address: ${publicKey}`);
          display.append(`File:    ${WALLET_PATH}\n`);
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          display.append('SEED PHRASE - BACKUP NOW!');
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          display.append(seedPhrase);
          display.append('\nWARNING: Write this down and store it securely!');
          display.append('Anyone with this phrase can access your funds.');
          display.append('You can export it later with: /wallet export seed\n');
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        } catch (error) {
          display.errorText(
            '\nFailed to create wallet: ' +
              (error instanceof Error ? error.message : String(error)),
          );
          return false;
        }
      }

      // /wallet import <privatekey> OR /wallet import seed
      if (subcommand === 'import') {
        const importType = args[1]?.toLowerCase();

        if (walletExists()) {
          display.append('\nWallet already exists. Backup and delete it first.');
          display.append(`Location: ${WALLET_PATH}\n`);
          return false;
        }

        // /wallet import seed - Import from seed phrase
        if (importType === 'seed') {
          display.append('\nEnter your seed phrase (12 or 24 words):');
          const seedPhrase = await promptText('> ');

          if (!seedPhrase || !isValidSeedPhrase(seedPhrase.trim().toLowerCase())) {
            display.append('\nInvalid seed phrase. Must be 12 or 24 valid BIP39 words.\n');
            return false;
          }

          const password = await promptPassword('Enter password for wallet: ');
          if (!password || password.length < 8) {
            display.append('\nPassword must be at least 8 characters.\n');
            return false;
          }

          try {
            const { publicKey } = importWalletFromSeed(seedPhrase, password);
            display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            display.append('Wallet Imported from Seed');
            display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            display.append(`Address: ${publicKey}`);
            display.append(`Path:    m/44'/501'/0'/0'\n`);
            display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            return true;
          } catch (error) {
            display.errorText('\nFailed to import wallet from seed phrase.\n');
            return false;
          }
        }

        // /wallet import <privatekey> - Import from private key
        if (!importType) {
          display.append('\nUsage:');
          display.append('  /wallet import <base58-private-key>');
          display.append('  /wallet import seed\n');
          return false;
        }

        const password = await promptPassword('Enter password for wallet: ');
        if (!password || password.length < 8) {
          display.append('\nPassword must be at least 8 characters.\n');
          return false;
        }

        try {
          const { publicKey } = importWallet(importType, password);
          display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          display.append('Wallet Imported');
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          display.append(`Address: ${publicKey}\n`);
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        } catch (error) {
          display.errorText('\nFailed to import wallet. Check your private key.\n');
          return false;
        }
      }

      // /wallet export OR /wallet export seed
      if (subcommand === 'export') {
        if (!walletExists()) {
          display.append('\nNo wallet found. Run /wallet create first.\n');
          return false;
        }

        const exportType = args[1]?.toLowerCase();

        // /wallet export seed - Export seed phrase
        if (exportType === 'seed') {
          if (!hasSeedPhrase()) {
            display.append('\nNo seed phrase available for this wallet.');
            display.append('Wallets imported from a private key do not have a seed phrase.\n');
            return false;
          }

          const password = await promptPassword('Enter wallet password: ');
          const seedPhrase = exportSeedPhrase(password);

          if (!seedPhrase) {
            display.append('\nInvalid password.\n');
            return false;
          }

          display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          display.append('Seed Phrase Export');
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          display.append('WARNING: Never share your seed phrase!\n');
          display.append(seedPhrase);
          display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        }

        // /wallet export - Export private key
        const password = await promptPassword('Enter wallet password: ');
        const privateKey = exportPrivateKey(password);

        if (!privateKey) {
          display.append('\nInvalid password.\n');
          return false;
        }

        display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        display.append('Private Key Export');
        display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        display.append('WARNING: Never share your private key!\n');
        display.append(privateKey);
        display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return true;
      }

      // /wallet balance
      if (subcommand === 'balance') {
        if (!walletExists()) {
          display.append('\nNo wallet found. Run /wallet create first.\n');
          return false;
        }

        display.append('\nFetching balances...\n');

        const [balances, credits] = await Promise.all([getBalances(), getCreditBalance()]);

        display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        display.append('Wallet Balance');
        display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        display.append(`Address:  ${getPublicKey()}\n`);

        if (balances) {
          display.append(`SOL:      ${formatNumber(balances.sol, 9)} SOL`);
          display.append(`SLASHBOT: ${formatNumber(balances.slashbot, 4)} tokens`);
        } else {
          display.append('Unable to fetch on-chain balances');
        }

        if (credits !== null) {
          display.append(`Credits:  ${credits.toLocaleString()}`);
        } else {
          display.append('Credits:  (proxy offline)');
        }

        display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return true;
      }

      // /wallet send <sol|slashbot> <address> <amount|all|max>
      if (subcommand === 'send') {
        const tokenType = args[1]?.toLowerCase();
        const toAddress = args[2];
        const amountArg = args[3]?.toLowerCase();

        if (!tokenType || !toAddress || !amountArg) {
          display.append('\nUsage: /wallet send <sol|slashbot> <address> <amount|all|max>\n');
          display.append('Examples:');
          display.append('  /wallet send sol 7xKX...abc 0.1');
          display.append('  /wallet send sol 7xKX...abc all    # Send all SOL minus fees');
          display.append('  /wallet send slashbot 7xKX...abc 1000');
          display.append('  /wallet send slashbot 7xKX...abc all\n');
          return false;
        }

        if (tokenType !== 'sol' && tokenType !== 'slashbot') {
          display.append('\nToken type must be "sol" or "slashbot".\n');
          return false;
        }

        if (!isValidAddress(toAddress)) {
          display.append('\nInvalid Solana address.\n');
          return false;
        }

        const publicKeyStr = getPublicKey();
        if (!publicKeyStr) {
          display.append('\nNo wallet configured.\n');
          return false;
        }

        // Handle "all" or "max" amounts
        let amount: number;
        const isMaxAmount = amountArg === 'all' || amountArg === 'max';

        if (isMaxAmount) {
          display.append('\nCalculating maximum sendable amount...\n');

          if (tokenType === 'sol') {
            amount = await getMaxSendableSol(new PublicKey(publicKeyStr), toAddress);
          } else {
            // For SLASHBOT, get full balance
            const balances = await getBalances();
            amount = balances?.slashbot || 0;
          }

          if (amount <= 0) {
            display.append('Insufficient balance to cover transaction fees.\n');
            return false;
          }

          display.append(
            `Maximum sendable: ${formatNumber(amount, 9)} ${tokenType.toUpperCase()}\n`,
          );
        } else {
          amount = parseFloat(amountArg);
          if (isNaN(amount) || amount <= 0) {
            display.append('\nAmount must be a positive number or "all".\n');
            return false;
          }
        }

        const password = await promptPassword('Enter wallet password: ');

        display.append(
          `\nSending ${formatNumber(amount, 9)} ${tokenType.toUpperCase()} to ${toAddress}...\n`,
        );

        const result =
          tokenType === 'sol'
            ? await sendSol(password, toAddress, amount)
            : await sendSlashbot(password, toAddress, amount);

        if (result.success) {
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          display.append('Transaction Sent');
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          display.append(`Amount:    ${formatNumber(amount, 9)} ${tokenType.toUpperCase()}`);
          display.append(`Signature: ${result.signature}`);
          display.append(`Explorer:  https://solscan.io/tx/${result.signature}\n`);
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        } else {
          display.append(`\nTransaction failed: ${result.error}\n`);
          return false;
        }
      }

      // /wallet redeem <amount|all>
      if (subcommand === 'redeem') {
        const amountArg = args[1]?.toLowerCase();

        if (!amountArg) {
          display.append('\nUsage: /wallet redeem <amount|all>\n');
          display.append('Sends SLASHBOT tokens to treasury and credits your account instantly.\n');
          display.append('Examples:');
          display.append('  /wallet redeem 1000');
          display.append('  /wallet redeem all    # Redeem all SLASHBOT tokens\n');
          return false;
        }

        if (!walletExists()) {
          display.append('\nNo wallet found. Run /wallet create first.\n');
          return false;
        }

        // Handle "all" or "max" amounts
        let amount: number;
        const isMaxAmount = amountArg === 'all' || amountArg === 'max';

        if (isMaxAmount) {
          display.append('\nFetching SLASHBOT balance...\n');
          const balances = await getBalances();
          amount = balances?.slashbot || 0;

          if (amount <= 0) {
            display.append('No SLASHBOT tokens to redeem.\n');
            return false;
          }

          display.append(`Redeeming all: ${formatNumber(amount, 4)} SLASHBOT\n`);
        } else {
          amount = parseFloat(amountArg);
          if (isNaN(amount) || amount <= 0) {
            display.append('\nAmount must be a positive number or "all".\n');
            return false;
          }
        }

        const password = await promptPassword('Enter wallet password: ');

        display.append(
          `\nSending ${formatNumber(amount, 4)} SLASHBOT to treasury and claiming credits...\n`,
        );

        const result = await redeemCredits(password, amount);

        if (result.success) {
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          display.append('Credits Redeemed');
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          display.append(`Tokens sent:     ${formatNumber(amount, 4)} SLASHBOT`);
          display.append(`Credits awarded: ${result.creditsAwarded?.toLocaleString()}`);
          display.append(`New balance:     ${result.newBalance?.toLocaleString()} credits\n`);
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        } else {
          display.append(`\nRedemption failed: ${result.error}\n`);
          return false;
        }
      }

      // /wallet deposit
      if (subcommand === 'deposit') {
        const publicKey = getPublicKey();

        display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        display.append('Deposit Instructions');
        display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        if (publicKey) {
          display.append('Your wallet address:');
          display.append(`  ${publicKey}\n`);
        }

        display.append('Treasury address (for credit redemption):');
        display.append(`  ${TREASURY_ADDRESS}\n`);

        display.append('To add credits:');
        display.append('1. Send SLASHBOT tokens to your wallet');
        display.append('2. Run: /wallet redeem <amount>\n');

        display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return true;
      }

      // /wallet pricing [model]
      if (subcommand === 'pricing') {
        const pricingService = getPricingService();
        const model_arg = args[1];

        if (model_arg === 'models') {
          display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          display.append('Available Models (xAI base prices x 5)');
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

          display.append('Model                         | Input/1M | Output/1M');
          display.append('------------------------------|----------|----------');

          for (const m of XAI_MODEL_PRICING) {
            const inputPrice = (m.inputPricePerMillion * 5).toFixed(2);
            const outputPrice = (m.outputPricePerMillion * 5).toFixed(2);
            const name = m.model.padEnd(29);
            display.append(`${name} | $${inputPrice.padStart(6)} | $${outputPrice.padStart(7)}`);
          }

          display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          display.append('Prices shown in USD. Run /wallet pricing <model> for full details.\n');

          return true;
        }

        const currentModel = context.grokClient?.getCurrentModel() || 'grok-4-1-fast-reasoning';
        const model = model_arg || currentModel;

        try {
          display.append('\nFetching current exchange rates...\n');

          const info = await pricingService.getPricingInfo(model);

          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          display.append('SLASHBOT API Pricing');
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

          display.append(
            `Exchange Rates (updated ${new Date(info.exchangeRates.updatedAt).toLocaleTimeString()})`,
          );
          display.append(`   SOL/USD:      $${formatNumber(info.exchangeRates.solUsd, 2)}`);
          display.append(
            `   SLASHBOT/SOL: ${formatNumber(info.exchangeRates.slashbotSol, 9)} SOL\n`,
          );

          display.append(`Model: ${info.model}\n`);

          display.append('Input Token Pricing (per 1M tokens):');
          display.append(`   USD:      $${formatNumber(info.inputPricePerMillion.usd)}`);
          display.append(`   SOL:      ${formatNumber(info.inputPricePerMillion.sol, 9)}`);
          display.append(`   SLASHBOT: ${formatNumber(info.inputPricePerMillion.slashbot)}\n`);

          display.append('Output Token Pricing (per 1M tokens):');
          display.append(`   USD:      $${formatNumber(info.outputPricePerMillion.usd)}`);
          display.append(`   SOL:      ${formatNumber(info.outputPricePerMillion.sol, 9)}`);
          display.append(`   SLASHBOT: ${formatNumber(info.outputPricePerMillion.slashbot)}\n`);

          const exampleCost = await pricingService.calculateCost(model, 1000, 500);
          display.append('Example (1000 in / 500 out tokens):');
          display.append(`   USD:      $${formatNumber(exampleCost.usd)}`);
          display.append(`   SOL:      ${formatNumber(exampleCost.sol, 9)}`);
          display.append(`   SLASHBOT: ${formatNumber(exampleCost.slashbot)}\n`);

          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          display.append('Usage: /wallet pricing [model]');
          display.append('       /wallet pricing models - List all models\n');

          return true;
        } catch (error) {
          display.errorText(
            'Failed to fetch pricing: ' + (error instanceof Error ? error.message : String(error)),
          );
          return false;
        }
      }

      // /wallet mode [apikey|token]
      if (subcommand === 'mode') {
        const mode = args[1]?.toLowerCase();

        if (!mode) {
          const currentMode =
            getPaymentMode() || context.configManager.getConfig().paymentMode || 'apikey';
          display.append(`\nCurrent payment mode: ${currentMode}`);

          if (currentMode === 'token') {
            const publicKey = getPublicKey();
            const sessionActive = isSessionActive();
            display.append(`  Wallet: ${publicKey || 'Not configured'}`);
            display.append(
              `  Session: ${sessionActive ? 'Active (requests signed)' : 'Inactive (run /wallet mode token to unlock)'}`,
            );
          }

          display.append('\nAvailable modes: apikey, token');
          display.append('Usage: /wallet mode <apikey|token>\n');
          return true;
        }

        if (mode === 'apikey') {
          await context.configManager.saveConfig({ paymentMode: 'apikey' });
          setPaymentMode('apikey');
          display.append('\n✓ Switched to API key payment mode');
          display.append('API calls will be charged to your xAI API key.\n');
          return true;
        }

        if (mode === 'token') {
          if (!walletExists()) {
            display.append('\n❌ Cannot switch to token mode: no wallet configured.');
            display.append('Run /wallet create or /wallet import first.\n');
            return false;
          }

          if (!isSessionActive()) {
            display.append('\nToken mode requires wallet authentication.');
            display.append('Every request will be signed with your private key.\n');

            const password = await promptPassword('Enter wallet password: ');
            if (!password) {
              display.append('\n❌ Cancelled.\n');
              return false;
            }

            const success = unlockSession(password);
            if (!success) {
              display.append('\n❌ Invalid password.\n');
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
          display.append('\n✓ Switched to token payment mode');
          display.append(`  Wallet: ${publicKey}`);
          display.append('  Session: Active (auto-extends on activity)');
          display.append('  All API requests will be cryptographically signed.\n');
          return true;
        }

        display.append('\n❌ Invalid mode. Use "apikey" or "token".\n');
        return false;
      }

      // /wallet usage [stats|history|models]
      if (subcommand === 'usage') {
        if (!walletExists()) {
          display.append('\nNo wallet configured. Run /wallet create first.\n');
          return false;
        }

        const currentMode = getPaymentMode() || context.configManager.getConfig().paymentMode;
        if (currentMode !== 'token') {
          display.append('\nUsage tracking is only available in token mode.');
          display.append('Run /wallet mode token to switch.\n');
          return false;
        }

        const usageSubcmd = args[1]?.toLowerCase();

        try {
          if (usageSubcmd === 'stats') {
            const period = args[2]?.toLowerCase() || 'month';
            if (!['day', 'week', 'month', 'all'].includes(period)) {
              display.append('\nInvalid period. Use: day, week, month, or all\n');
              return false;
            }

            display.append(`\nFetching ${period} statistics...\n`);
            const data = await fetchUsage('stats', { period });

            display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            display.append(`Usage Statistics (${period})`);
            display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            display.append('Requests');
            display.append(`  Total:      ${formatUsageNumber(data.totalRequests)}`);
            display.append(`  Successful: ${formatUsageNumber(data.successfulRequests)}`);
            display.append(`  Failed:     ${formatUsageNumber(data.failedRequests)}`);

            display.append('\nTokens');
            display.append(`  Input:     ${formatTokens(data.totalInputTokens)}`);
            display.append(`  Output:    ${formatTokens(data.totalOutputTokens)}`);
            display.append(`  Total:     ${formatTokens(data.totalTokens)}`);
            if (data.totalCachedTokens > 0) {
              display.append(`  Cached:    ${formatTokens(data.totalCachedTokens)}`);
            }
            if (data.totalReasoningTokens > 0) {
              display.append(`  Reasoning: ${formatTokens(data.totalReasoningTokens)}`);
            }

            display.append('\nCost');
            display.append(`  USD:     ${formatUsd(data.totalCostUsd)}`);
            display.append(`  Credits: ${formatUsageNumber(data.totalCreditsSpent)}`);

            display.append('\nAverages (per request)');
            display.append(`  Input:      ${formatTokens(data.avgInputTokens)} tokens`);
            display.append(`  Output:     ${formatTokens(data.avgOutputTokens)} tokens`);
            display.append(`  Cost:       ${data.avgCostCredits.toFixed(2)} credits`);
            display.append(`  Latency:    ${formatUsageNumber(data.avgProcessingTimeMs)}ms`);

            if (data.byModel && Object.keys(data.byModel).length > 0) {
              display.append('\nBy Model');
              for (const [model, stats] of Object.entries(data.byModel) as [string, any][]) {
                display.append(`  ${model}`);
                display.append(`    Requests: ${formatUsageNumber(stats.requests)}`);
                display.append(
                  `    Tokens:   ${formatTokens(stats.inputTokens + stats.outputTokens)}`,
                );
                display.append(`    Credits:  ${formatUsageNumber(stats.costCredits)}`);
              }
            }

            display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            return true;
          }

          if (usageSubcmd === 'history') {
            const limit = parseInt(args[2] || '10', 10);
            if (isNaN(limit) || limit < 1 || limit > 50) {
              display.append('\nLimit must be between 1 and 50.\n');
              return false;
            }

            display.append(`\nFetching last ${limit} API calls...\n`);
            const data = await fetchUsage('history', { limit });

            display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            display.append('Recent API Calls');
            display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            if (data.records.length === 0) {
              display.append('No usage history found.\n');
            } else {
              for (const record of data.records) {
                const time = new Date(record.timestamp).toLocaleString();
                const status = record.success ? '✓' : '✗';
                const tokens = `${formatTokens(record.tokens.input)}→${formatTokens(record.tokens.output)}`;
                display.append(`${status} ${time}`);
                display.append(`  Model:   ${record.model}`);
                display.append(`  Tokens:  ${tokens} (${formatTokens(record.tokens.total)} total)`);
                display.append(
                  `  Cost:    ${record.cost.credits} credits (${formatUsd(record.cost.usd)})`,
                );
                display.append(`  Latency: ${record.processingTimeMs}ms`);
                display.append('');
              }
            }

            if (data.pagination) {
              display.append(`Showing ${data.records.length} of ${data.pagination.total} records`);
            }

            display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            return true;
          }

          if (usageSubcmd === 'models') {
            display.append('\nFetching model breakdown...\n');
            const data = await fetchUsage('stats', { period: 'month' });

            display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            display.append('Usage by Model (Last 30 Days)');
            display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            if (!data.byModel || Object.keys(data.byModel).length === 0) {
              display.append('No model usage data found.\n');
            } else {
              const models = Object.entries(data.byModel).sort(
                (a: [string, any], b: [string, any]) => b[1].costCredits - a[1].costCredits,
              );

              display.append('Model                          │ Requests │  Tokens  │ Credits');
              display.append('───────────────────────────────┼──────────┼──────────┼────────');

              for (const [model, stats] of models as [string, any][]) {
                const name = model.padEnd(30);
                const reqs = formatUsageNumber(stats.requests).padStart(8);
                const tokens = formatTokens(stats.inputTokens + stats.outputTokens).padStart(8);
                const credits = formatUsageNumber(stats.costCredits).padStart(7);
                display.append(`${name} │ ${reqs} │ ${tokens} │ ${credits}`);
              }

              display.append('───────────────────────────────┼──────────┼──────────┼────────');
              const totalReqs = formatUsageNumber(data.totalRequests).padStart(8);
              const totalTokens = formatTokens(data.totalTokens).padStart(8);
              const totalCredits = formatUsageNumber(data.totalCreditsSpent).padStart(7);
              display.append(
                `${'Total'.padEnd(30)} │ ${totalReqs} │ ${totalTokens} │ ${totalCredits}`,
              );
            }

            display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            return true;
          }

          // Default: /wallet usage - Show summary
          display.append('\nFetching usage summary...\n');
          const data = await fetchUsage('summary');

          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          display.append('Usage Summary');
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

          display.append(`Wallet: ${data.walletAddress}\n`);

          display.append('           │ Requests │   Tokens   │ Credits');
          display.append('───────────┼──────────┼────────────┼────────');

          const formatRow = (label: string, stats: any) => {
            const lbl = label.padEnd(10);
            const reqs = formatUsageNumber(stats.requests).padStart(8);
            const tokens = formatTokens(stats.tokens).padStart(10);
            const credits = formatUsageNumber(stats.credits).padStart(7);
            return `${lbl} │ ${reqs} │ ${tokens} │ ${credits}`;
          };

          display.append(formatRow('Today', data.today));
          display.append(formatRow('This Week', data.thisWeek));
          display.append(formatRow('This Month', data.thisMonth));

          display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          display.append('Commands:');
          display.append('  /wallet usage stats [day|week|month]  - Detailed statistics');
          display.append('  /wallet usage history [limit]         - Recent API calls');
          display.append('  /wallet usage models                  - Breakdown by model');
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

          return true;
        } catch (error) {
          display.errorText(
            `\nFailed to fetch usage data: ${error instanceof Error ? error.message : error}\n`,
          );
          return false;
        }
      }

      // /wallet unlock - Start proxy session
      if (subcommand === 'unlock') {
        if (!walletExists()) {
          display.append('\nNo wallet found. Run /wallet create first.\n');
          return false;
        }

        if (isSessionActive()) {
          display.append('\nWallet session already active.\n');
          return true;
        }

        const password = await promptPassword('Enter wallet password: ');
        const success = unlockSession(password);

        if (success) {
          display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          display.append('Wallet Unlocked');
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          display.append('Session active for 30 minutes (auto-extends on activity)');
          display.append('API requests will be authenticated with your wallet.\n');
          display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          try {
            container.get<EventBus>(TYPES.EventBus).emit({ type: 'wallet:unlocked' });
          } catch {}
          return true;
        } else {
          display.append('\nInvalid password.\n');
          return false;
        }
      }

      // /wallet lock - End proxy session
      if (subcommand === 'lock') {
        clearSession();
        display.append('\nWallet session locked.\n');
        try {
          container.get<EventBus>(TYPES.EventBus).emit({ type: 'wallet:locked' });
        } catch {}
        return true;
      }

      // /wallet status - Show proxy mode status
      if (subcommand === 'status') {
        const publicKey = getPublicKey();
        const sessionActive = isSessionActive();
        const proxyConfigured = !!(PROXY_CONFIG.BASE_URL && publicKey);

        display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        display.append('Proxy Mode Status');
        display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        display.append(`Wallet:      ${publicKey || 'Not configured'}`);
        display.append(`Proxy URL:   ${PROXY_CONFIG.BASE_URL || 'Not configured'}`);
        display.append(`Session:     ${sessionActive ? 'Active (unlocked)' : 'Inactive (locked)'}`);
        display.append(
          `Mode:        ${proxyConfigured ? (sessionActive ? 'Proxy (authenticated)' : 'Proxy (needs unlock)') : 'Direct API'}`,
        );

        if (!proxyConfigured && !process.env.GROK_API_KEY && !process.env.XAI_API_KEY) {
          display.append('\nWARNING: No API key or proxy configured!');
          display.append('Set GROK_API_KEY or configure wallet for proxy mode.');
        }

        display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return true;
      }

      // Default: /wallet - Show overview
      const publicKey = getPublicKey();

      display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      display.append('Wallet');
      display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      if (publicKey) {
        display.append(`Address: ${publicKey}`);

        // Fetch balances
        const [balances, credits] = await Promise.all([getBalances(), getCreditBalance()]);

        if (balances) {
          display.append(`SOL:     ${formatNumber(balances.sol, 9)} SOL`);
          display.append(`SLASHBOT: ${formatNumber(balances.slashbot, 4)} tokens`);
        }

        if (credits !== null) {
          display.append(`Credits: ${credits.toLocaleString()}`);
        }
      } else {
        display.append('No wallet configured.\n');
        display.append('Run /wallet create to create a new wallet');
        display.append('Or  /wallet import <key> to import existing');
      }

      display.append('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      display.append('Commands:');
      display.append('  /wallet create              - Create new wallet');
      display.append('  /wallet import <key>        - Import private key');
      display.append('  /wallet import seed         - Import from seed phrase');
      display.append('  /wallet export              - Export private key');
      display.append('  /wallet export seed         - Export seed phrase');
      display.append('  /wallet balance             - Show balances');
      display.append('  /wallet send <type> <to> <amt> - Send tokens');
      display.append('  /wallet redeem <amount>     - Redeem for credits');
      display.append('  /wallet unlock              - Unlock for proxy mode');
      display.append('  /wallet lock                - Lock wallet session');
      display.append('  /wallet status              - Show proxy status');
      display.append('  /wallet pricing [model]     - Show pricing');
      display.append('  /wallet mode [apikey|token] - Switch payment mode');
      display.append('  /wallet usage [stats|history|models] - Usage tracking');
      display.append('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return true;
    },
  },
];
