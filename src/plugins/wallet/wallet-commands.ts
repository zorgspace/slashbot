/**
 * wallet/wallet-commands.ts — The /solana command handler.
 *
 * Exports a factory function that takes a WalletService and returns the command executor.
 * Depends on: types.ts (constants), wallet-service.ts (WalletService).
 */
import type { WalletService } from './wallet-service.js';
import type { WalletBalances } from './types.js';
import {
  TREASURY_ADDRESS,
  XAI_MODEL_PRICING,
  formatNumber,
} from './types.js';
import {
  getModelPricing,
  calculateBaseUsdCost,
  usdToSol,
  usdToSlashbot,
} from './pricing.js';

type CommandContext = { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };

/**
 * Create the /solana command handler bound to the given WalletService instance.
 */
export function createSolanaCommandHandler(svc: WalletService): (args: string[], ctx: CommandContext) => Promise<number> {
  return async function executeSolanaCommand(args: string[], commandContext: CommandContext): Promise<number> {
    const sub = args[0]?.toLowerCase() ?? 'overview';

    if (sub === 'create') {
      if (await svc.walletExists()) {
        commandContext.stdout.write(`Wallet already exists at ${svc.walletPath}\n`);
        return 1;
      }

      const password = args[1];
      if (!password || password.length < 8) {
        commandContext.stderr.write('Usage: solana create <password>  (password min length: 8)\n');
        return 1;
      }

      try {
        const created = await svc.createWallet(password);
        commandContext.stdout.write(
          `Wallet created\nAddress: ${created.publicKey}\nPath: ${svc.walletPath}\nSeed phrase (backup now): ${created.seedPhrase}\n`,
        );
        return 0;
      } catch (err) {
        commandContext.stderr.write(`Failed to create wallet: ${String(err)}\n`);
        return 1;
      }
    }

    if (sub === 'import') {
      if (await svc.walletExists()) {
        commandContext.stderr.write(`Wallet already exists at ${svc.walletPath}\n`);
        return 1;
      }

      const importType = args[1]?.toLowerCase();
      if (!importType) {
        commandContext.stderr.write('Usage: solana import <base58-private-key> <password>\n       solana import seed <password> <seed phrase...> [accountIndex]\n');
        return 1;
      }

      if (importType === 'seed') {
        const password = args[2];
        if (!password || password.length < 8) {
          commandContext.stderr.write('Usage: solana import seed <password> <seed phrase...> [accountIndex]\n');
          return 1;
        }

        const maybeIndex = args[args.length - 1];
        const parsedIndex = Number(maybeIndex);
        const hasIndex = Number.isInteger(parsedIndex) && parsedIndex >= 0;
        const seedParts = args.slice(3, hasIndex ? -1 : undefined);
        const seedPhrase = seedParts.join(' ').trim();
        if (!seedPhrase) {
          commandContext.stderr.write('Missing seed phrase.\n');
          return 1;
        }

        try {
          const imported = await svc.importWalletFromSeed(seedPhrase, password, hasIndex ? parsedIndex : 0);
          commandContext.stdout.write(`Wallet imported from seed\nAddress: ${imported.publicKey}\nPath: m/44'/501'/${hasIndex ? parsedIndex : 0}'/0'\n`);
          return 0;
        } catch (err) {
          commandContext.stderr.write(`Failed to import seed wallet: ${String(err)}\n`);
          return 1;
        }
      }

      const privateKey = args[1];
      const password = args[2];
      if (!privateKey || !password || password.length < 8) {
        commandContext.stderr.write('Usage: solana import <base58-private-key> <password>\n');
        return 1;
      }

      try {
        const imported = await svc.importWalletFromPrivateKey(privateKey, password);
        commandContext.stdout.write(`Wallet imported\nAddress: ${imported.publicKey}\n`);
        return 0;
      } catch (err) {
        commandContext.stderr.write(`Failed to import wallet: ${String(err)}\n`);
        return 1;
      }
    }

    if (sub === 'export') {
      if (!(await svc.walletExists())) {
        commandContext.stderr.write('No wallet found. Use: solana create\n');
        return 1;
      }

      const target = args[1]?.toLowerCase();
      if (target === 'seed') {
        const password = args[2];
        if (!password) {
          commandContext.stderr.write('Usage: solana export seed <password>\n');
          return 1;
        }

        if (!(await svc.hasSeedPhrase())) {
          commandContext.stderr.write('This wallet does not have a stored seed phrase (private-key import).\n');
          return 1;
        }

        const phrase = await svc.exportSeedPhrase(password);
        if (!phrase) {
          commandContext.stderr.write('Failed to export seed phrase (invalid password?).\n');
          return 1;
        }

        commandContext.stdout.write(`Seed phrase:\n${phrase}\n`);
        return 0;
      }

      const password = target ?? args[2];
      if (!password) {
        commandContext.stderr.write('Usage: solana export <password>\n       solana export seed <password>\n');
        return 1;
      }

      const exportedKey = await svc.exportPrivateKey(password);
      if (!exportedKey) {
        commandContext.stderr.write('Failed to export private key (invalid password?).\n');
        return 1;
      }

      commandContext.stdout.write(`Private key (base58):\n${exportedKey}\n`);
      return 0;
    }

    if (sub === 'unlock') {
      if (!(await svc.walletExists())) {
        commandContext.stderr.write('No wallet found. Use: solana create\n');
        return 1;
      }

      const password = args[1];
      if (!password) {
        commandContext.stderr.write('Usage: solana unlock <password>\n');
        return 1;
      }

      const ok = await svc.unlockSession(password);
      commandContext.stdout.write(ok ? 'Wallet unlocked (session active for 30 minutes).\n' : 'Failed to unlock wallet.\n');
      return ok ? 0 : 1;
    }

    if (sub === 'lock') {
      svc.clearSession();
      commandContext.stdout.write('Wallet session locked.\n');
      return 0;
    }

    if (sub === 'balance') {
      const wallet = await svc.readWallet();
      if (!wallet) {
        commandContext.stderr.write('No wallet found. Use: solana create\n');
        return 1;
      }

      const [balances, credits] = await Promise.all([
        svc.getBalances(wallet.publicKey).catch(() => ({ sol: 0, slashbot: 0 })),
        svc.getCreditBalance(wallet.publicKey),
      ]);

      commandContext.stdout.write(
        `Address: ${wallet.publicKey}\nSOL: ${formatNumber(balances.sol, 9)}\nSLASHBOT: ${formatNumber(balances.slashbot, 4)}\nCredits: ${credits === null ? '(proxy unavailable)' : credits}\n`,
      );
      return 0;
    }

    if (sub === 'send') {
      const token = args[1]?.toLowerCase();
      const toAddress = args[2];
      const amount = args[3];
      const password = args[4];

      if (!token || !toAddress || !amount) {
        commandContext.stderr.write('Usage: solana send <sol|slashbot> <address> <amount|all|max> [password]\n');
        return 1;
      }

      if (token !== 'sol' && token !== 'slashbot') {
        commandContext.stderr.write('Token type must be sol or slashbot.\n');
        return 1;
      }

      try {
        const sent = await svc.sendToken(token, toAddress, amount, password);
        commandContext.stdout.write(
          `Sent ${formatNumber(sent.amount, token === 'sol' ? 9 : 4)} ${token.toUpperCase()} to ${toAddress}\nSignature: ${sent.signature}\n`,
        );
        return 0;
      } catch (err) {
        commandContext.stderr.write(`Send failed: ${String(err)}\n`);
        return 1;
      }
    }

    if (sub === 'redeem') {
      const amount = args[1];
      const password = args[2];
      if (!amount) {
        commandContext.stderr.write('Usage: solana redeem <amount|all|max> [password]\n');
        return 1;
      }

      try {
        const result = await svc.redeemCredits(amount, password);
        commandContext.stdout.write(
          `Redeemed ${formatNumber(result.amount, 4)} SLASHBOT\nTx: ${result.signature}\nCredits awarded: ${result.creditsAwarded ?? '(unknown)'}\nNew credit balance: ${result.newBalance ?? '(unknown)'}\n`,
        );
        return 0;
      } catch (err) {
        commandContext.stderr.write(`Redeem failed: ${String(err)}\n`);
        return 1;
      }
    }

    if (sub === 'deposit') {
      const wallet = await svc.readWallet();
      commandContext.stdout.write(
        `Deposit instructions\n${wallet ? `Your wallet: ${wallet.publicKey}\n` : ''}Treasury: ${TREASURY_ADDRESS}\n1. Receive SLASHBOT in your wallet\n2. Run: solana redeem <amount>\n`,
      );
      return 0;
    }

    if (sub === 'pricing') {
      const modelArg = args[1];

      if (modelArg === 'models') {
        commandContext.stdout.write('Available models (USD per 1M tokens, x5 display multiplier)\n');
        for (const model of XAI_MODEL_PRICING) {
          const input = (model.inputPricePerMillion * 5).toFixed(2);
          const output = (model.outputPricePerMillion * 5).toFixed(2);
          commandContext.stdout.write(`- ${model.model}: input $${input}, output $${output}\n`);
        }
        return 0;
      }

      const targetModel = modelArg ?? 'grok-4.1-fast-reasoning';

      try {
        const rates = await svc.fetchExchangeRates();
        const pricing = getModelPricing(targetModel);
        const sampleUsd = calculateBaseUsdCost(targetModel, 1000, 500);
        const sampleSol = usdToSol(sampleUsd, rates.solUsd);
        const sampleSlashbot = usdToSlashbot(sampleUsd, rates.solUsd, rates.slashbotSol);

        commandContext.stdout.write(
          [
            `Model: ${pricing.model}`,
            `Exchange rates: SOL/USD=${formatNumber(rates.solUsd, 2)}, SLASHBOT/SOL=${formatNumber(rates.slashbotSol, 9)}`,
            `Input per 1M: $${formatNumber(pricing.inputPricePerMillion)}`,
            `Output per 1M: $${formatNumber(pricing.outputPricePerMillion)}`,
            `Example (1000 in / 500 out): $${formatNumber(sampleUsd)} | ${formatNumber(sampleSol, 9)} SOL | ${formatNumber(sampleSlashbot)} SLASHBOT`,
          ].join('\n') + '\n',
        );
        return 0;
      } catch (err) {
        commandContext.stderr.write(`Pricing failed: ${String(err)}\n`);
        return 1;
      }
    }

    if (sub === 'mode') {
      const mode = args[1]?.toLowerCase();
      if (!mode) {
        commandContext.stdout.write(`Current payment mode: ${svc.paymentMode}\nUsage: solana mode <apikey|token> [password]\n`);
        return 0;
      }

      if (mode !== 'apikey' && mode !== 'token') {
        commandContext.stderr.write('Invalid mode. Use apikey or token.\n');
        return 1;
      }

      if (mode === 'token') {
        if (!(await svc.walletExists())) {
          commandContext.stderr.write('No wallet configured. Use solana create or solana import first.\n');
          return 1;
        }

        if (!svc.isSessionActive()) {
          const password = args[2];
          if (!password) {
            commandContext.stderr.write('Token mode needs an unlocked session. Use: solana mode token <password> or solana unlock <password>\n');
            return 1;
          }
          const unlocked = await svc.unlockSession(password);
          if (!unlocked) {
            commandContext.stderr.write('Invalid wallet password.\n');
            return 1;
          }
        }
      }

      await svc.saveSettings({ paymentMode: mode });
      svc.paymentMode = mode;
      commandContext.stdout.write(`Switched payment mode to ${mode}.\n`);
      return 0;
    }

    if (sub === 'usage') {
      const wallet = await svc.readWallet();
      if (!wallet) {
        commandContext.stderr.write('No wallet configured.\n');
        return 1;
      }

      if (svc.paymentMode !== 'token') {
        commandContext.stderr.write('Usage tracking is available only in token mode. Run: solana mode token <password>\n');
        return 1;
      }

      if (!svc.isSessionActive()) {
        commandContext.stderr.write('Wallet session is locked. Run: solana unlock <password>\n');
        return 1;
      }

      const usageSub = args[1]?.toLowerCase();

      try {
        if (usageSub === 'stats') {
          const period = args[2]?.toLowerCase() ?? 'month';
          if (!['day', 'week', 'month', 'all'].includes(period)) {
            commandContext.stderr.write('Invalid period. Use day, week, month, or all.\n');
            return 1;
          }

          const data = await svc.fetchUsage('stats', { period });
          commandContext.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
          return 0;
        }

        if (usageSub === 'history') {
          const limitRaw = args[2] ?? '10';
          const limit = Number(limitRaw);
          if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
            commandContext.stderr.write('History limit must be an integer between 1 and 50.\n');
            return 1;
          }

          const data = await svc.fetchUsage('history', { limit });
          commandContext.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
          return 0;
        }

        if (usageSub === 'models') {
          const data = await svc.fetchUsage('stats', { period: 'month' });
          commandContext.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
          return 0;
        }

        const data = await svc.fetchUsage('summary');
        commandContext.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
        return 0;
      } catch (err) {
        commandContext.stderr.write(`Failed to fetch usage: ${String(err)}\n`);
        return 1;
      }
    }

    if (sub === 'status') {
      const wallet = await svc.readWallet();
      const settings = await svc.readSettings();
      const proxyBaseUrl = svc.resolveProxyBaseUrl(settings);
      const sessionState = svc.isSessionActive() ? 'active' : 'locked';

      let balances: WalletBalances | null = null;
      let credits: number | null = null;
      if (wallet) {
        [balances, credits] = await Promise.all([
          svc.getBalances(wallet.publicKey).catch(() => null),
          svc.getCreditBalance(wallet.publicKey),
        ]);
      }

      commandContext.stdout.write(
        [
          'Payment Mode Status',
          `Wallet: ${wallet?.publicKey ?? 'not configured'}`,
          `Mode: ${settings.paymentMode}`,
          `Session: ${sessionState}`,
          `Proxy URL: ${proxyBaseUrl}`,
          balances ? `SOL: ${formatNumber(balances.sol, 9)} | SLASHBOT: ${formatNumber(balances.slashbot, 4)}` : 'Balances: unavailable',
          `Credits: ${credits === null ? '(proxy unavailable)' : credits}`,
        ].join('\n') + '\n',
      );
      return 0;
    }

    // ── Default overview ────────────────────────────────────────────

    const wallet = await svc.readWallet();
    if (!wallet) {
      commandContext.stdout.write(
        'No wallet configured.\nUse: solana create <password>\nOr:  solana import <private-key> <password>\n',
      );
      return 0;
    }

    const [balances, credits] = await Promise.all([
      svc.getBalances(wallet.publicKey).catch(() => ({ sol: 0, slashbot: 0 })),
      svc.getCreditBalance(wallet.publicKey),
    ]);

    commandContext.stdout.write(
      [
        'Solana Overview',
        `Address: ${wallet.publicKey}`,
        `SOL: ${formatNumber(balances.sol, 9)}`,
        `SLASHBOT: ${formatNumber(balances.slashbot, 4)}`,
        `Credits: ${credits === null ? '(proxy unavailable)' : credits}`,
        '',
        'Commands:',
        'solana create <password>',
        'solana import <private-key> <password>',
        'solana import seed <password> <seed phrase...> [accountIndex]',
        'solana export <password>',
        'solana export seed <password>',
        'solana balance',
        'solana send <sol|slashbot> <address> <amount|all|max> [password]',
        'solana redeem <amount|all|max> [password]',
        'solana deposit',
        'solana pricing [model|models]',
        'solana mode [apikey|token] [password]',
        'solana usage [stats|history|models]',
        'solana unlock <password>',
        'solana lock',
        'solana status',
      ].join('\n') + '\n',
    );
    return 0;
  };
}
