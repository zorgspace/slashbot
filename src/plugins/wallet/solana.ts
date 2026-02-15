/**
 * wallet/solana.ts — Solana RPC operations: connections, balances, transfers, address validation.
 *
 * Exports functions and constants for interacting with the Solana blockchain.
 * Functions accept explicit parameters rather than relying on closure state.
 */

export const DEFAULT_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
export const SLASHBOT_TOKEN_MINT = 'AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS';
export const TREASURY_ADDRESS = 'DVGjCZVJ3jMw8gsHAQjuYFMj8xQJyVf17qKrciYCS9u7';
export const TOKEN_DECIMALS = 9;

export type TokenType = 'sol' | 'slashbot';

export interface WalletBalances {
  sol: number;
  slashbot: number;
}

/**
 * Create a Solana RPC connection.
 * Uses SOLANA_RPC_URL env var or falls back to the provided/default RPC URL.
 */
export async function getConnection(rpcUrl: string = DEFAULT_SOLANA_RPC_URL) {
  const { Connection } = await import('@solana/web3.js');
  const resolvedUrl = process.env.SOLANA_RPC_URL ?? rpcUrl;
  return new Connection(resolvedUrl, 'confirmed');
}

/**
 * Get SOL balance for a public key (in SOL, not lamports).
 */
export async function getSolBalance(publicKeyB58: string, rpcUrl?: string): Promise<number> {
  const { PublicKey } = await import('@solana/web3.js');
  const connection = await getConnection(rpcUrl);
  const lamports = await connection.getBalance(new PublicKey(publicKeyB58));
  return lamports / 1e9;
}

/**
 * Get SLASHBOT token balance for a public key.
 */
export async function getSlashbotBalance(publicKeyB58: string, rpcUrl?: string, tokenMint: string = SLASHBOT_TOKEN_MINT): Promise<number> {
  const { PublicKey, Keypair } = await import('@solana/web3.js');
  const spl = await import('@solana/spl-token') as unknown as {
    Token: {
      getAssociatedTokenAddress: (...args: unknown[]) => Promise<unknown>;
      new(connection: unknown, mint: unknown, programId: unknown, payer: unknown): {
        getAccountInfo: (address: unknown) => Promise<{ amount: bigint | string | number }>;
      };
    };
    ASSOCIATED_TOKEN_PROGRAM_ID: unknown;
    TOKEN_PROGRAM_ID: unknown;
  };

  const connection = await getConnection(rpcUrl);
  const owner = new PublicKey(publicKeyB58);
  const mint = new PublicKey(tokenMint);

  try {
    const ata = await spl.Token.getAssociatedTokenAddress(
      spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      spl.TOKEN_PROGRAM_ID,
      mint,
      owner,
    );
    const tokenClient = new spl.Token(connection, mint, spl.TOKEN_PROGRAM_ID, Keypair.generate());
    const account = await tokenClient.getAccountInfo(ata);
    const raw = typeof account.amount === 'bigint' ? Number(account.amount) : Number(String(account.amount));
    return raw / 10 ** TOKEN_DECIMALS;
  } catch {
    return 0;
  }
}

/**
 * Get both SOL and SLASHBOT balances for a public key.
 */
export async function getBalances(publicKeyB58: string, rpcUrl?: string): Promise<WalletBalances> {
  const [sol, slashbot] = await Promise.all([
    getSolBalance(publicKeyB58, rpcUrl),
    getSlashbotBalance(publicKeyB58, rpcUrl),
  ]);
  return { sol, slashbot };
}

/**
 * Estimate the fee for a SOL transfer transaction.
 */
export async function estimateSolTransferFee(fromAddress: string, toAddress: string, rpcUrl?: string): Promise<number> {
  const { PublicKey, SystemProgram, Transaction } = await import('@solana/web3.js');
  const connection = await getConnection(rpcUrl);

  const fromPubkey = new PublicKey(fromAddress);
  const toPubkey = new PublicKey(toAddress);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports: 1,
    }),
  );

  const latest = await connection.getLatestBlockhash();
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = fromPubkey;

  const fee = await connection.getFeeForMessage(tx.compileMessage());
  const lamports = typeof fee.value === 'number' ? fee.value : 5_000;
  return lamports / 1e9;
}

/**
 * Get the maximum amount of SOL that can be sent (balance minus estimated fee).
 */
export async function getMaxSendableSol(fromAddress: string, toAddress: string, rpcUrl?: string): Promise<number> {
  const [balance, fee] = await Promise.all([
    getSolBalance(fromAddress, rpcUrl),
    estimateSolTransferFee(fromAddress, toAddress, rpcUrl),
  ]);
  const max = balance - fee;
  return max > 0 ? max : 0;
}

/**
 * Send SOL to a destination address. Returns the transaction signature.
 */
export async function sendSol(
  toAddress: string,
  amount: number,
  signingSecretKey: Uint8Array,
  rpcUrl?: string,
): Promise<string> {
  const { PublicKey, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');
  const connection = await getConnection(rpcUrl);
  const from = Keypair.fromSecretKey(signingSecretKey);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: new PublicKey(toAddress),
      lamports: Math.floor(amount * 1e9),
    }),
  );

  return sendAndConfirmTransaction(connection, tx, [from]);
}

