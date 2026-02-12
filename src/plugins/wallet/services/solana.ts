/**
 * Solana Blockchain Operations
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  Token,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  SLASHBOT_TOKEN_MINT,
  TOKEN_DECIMALS,
  DEFAULT_RPC_URL,
  type TokenBalance,
  type TransactionResult,
} from './types';

const DUMMY_TOKEN_SIGNER = Keypair.generate();

function createTokenClient(connection: Connection, mint: PublicKey): Token {
  return new Token(connection, mint, TOKEN_PROGRAM_ID, DUMMY_TOKEN_SIGNER);
}

async function fetchTokenAccountInfo(
  connection: Connection,
  mint: PublicKey,
  account: PublicKey,
): Promise<Awaited<ReturnType<Token['getAccountInfo']>>> {
  const token = createTokenClient(connection, mint);
  return await token.getAccountInfo(account);
}

let connection: Connection | null = null;

/**
 * Get Solana connection (singleton)
 */
export function getConnection(rpcUrl?: string): Connection {
  if (!connection) {
    connection = new Connection(rpcUrl || DEFAULT_RPC_URL, 'confirmed');
  }
  return connection;
}

/**
 * Generate a new Solana keypair
 */
export function generateKeypair(): Keypair {
  return Keypair.generate();
}

/**
 * Import keypair from secret key bytes
 */
export function importKeypair(secretKey: Uint8Array): Keypair {
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Validate Solana address
 */
export function isValidAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get SOL balance
 */
export async function getSolBalance(publicKey: PublicKey): Promise<number> {
  const conn = getConnection();
  const balance = await conn.getBalance(publicKey);
  return balance / LAMPORTS_PER_SOL;
}

/**
 * Get SLASHBOT token balance
 */
export async function getSlashbotBalance(publicKey: PublicKey): Promise<TokenBalance> {
  const conn = getConnection();
  const mintPubkey = new PublicKey(SLASHBOT_TOKEN_MINT);

  try {
    const tokenAccount = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mintPubkey,
      publicKey,
    );
    const accountInfo = await fetchTokenAccountInfo(conn, mintPubkey, tokenAccount);

    const raw = BigInt(accountInfo.amount.toString());
    const formatted = (Number(raw) / Math.pow(10, TOKEN_DECIMALS)).toFixed(TOKEN_DECIMALS);

    return { raw, formatted, decimals: TOKEN_DECIMALS };
  } catch {
    // Token account doesn't exist = 0 balance
    return { raw: BigInt(0), formatted: '0', decimals: TOKEN_DECIMALS };
  }
}

/**
 * Estimate transaction fee for a SOL transfer
 */
export async function estimateSolTransferFee(
  fromPubkey: PublicKey,
  toAddress: string,
): Promise<number> {
  const conn = getConnection();
  const toPubkey = new PublicKey(toAddress);

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports: 1, // Dummy amount for fee estimation
    }),
  );

  const { blockhash } = await conn.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromPubkey;

  const fee = await conn.getFeeForMessage(transaction.compileMessage());
  // Return fee in SOL, default to 5000 lamports if estimation fails
  return (fee.value || 5000) / LAMPORTS_PER_SOL;
}

/**
 * Get maximum sendable SOL (balance minus estimated fee)
 */
export async function getMaxSendableSol(publicKey: PublicKey, toAddress: string): Promise<number> {
  const [balance, fee] = await Promise.all([
    getSolBalance(publicKey),
    estimateSolTransferFee(publicKey, toAddress),
  ]);

  const maxAmount = balance - fee;
  // Return 0 if balance doesn't cover fees
  return maxAmount > 0 ? maxAmount : 0;
}

/**
 * Transfer SOL
 */
export async function transferSol(
  fromKeypair: Keypair,
  toAddress: string,
  amount: number,
): Promise<TransactionResult> {
  try {
    const conn = getConnection();
    const toPubkey = new PublicKey(toAddress);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey,
        lamports: Math.floor(amount * LAMPORTS_PER_SOL),
      }),
    );

    const signature = await sendAndConfirmTransaction(conn, transaction, [fromKeypair]);

    return { success: true, signature };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Transfer failed',
    };
  }
}

/**
 * Transfer SLASHBOT tokens
 */
export async function transferSlashbot(
  fromKeypair: Keypair,
  toAddress: string,
  amount: number,
): Promise<TransactionResult> {
  try {
    const conn = getConnection();
    const mintPubkey = new PublicKey(SLASHBOT_TOKEN_MINT);
    const toPubkey = new PublicKey(toAddress);

    // Get source token account
    const sourceTokenAccount = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mintPubkey,
      fromKeypair.publicKey,
    );

    // Check if source account exists and has sufficient balance
    try {
      const sourceAccount = await fetchTokenAccountInfo(conn, mintPubkey, sourceTokenAccount);
      const balance = Number(sourceAccount.amount) / Math.pow(10, TOKEN_DECIMALS);
      if (balance < amount) {
        return {
          success: false,
          error: `Insufficient SLASHBOT balance: ${balance.toFixed(4)} available, ${amount} needed`,
        };
      }
    } catch {
      return {
        success: false,
        error: 'No SLASHBOT tokens in wallet. You need to acquire SLASHBOT tokens first.',
      };
    }

    // Get or create destination token account
    const destTokenAccount = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mintPubkey,
      toPubkey,
    );

    const transaction = new Transaction();

    // Check if destination token account exists
      try {
        await fetchTokenAccountInfo(conn, mintPubkey, destTokenAccount);
      } catch {
      // Create associated token account for recipient
      transaction.add(
        Token.createAssociatedTokenAccountInstruction(
          ASSOCIATED_TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          mintPubkey,
          destTokenAccount,
          toPubkey,
          fromKeypair.publicKey,
        ),
      );
    }

    // Add transfer instruction
    const amountInBaseUnits = BigInt(Math.floor(amount * Math.pow(10, TOKEN_DECIMALS)));
    transaction.add(
      Token.createTransferInstruction(
        TOKEN_PROGRAM_ID,
        sourceTokenAccount,
        destTokenAccount,
        fromKeypair.publicKey,
        [],        Number(amountInBaseUnits),
      ),
    );

    const signature = await sendAndConfirmTransaction(conn, transaction, [fromKeypair]);

    return { success: true, signature };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Transfer failed',
    };
  }
}

/**
 * Get recent blockhash for transaction
 */
export async function getRecentBlockhash(): Promise<string> {
  const conn = getConnection();
  const { blockhash } = await conn.getLatestBlockhash();
  return blockhash;
}

/**
 * Confirm transaction
 */
export async function confirmTransaction(signature: string): Promise<boolean> {
  const conn = getConnection();
  try {
    const result = await conn.confirmTransaction(signature, 'confirmed');
    return !result.value.err;
  } catch {
    return false;
  }
}
