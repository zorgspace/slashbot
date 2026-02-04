/**
 * Wallet Command Handlers
 * Full Solana wallet management with proxy billing
 */

import type { CommandHandler, CommandContext } from '../registry';
import { PROXY_CONFIG } from '../../config/constants';
import { getPricingService, XAI_MODEL_PRICING } from '../../services/pricing';
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
  WALLET_PATH,
  TREASURY_ADDRESS,
} from '../../services/wallet';
import { PublicKey } from '@solana/web3.js';

/**
 * Prompt for password (hidden input)
 * Follows the same pattern as permissions.ts for stdin handling
 */
async function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    let password = '';

    // Enable raw mode for hidden input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeyPress = (key: Buffer) => {
      const char = key.toString();

      // Enter - submit
      if (char === '\r' || char === '\n') {
        cleanup();
        process.stdout.write('\n');
        resolve(password);
      }
      // Ctrl+C - cancel
      else if (char === '\x03') {
        cleanup();
        process.stdout.write('\n');
        resolve('');
      }
      // Backspace
      else if (char === '\x7f' || char === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      }
      // Regular character
      else if (char.length === 1 && char >= ' ') {
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
 */
async function promptText(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    let text = '';

    // Enable raw mode for character-by-character handling
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeyPress = (key: Buffer) => {
      const char = key.toString();

      // Enter - submit
      if (char === '\r' || char === '\n') {
        cleanup();
        process.stdout.write('\n');
        resolve(text);
      }
      // Ctrl+C - cancel
      else if (char === '\x03') {
        cleanup();
        process.stdout.write('\n');
        resolve('');
      }
      // Backspace
      else if (char === '\x7f' || char === '\b') {
        if (text.length > 0) {
          text = text.slice(0, -1);
          process.stdout.write('\b \b');
        }
      }
      // Regular character (printable)
      else if (char.length === 1 && char >= ' ') {
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

export const walletHandlers: CommandHandler[] = [
  {
    name: 'wallet',
    description: 'Manage Solana wallet for payments',
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
/wallet pricing [model] - Show pricing`,
    execute: async (args, context: CommandContext) => {
      const subcommand = args[0]?.toLowerCase();

      // /wallet create
      if (subcommand === 'create') {
        if (walletExists()) {
          console.log('\nWallet already exists. Export and backup before creating a new one.');
          console.log(`Location: ${WALLET_PATH}\n`);
          return false;
        }

        const password = await promptPassword('Enter password for new wallet: ');
        if (!password || password.length < 8) {
          console.log('\nPassword must be at least 8 characters.\n');
          return false;
        }

        const confirmPassword = await promptPassword('Confirm password: ');
        if (password !== confirmPassword) {
          console.log('\nPasswords do not match.\n');
          return false;
        }

        try {
          const { publicKey, seedPhrase } = createWallet(password);
          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('Wallet Created');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          console.log(`Address: ${publicKey}`);
          console.log(`File:    ${WALLET_PATH}\n`);
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('SEED PHRASE - BACKUP NOW!');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          console.log(seedPhrase);
          console.log('\nWARNING: Write this down and store it securely!');
          console.log('Anyone with this phrase can access your funds.');
          console.log('You can export it later with: /wallet export seed\n');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        } catch (error) {
          console.error('\nFailed to create wallet:', error);
          return false;
        }
      }

      // /wallet import <privatekey> OR /wallet import seed
      if (subcommand === 'import') {
        const importType = args[1]?.toLowerCase();

        if (walletExists()) {
          console.log('\nWallet already exists. Backup and delete it first.');
          console.log(`Location: ${WALLET_PATH}\n`);
          return false;
        }

        // /wallet import seed - Import from seed phrase
        if (importType === 'seed') {
          console.log('\nEnter your seed phrase (12 or 24 words):');
          const seedPhrase = await promptText('> ');

          if (!seedPhrase || !isValidSeedPhrase(seedPhrase.trim().toLowerCase())) {
            console.log('\nInvalid seed phrase. Must be 12 or 24 valid BIP39 words.\n');
            return false;
          }

          const password = await promptPassword('Enter password for wallet: ');
          if (!password || password.length < 8) {
            console.log('\nPassword must be at least 8 characters.\n');
            return false;
          }

          try {
            const { publicKey } = importWalletFromSeed(seedPhrase, password);
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('Wallet Imported from Seed');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            console.log(`Address: ${publicKey}`);
            console.log(`Path:    m/44'/501'/0'/0'\n`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            return true;
          } catch (error) {
            console.error('\nFailed to import wallet from seed phrase.\n');
            return false;
          }
        }

        // /wallet import <privatekey> - Import from private key
        if (!importType) {
          console.log('\nUsage:');
          console.log('  /wallet import <base58-private-key>');
          console.log('  /wallet import seed\n');
          return false;
        }

        const password = await promptPassword('Enter password for wallet: ');
        if (!password || password.length < 8) {
          console.log('\nPassword must be at least 8 characters.\n');
          return false;
        }

        try {
          const { publicKey } = importWallet(importType, password);
          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('Wallet Imported');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          console.log(`Address: ${publicKey}\n`);
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        } catch (error) {
          console.error('\nFailed to import wallet. Check your private key.\n');
          return false;
        }
      }

      // /wallet export OR /wallet export seed
      if (subcommand === 'export') {
        if (!walletExists()) {
          console.log('\nNo wallet found. Run /wallet create first.\n');
          return false;
        }

        const exportType = args[1]?.toLowerCase();

        // /wallet export seed - Export seed phrase
        if (exportType === 'seed') {
          if (!hasSeedPhrase()) {
            console.log('\nNo seed phrase available for this wallet.');
            console.log('Wallets imported from a private key do not have a seed phrase.\n');
            return false;
          }

          const password = await promptPassword('Enter wallet password: ');
          const seedPhrase = exportSeedPhrase(password);

          if (!seedPhrase) {
            console.log('\nInvalid password.\n');
            return false;
          }

          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('Seed Phrase Export');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          console.log('WARNING: Never share your seed phrase!\n');
          console.log(seedPhrase);
          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        }

        // /wallet export - Export private key
        const password = await promptPassword('Enter wallet password: ');
        const privateKey = exportPrivateKey(password);

        if (!privateKey) {
          console.log('\nInvalid password.\n');
          return false;
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Private Key Export');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log('WARNING: Never share your private key!\n');
        console.log(privateKey);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return true;
      }

      // /wallet balance
      if (subcommand === 'balance') {
        if (!walletExists()) {
          console.log('\nNo wallet found. Run /wallet create first.\n');
          return false;
        }

        console.log('\nFetching balances...\n');

        const [balances, credits] = await Promise.all([
          getBalances(),
          getCreditBalance(),
        ]);

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Wallet Balance');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log(`Address:  ${getPublicKey()}\n`);

        if (balances) {
          console.log(`SOL:      ${formatNumber(balances.sol, 9)} SOL`);
          console.log(`SLASHBOT: ${formatNumber(balances.slashbot, 4)} tokens`);
        } else {
          console.log('Unable to fetch on-chain balances');
        }

        if (credits !== null) {
          console.log(`Credits:  ${credits.toLocaleString()}`);
        } else {
          console.log('Credits:  (proxy offline)');
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return true;
      }

      // /wallet send <sol|slashbot> <address> <amount|all|max>
      if (subcommand === 'send') {
        const tokenType = args[1]?.toLowerCase();
        const toAddress = args[2];
        const amountArg = args[3]?.toLowerCase();

        if (!tokenType || !toAddress || !amountArg) {
          console.log('\nUsage: /wallet send <sol|slashbot> <address> <amount|all|max>\n');
          console.log('Examples:');
          console.log('  /wallet send sol 7xKX...abc 0.1');
          console.log('  /wallet send sol 7xKX...abc all    # Send all SOL minus fees');
          console.log('  /wallet send slashbot 7xKX...abc 1000');
          console.log('  /wallet send slashbot 7xKX...abc all\n');
          return false;
        }

        if (tokenType !== 'sol' && tokenType !== 'slashbot') {
          console.log('\nToken type must be "sol" or "slashbot".\n');
          return false;
        }

        if (!isValidAddress(toAddress)) {
          console.log('\nInvalid Solana address.\n');
          return false;
        }

        const publicKeyStr = getPublicKey();
        if (!publicKeyStr) {
          console.log('\nNo wallet configured.\n');
          return false;
        }

        // Handle "all" or "max" amounts
        let amount: number;
        const isMaxAmount = amountArg === 'all' || amountArg === 'max';

        if (isMaxAmount) {
          console.log('\nCalculating maximum sendable amount...\n');

          if (tokenType === 'sol') {
            amount = await getMaxSendableSol(new PublicKey(publicKeyStr), toAddress);
          } else {
            // For SLASHBOT, get full balance
            const balances = await getBalances();
            amount = balances?.slashbot || 0;
          }

          if (amount <= 0) {
            console.log('Insufficient balance to cover transaction fees.\n');
            return false;
          }

          console.log(`Maximum sendable: ${formatNumber(amount, 9)} ${tokenType.toUpperCase()}\n`);
        } else {
          amount = parseFloat(amountArg);
          if (isNaN(amount) || amount <= 0) {
            console.log('\nAmount must be a positive number or "all".\n');
            return false;
          }
        }

        const password = await promptPassword('Enter wallet password: ');

        console.log(`\nSending ${formatNumber(amount, 9)} ${tokenType.toUpperCase()} to ${toAddress}...\n`);

        const result = tokenType === 'sol'
          ? await sendSol(password, toAddress, amount)
          : await sendSlashbot(password, toAddress, amount);

        if (result.success) {
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('Transaction Sent');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          console.log(`Amount:    ${formatNumber(amount, 9)} ${tokenType.toUpperCase()}`);
          console.log(`Signature: ${result.signature}`);
          console.log(`Explorer:  https://solscan.io/tx/${result.signature}\n`);
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        } else {
          console.log(`\nTransaction failed: ${result.error}\n`);
          return false;
        }
      }

      // /wallet redeem <amount|all>
      if (subcommand === 'redeem') {
        const amountArg = args[1]?.toLowerCase();

        if (!amountArg) {
          console.log('\nUsage: /wallet redeem <amount|all>\n');
          console.log('Sends SLASHBOT tokens to treasury and credits your account instantly.\n');
          console.log('Examples:');
          console.log('  /wallet redeem 1000');
          console.log('  /wallet redeem all    # Redeem all SLASHBOT tokens\n');
          return false;
        }

        if (!walletExists()) {
          console.log('\nNo wallet found. Run /wallet create first.\n');
          return false;
        }

        // Handle "all" or "max" amounts
        let amount: number;
        const isMaxAmount = amountArg === 'all' || amountArg === 'max';

        if (isMaxAmount) {
          console.log('\nFetching SLASHBOT balance...\n');
          const balances = await getBalances();
          amount = balances?.slashbot || 0;

          if (amount <= 0) {
            console.log('No SLASHBOT tokens to redeem.\n');
            return false;
          }

          console.log(`Redeeming all: ${formatNumber(amount, 4)} SLASHBOT\n`);
        } else {
          amount = parseFloat(amountArg);
          if (isNaN(amount) || amount <= 0) {
            console.log('\nAmount must be a positive number or "all".\n');
            return false;
          }
        }

        const password = await promptPassword('Enter wallet password: ');

        console.log(`\nSending ${formatNumber(amount, 4)} SLASHBOT to treasury and claiming credits...\n`);

        const result = await redeemCredits(password, amount);

        if (result.success) {
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('Credits Redeemed');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          console.log(`Tokens sent:     ${formatNumber(amount, 4)} SLASHBOT`);
          console.log(`Credits awarded: ${result.creditsAwarded?.toLocaleString()}`);
          console.log(`New balance:     ${result.newBalance?.toLocaleString()} credits\n`);
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        } else {
          console.log(`\nRedemption failed: ${result.error}\n`);
          return false;
        }
      }

      // /wallet deposit
      if (subcommand === 'deposit') {
        const publicKey = getPublicKey();

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Deposit Instructions');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        if (publicKey) {
          console.log('Your wallet address:');
          console.log(`  ${publicKey}\n`);
        }

        console.log('Treasury address (for credit redemption):');
        console.log(`  ${TREASURY_ADDRESS}\n`);

        console.log('To add credits:');
        console.log('1. Send SLASHBOT tokens to your wallet');
        console.log('2. Run: /wallet redeem <amount>\n');

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return true;
      }

      // /wallet pricing [model]
      if (subcommand === 'pricing') {
        const currentModel = context.grokClient?.getCurrentModel() || 'grok-4-1-fast-reasoning';
        const model = args[1] || currentModel;

        if (model === 'models') {
          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('Available Models');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

          console.log('Model                         | Input/1M | Output/1M');
          console.log('------------------------------|----------|----------');

          for (const m of XAI_MODEL_PRICING) {
            const inputPrice = (m.inputPricePerMillion * 2.5).toFixed(2);
            const outputPrice = (m.outputPricePerMillion * 2.5).toFixed(2);
            const name = m.model.padEnd(29);
            console.log(`${name} | $${inputPrice.padStart(6)} | $${outputPrice.padStart(7)}`);
          }

          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        }

        try {
          console.log('\nFetching exchange rates...\n');

          const pricingService = getPricingService();
          const info = await pricingService.getPricingInfo(model);

          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('API Pricing');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

          console.log(`Exchange Rates (${new Date(info.exchangeRates.updatedAt).toLocaleTimeString()})`);
          console.log(`   SOL/USD:      $${formatNumber(info.exchangeRates.solUsd, 2)}`);
          console.log(`   SLASHBOT/SOL: ${formatNumber(info.exchangeRates.slashbotSol, 9)} SOL\n`);

          console.log(`Model: ${info.model}\n`);

          console.log('Input Token Pricing (per 1M tokens):');
          console.log(`   USD:      $${formatNumber(info.inputPricePerMillion.usd)}`);
          console.log(`   SOL:      ${formatNumber(info.inputPricePerMillion.sol, 9)}`);
          console.log(`   SLASHBOT: ${formatNumber(info.inputPricePerMillion.slashbot)}\n`);

          console.log('Output Token Pricing (per 1M tokens):');
          console.log(`   USD:      $${formatNumber(info.outputPricePerMillion.usd)}`);
          console.log(`   SOL:      ${formatNumber(info.outputPricePerMillion.sol, 9)}`);
          console.log(`   SLASHBOT: ${formatNumber(info.outputPricePerMillion.slashbot)}\n`);

          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        } catch (error) {
          console.error('Failed to fetch pricing:', error);
          return false;
        }
      }

      // /wallet unlock - Start proxy session
      if (subcommand === 'unlock') {
        if (!walletExists()) {
          console.log('\nNo wallet found. Run /wallet create first.\n');
          return false;
        }

        if (isSessionActive()) {
          console.log('\nWallet session already active.\n');
          return true;
        }

        const password = await promptPassword('Enter wallet password: ');
        const success = unlockSession(password);

        if (success) {
          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('Wallet Unlocked');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          console.log('Session active for 30 minutes (auto-extends on activity)');
          console.log('API requests will be authenticated with your wallet.\n');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        } else {
          console.log('\nInvalid password.\n');
          return false;
        }
      }

      // /wallet lock - End proxy session
      if (subcommand === 'lock') {
        clearSession();
        console.log('\nWallet session locked.\n');
        return true;
      }

      // /wallet status - Show proxy mode status
      if (subcommand === 'status') {
        const publicKey = getPublicKey();
        const sessionActive = isSessionActive();
        const proxyConfigured = !!(PROXY_CONFIG.BASE_URL && publicKey);

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Proxy Mode Status');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        console.log(`Wallet:      ${publicKey || 'Not configured'}`);
        console.log(`Proxy URL:   ${PROXY_CONFIG.BASE_URL || 'Not configured'}`);
        console.log(`Session:     ${sessionActive ? 'Active (unlocked)' : 'Inactive (locked)'}`);
        console.log(`Mode:        ${proxyConfigured ? (sessionActive ? 'Proxy (authenticated)' : 'Proxy (needs unlock)') : 'Direct API'}`);

        if (!proxyConfigured && !process.env.GROK_API_KEY && !process.env.XAI_API_KEY) {
          console.log('\nWARNING: No API key or proxy configured!');
          console.log('Set GROK_API_KEY or configure wallet for proxy mode.');
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return true;
      }

      // Default: /wallet - Show overview
      const publicKey = getPublicKey();

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Wallet');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      if (publicKey) {
        console.log(`Address: ${publicKey}`);

        // Fetch balances
        const [balances, credits] = await Promise.all([
          getBalances(),
          getCreditBalance(),
        ]);

        if (balances) {
          console.log(`SOL:     ${formatNumber(balances.sol, 9)} SOL`);
          console.log(`SLASHBOT: ${formatNumber(balances.slashbot, 4)} tokens`);
        }

        if (credits !== null) {
          console.log(`Credits: ${credits.toLocaleString()}`);
        }
      } else {
        console.log('No wallet configured.\n');
        console.log('Run /wallet create to create a new wallet');
        console.log('Or  /wallet import <key> to import existing');
      }

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Commands:');
      console.log('  /wallet create              - Create new wallet');
      console.log('  /wallet import <key>        - Import private key');
      console.log('  /wallet import seed         - Import from seed phrase');
      console.log('  /wallet export              - Export private key');
      console.log('  /wallet export seed         - Export seed phrase');
      console.log('  /wallet balance             - Show balances');
      console.log('  /wallet send <type> <to> <amt> - Send tokens');
      console.log('  /wallet redeem <amount>     - Redeem for credits');
      console.log('  /wallet unlock              - Unlock for proxy mode');
      console.log('  /wallet lock                - Lock wallet session');
      console.log('  /wallet status              - Show proxy status');
      console.log('  /wallet pricing             - Show pricing');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return true;
    },
  },
];
