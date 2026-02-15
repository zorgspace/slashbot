/**
 * wallet/crypto.ts — Pure cryptographic utilities for wallet encryption/decryption.
 *
 * Exports: deriveKey, encryptBytes, decryptBytes, decryptLegacySecret, encodeBase58, decodeBase58.
 */
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, scryptSync } from 'node:crypto';

/**
 * Derive a 256-bit AES key from a password and salt using PBKDF2-SHA256.
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
}

/**
 * Encrypt arbitrary bytes with AES-256-GCM using a password.
 * Returns base64-encoded ciphertext, IV, salt, and auth tag.
 */
export function encryptBytes(password: string, plaintext: Uint8Array): { encryptedKey: string; iv: string; salt: string; authTag: string } {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedKey: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypt AES-256-GCM encrypted bytes using a password and base64-encoded parameters.
 */
export function decryptBytes(password: string, encryptedKey: string, iv: string, salt: string, authTag: string): Uint8Array {
  const key = deriveKey(password, Buffer.from(salt, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedKey, 'base64')),
    decipher.final(),
  ]);
  return new Uint8Array(decrypted);
}

/**
 * Decrypt a legacy AES-256-CBC encrypted secret (hex-encoded) from older wallet format.
 */
export function decryptLegacySecret(encryptedHex: string, password: string, saltHex: string, ivHex: string): string {
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Encode bytes to base58 using the bs58 library (dynamic import).
 */
export async function encodeBase58(bytes: Uint8Array): Promise<string> {
  const mod = await import('bs58');
  const bs58 = (mod as { default?: { encode: (value: Uint8Array) => string } }).default ?? (mod as unknown as { encode: (value: Uint8Array) => string });
  return bs58.encode(bytes);
}

/**
 * Decode a base58 string to bytes using the bs58 library (dynamic import).
 */
export async function decodeBase58(value: string): Promise<Uint8Array> {
  const mod = await import('bs58');
  const bs58 = (mod as { default?: { decode: (input: string) => Uint8Array } }).default ?? (mod as unknown as { decode: (input: string) => Uint8Array });
  return bs58.decode(value);
}