/**
 * Send SLASHBOT tokens to a destination address. Returns the transaction signature.
 */
export async function sendSlashbot(
  toAddress: string,
  amount: number,
  signingSecretKey: Uint8Array,
  rpcUrl?: string,
  tokenMint: string = SLASHBOT_TOKEN_MINT,
): Promise<string> {
  const { PublicKey, Keypair, Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');
  const spl = await import('@solana/spl-token') as unknown as {
    Token: {
      getAssociatedTokenAddress: (...args: unknown[]) => Promise<unknown>;
      createAssociatedTokenAccountInstruction: (...args: unknown[]) => unknown;
      createTransferInstruction: (...args: unknown[]) => unknown;
      new(connection: unknown, mint: unknown, programId: unknown, payer: unknown): {
        getAccountInfo: (address: unknown) => Promise<{ amount: bigint | string | number }>;
      };
    };
    ASSOCIATED_TOKEN_PROGRAM_ID: unknown;
    TOKEN_PROGRAM_ID: unknown;
  };

  const connection = await getConnection(rpcUrl);
  const sender = Keypair.fromSecretKey(signingSecretKey);
  const mint = new PublicKey(tokenMint);
  const recipient = new PublicKey(toAddress);

  const sourceAta = await spl.Token.getAssociatedTokenAddress(
    spl.ASSOCIATED_TOKEN_PROGRAM_ID,
    spl.TOKEN_PROGRAM_ID,
    mint,
    sender.publicKey,
  );

  const tokenClient = new spl.Token(connection, mint, spl.TOKEN_PROGRAM_ID, sender);
  const sourceAccount = await tokenClient.getAccountInfo(sourceAta);
  const sourceRaw = typeof sourceAccount.amount === 'bigint' ? Number(sourceAccount.amount) : Number(String(sourceAccount.amount));
  const neededRaw = Math.floor(amount * 10 ** TOKEN_DECIMALS);

  if (sourceRaw < neededRaw) {
    throw new Error(`insufficient SLASHBOT balance: ${sourceRaw / 10 ** TOKEN_DECIMALS} available`);
  }

  const destAta = await spl.Token.getAssociatedTokenAddress(
    spl.ASSOCIATED_TOKEN_PROGRAM_ID,
    spl.TOKEN_PROGRAM_ID,
    mint,
    recipient,
  );

  const tx = new Transaction();

  try {
    await tokenClient.getAccountInfo(destAta);
  } catch {
    tx.add(
      spl.Token.createAssociatedTokenAccountInstruction(
        spl.ASSOCIATED_TOKEN_PROGRAM_ID,
        spl.TOKEN_PROGRAM_ID,
        mint,
        destAta,
        recipient,
        sender.publicKey,
      ) as never,
    );
  }

  tx.add(
    spl.Token.createTransferInstruction(
      spl.TOKEN_PROGRAM_ID,
      sourceAta,
      destAta,
      sender.publicKey,
      [],
      neededRaw,
    ) as never,
  );

  return sendAndConfirmTransaction(connection, tx, [sender]);
}

/**
 * Resolve the actual transfer amount from user input (handles "all"/"max").
 */
export async function resolveTransferAmount(
  token: TokenType,
  fromAddress: string,
  toAddress: string,
  amountArg: string,
  parseAmountArgFn: (raw: string | undefined) => { all: boolean; value: number },
  rpcUrl?: string,
): Promise<number> {
  const parsed = parseAmountArgFn(amountArg);
  if (!parsed.all) return parsed.value;

  if (token === 'sol') {
    return getMaxSendableSol(fromAddress, toAddress, rpcUrl);
  }

  return getSlashbotBalance(fromAddress, rpcUrl);
}

/**
 * Send either SOL or SLASHBOT tokens, resolving amount from user input.
 * Returns the transaction signature and the resolved amount.
 */
export async function sendToken(
  token: TokenType,
  toAddress: string,
  amountArg: string,
  walletPublicKey: string,
  signingSecretKey: Uint8Array,
  parseAmountArgFn: (raw: string | undefined) => { all: boolean; value: number },
  rpcUrl?: string,
): Promise<{ signature: string; amount: number }> {
  if (!(await isValidAddress(toAddress))) {
    throw new Error('invalid destination address');
  }

  const amount = await resolveTransferAmount(token, walletPublicKey, toAddress, amountArg, parseAmountArgFn, rpcUrl);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('insufficient balance to send requested amount');
  }

  const signature = token === 'sol'
    ? await sendSol(toAddress, amount, signingSecretKey, rpcUrl)
    : await sendSlashbot(toAddress, amount, signingSecretKey, rpcUrl);

  return { signature, amount };
}

/**
 * Validate a Solana address (public key).
 */
export async function isValidAddress(address: string): Promise<boolean> {
  try {
    const { PublicKey } = await import('@solana/web3.js');
    // eslint-disable-next-line no-new
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}
