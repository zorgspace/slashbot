/**
 * Wallet Encryption Utilities
 * AES-256-GCM encryption with PBKDF2 key derivation
 */

import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

/**
 * Derive encryption key from password using PBKDF2
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt private key with password
 */
export function encryptPrivateKey(
  privateKey: Uint8Array,
  password: string,
): {
  encryptedKey: string;
  iv: string;
  salt: string;
  authTag: string;
} {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(privateKey)), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedKey: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypt private key with password
 */
export function decryptPrivateKey(
  encryptedKey: string,
  iv: string,
  salt: string,
  authTag: string,
  password: string,
): Uint8Array {
  const saltBuffer = Buffer.from(salt, 'base64');
  const ivBuffer = Buffer.from(iv, 'base64');
  const authTagBuffer = Buffer.from(authTag, 'base64');
  const encryptedBuffer = Buffer.from(encryptedKey, 'base64');

  const key = deriveKey(password, saltBuffer);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuffer);
  decipher.setAuthTag(authTagBuffer);

  const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);

  return new Uint8Array(decrypted);
}

/**
 * Verify password by attempting decryption
 */
export function verifyPassword(
  encryptedKey: string,
  iv: string,
  salt: string,
  authTag: string,
  password: string,
): boolean {
  try {
    decryptPrivateKey(encryptedKey, iv, salt, authTag, password);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compute SHA256 hash of data
 */
export function hashData(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Create a timestamp-based message for signing
 * Format: "slashbot:{wallet}:{timestamp}" or "slashbot:{wallet}:{timestamp}:{bodyHash}"
 */
export function createSignatureMessage(
  walletAddress: string,
  bodyHash?: string,
): { message: string; timestamp: number; bodyHash?: string } {
  const timestamp = Date.now();
  const message = bodyHash
    ? `slashbot:${walletAddress}:${timestamp}:${bodyHash}`
    : `slashbot:${walletAddress}:${timestamp}`;
  return { message, timestamp, bodyHash };
}

/**
 * Sign a message with ed25519 keypair
 */
export function signMessage(message: string, secretKey: Uint8Array): string {
  // Use Node's crypto for ed25519 signing
  const messageBytes = Buffer.from(message, 'utf-8');
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'), // ed25519 private key prefix
      Buffer.from(secretKey.slice(0, 32)), // First 32 bytes are the private key
    ]),
    format: 'der',
    type: 'pkcs8',
  });

  const signature = crypto.sign(null, messageBytes, privateKey);
  return signature.toString('base64');
}

/**
 * Verify a signed message with ed25519 public key
 */
export function verifySignature(
  message: string,
  signature: string,
  publicKeyBase58: string,
): boolean {
  try {
    const messageBytes = Buffer.from(message, 'utf-8');
    const signatureBytes = Buffer.from(signature, 'base64');

    // Import bs58 dynamically to decode public key
    const bs58 = require('bs58');
    const publicKeyBytes = bs58.decode(publicKeyBase58);

    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'), // ed25519 public key prefix
        Buffer.from(publicKeyBytes),
      ]),
      format: 'der',
      type: 'spki',
    });

    return crypto.verify(null, messageBytes, publicKey, signatureBytes);
  } catch {
    return false;
  }
}
