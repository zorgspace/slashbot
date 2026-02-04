/**
 * Mode Command Handlers
 * Switch between payment modes: API key or token-based payment
 */

import type { CommandHandler, CommandContext } from '../registry';
import { walletExists, isSessionActive, unlockSession, getPublicKey } from '../../services/wallet';

/**
 * Prompt for password (hidden input)
 */
async function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
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

export const modeHandlers: CommandHandler[] = [
  {
    name: 'mode',
    description: 'Switch between payment modes',
    usage: '/mode apikey - Use API key for payments\n/mode token - Pay with tokens\n/mode - Show current mode',
    execute: async (args: string[], context: CommandContext) => {
      const mode = args[0]?.toLowerCase();

      if (!mode) {
        // Show current mode (prefer grokClient's live mode, fall back to config)
        const currentMode = context.grokClient?.getPaymentMode() || context.configManager.getConfig().paymentMode || 'apikey';
        console.log(`\nCurrent payment mode: ${currentMode}`);

        if (currentMode === 'token') {
          const publicKey = getPublicKey();
          const sessionActive = isSessionActive();
          console.log(`  Wallet: ${publicKey || 'Not configured'}`);
          console.log(`  Session: ${sessionActive ? 'Active (requests signed)' : 'Inactive (run /mode token to unlock)'}`);
        }

        console.log('\nAvailable modes: apikey, token');
        console.log('Usage: /mode <apikey|token>\n');
        return true;
      }

      if (mode === 'apikey') {
        await context.configManager.saveConfig({ paymentMode: 'apikey' });
        context.grokClient?.setPaymentMode('apikey');
        console.log('\n✓ Switched to API key payment mode');
        console.log('API calls will be charged to your xAI API key.\n');
        return true;
      }

      if (mode === 'token') {
        // Check if wallet exists before switching to token mode
        if (!walletExists()) {
          console.log('\n❌ Cannot switch to token mode: no wallet configured.');
          console.log('Run /wallet create or /wallet import first.\n');
          return false;
        }

        // Check if session is already active
        if (!isSessionActive()) {
          // Prompt for password to unlock wallet for signing
          console.log('\nToken mode requires wallet authentication.');
          console.log('Every request will be signed with your private key.\n');

          const password = await promptPassword('Enter wallet password: ');
          if (!password) {
            console.log('\n❌ Cancelled.\n');
            return false;
          }

          const success = unlockSession(password);
          if (!success) {
            console.log('\n❌ Invalid password.\n');
            return false;
          }
        }

        await context.configManager.saveConfig({ paymentMode: 'token' });
        context.grokClient?.setPaymentMode('token');

        const publicKey = getPublicKey();
        console.log('\n✓ Switched to token payment mode');
        console.log(`  Wallet: ${publicKey}`);
        console.log('  Session: Active (auto-extends on activity)');
        console.log('  All API requests will be cryptographically signed.\n');
        return true;
      }

      console.log('\n❌ Invalid mode. Use "apikey" or "token".\n');
      return false;
    },
  },
];