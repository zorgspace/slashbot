/**
 * Wallet Crypto Utilities Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
  encryptPrivateKey,
  decryptPrivateKey,
  verifyPassword,
  deriveKey,
  hashData,
  createSignatureMessage,
  signMessage,
  verifySignature,
} from './crypto';
import { Keypair } from '@solana/web3.js';

describe('crypto', () => {
  describe('deriveKey', () => {
    it('derives consistent key from same password and salt', () => {
      const salt = Buffer.from('testsalt12345678901234567890ab', 'utf-8');
      const key1 = deriveKey('password123', salt);
      const key2 = deriveKey('password123', salt);
      expect(key1.toString('hex')).toBe(key2.toString('hex'));
    });

    it('derives different keys for different passwords', () => {
      const salt = Buffer.from('testsalt12345678901234567890ab', 'utf-8');
      const key1 = deriveKey('password123', salt);
      const key2 = deriveKey('password456', salt);
      expect(key1.toString('hex')).not.toBe(key2.toString('hex'));
    });

    it('derives different keys for different salts', () => {
      const salt1 = Buffer.from('salt1234567890123456789012ab', 'utf-8');
      const salt2 = Buffer.from('salt0987654321098765432109ab', 'utf-8');
      const key1 = deriveKey('password123', salt1);
      const key2 = deriveKey('password123', salt2);
      expect(key1.toString('hex')).not.toBe(key2.toString('hex'));
    });

    it('returns 32-byte key', () => {
      const salt = Buffer.from('testsalt12345678901234567890ab', 'utf-8');
      const key = deriveKey('password', salt);
      expect(key.length).toBe(32);
    });
  });

  describe('encryptPrivateKey / decryptPrivateKey', () => {
    it('encrypts and decrypts private key correctly', () => {
      const privateKey = new Uint8Array(64);
      for (let i = 0; i < 64; i++) privateKey[i] = i;
      const password = 'strongpassword123';

      const encrypted = encryptPrivateKey(privateKey, password);
      const decrypted = decryptPrivateKey(
        encrypted.encryptedKey,
        encrypted.iv,
        encrypted.salt,
        encrypted.authTag,
        password
      );

      expect(decrypted).toEqual(privateKey);
    });

    it('returns different ciphertext for same data (random IV/salt)', () => {
      const privateKey = new Uint8Array(64).fill(42);
      const password = 'password123';

      const encrypted1 = encryptPrivateKey(privateKey, password);
      const encrypted2 = encryptPrivateKey(privateKey, password);

      expect(encrypted1.encryptedKey).not.toBe(encrypted2.encryptedKey);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.salt).not.toBe(encrypted2.salt);
    });

    it('fails decryption with wrong password', () => {
      const privateKey = new Uint8Array(64).fill(123);
      const encrypted = encryptPrivateKey(privateKey, 'correctpassword');

      expect(() => {
        decryptPrivateKey(
          encrypted.encryptedKey,
          encrypted.iv,
          encrypted.salt,
          encrypted.authTag,
          'wrongpassword'
        );
      }).toThrow();
    });

    it('fails decryption with tampered ciphertext', () => {
      const privateKey = new Uint8Array(64).fill(99);
      const encrypted = encryptPrivateKey(privateKey, 'password123');

      // Tamper with the ciphertext
      const tamperedKey = encrypted.encryptedKey.slice(0, -4) + 'XXXX';

      expect(() => {
        decryptPrivateKey(
          tamperedKey,
          encrypted.iv,
          encrypted.salt,
          encrypted.authTag,
          'password123'
        );
      }).toThrow();
    });

    it('fails decryption with tampered auth tag', () => {
      const privateKey = new Uint8Array(64).fill(77);
      const encrypted = encryptPrivateKey(privateKey, 'password123');

      // Tamper with auth tag
      const tamperedTag = encrypted.authTag.slice(0, -4) + 'ZZZZ';

      expect(() => {
        decryptPrivateKey(
          encrypted.encryptedKey,
          encrypted.iv,
          encrypted.salt,
          tamperedTag,
          'password123'
        );
      }).toThrow();
    });

    it('handles empty password', () => {
      const privateKey = new Uint8Array(32).fill(55);
      const encrypted = encryptPrivateKey(privateKey, '');
      const decrypted = decryptPrivateKey(
        encrypted.encryptedKey,
        encrypted.iv,
        encrypted.salt,
        encrypted.authTag,
        ''
      );
      expect(decrypted).toEqual(privateKey);
    });

    it('handles long password', () => {
      const privateKey = new Uint8Array(64).fill(88);
      const longPassword = 'a'.repeat(1000);
      const encrypted = encryptPrivateKey(privateKey, longPassword);
      const decrypted = decryptPrivateKey(
        encrypted.encryptedKey,
        encrypted.iv,
        encrypted.salt,
        encrypted.authTag,
        longPassword
      );
      expect(decrypted).toEqual(privateKey);
    });

    it('handles unicode password', () => {
      const privateKey = new Uint8Array(64).fill(11);
      const unicodePassword = '密码🔐パスワード';
      const encrypted = encryptPrivateKey(privateKey, unicodePassword);
      const decrypted = decryptPrivateKey(
        encrypted.encryptedKey,
        encrypted.iv,
        encrypted.salt,
        encrypted.authTag,
        unicodePassword
      );
      expect(decrypted).toEqual(privateKey);
    });
  });

  describe('verifyPassword', () => {
    it('returns true for correct password', () => {
      const privateKey = new Uint8Array(64).fill(33);
      const password = 'correct123';
      const encrypted = encryptPrivateKey(privateKey, password);

      const valid = verifyPassword(
        encrypted.encryptedKey,
        encrypted.iv,
        encrypted.salt,
        encrypted.authTag,
        password
      );

      expect(valid).toBe(true);
    });

    it('returns false for wrong password', () => {
      const privateKey = new Uint8Array(64).fill(44);
      const encrypted = encryptPrivateKey(privateKey, 'correctpassword');

      const valid = verifyPassword(
        encrypted.encryptedKey,
        encrypted.iv,
        encrypted.salt,
        encrypted.authTag,
        'wrongpassword'
      );

      expect(valid).toBe(false);
    });

    it('returns false for corrupted data', () => {
      const privateKey = new Uint8Array(64).fill(55);
      const encrypted = encryptPrivateKey(privateKey, 'password');

      const valid = verifyPassword(
        'corrupteddata',
        encrypted.iv,
        encrypted.salt,
        encrypted.authTag,
        'password'
      );

      expect(valid).toBe(false);
    });
  });

  describe('hashData', () => {
    it('returns consistent hash for same input', () => {
      const hash1 = hashData('test data');
      const hash2 = hashData('test data');
      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different input', () => {
      const hash1 = hashData('data1');
      const hash2 = hashData('data2');
      expect(hash1).not.toBe(hash2);
    });

    it('returns 64-character hex string (SHA256)', () => {
      const hash = hashData('any input');
      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });

    it('handles empty string', () => {
      const hash = hashData('');
      expect(hash.length).toBe(64);
    });

    it('handles unicode input', () => {
      const hash = hashData('🔐日本語テスト');
      expect(hash.length).toBe(64);
    });
  });

  describe('createSignatureMessage', () => {
    it('creates message with wallet address and timestamp', () => {
      const walletAddress = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
      const { message, timestamp } = createSignatureMessage(walletAddress);

      expect(message).toBe(`slashbot:${walletAddress}:${timestamp}`);
      expect(timestamp).toBeGreaterThan(0);
      expect(timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('creates message with body hash when provided', () => {
      const walletAddress = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
      const bodyHash = 'abc123def456';
      const { message, timestamp, bodyHash: returnedHash } = createSignatureMessage(walletAddress, bodyHash);

      expect(message).toBe(`slashbot:${walletAddress}:${timestamp}:${bodyHash}`);
      expect(returnedHash).toBe(bodyHash);
    });

    it('timestamps are sequential', () => {
      const walletAddress = 'test';
      const { timestamp: t1 } = createSignatureMessage(walletAddress);
      const { timestamp: t2 } = createSignatureMessage(walletAddress);

      expect(t2).toBeGreaterThanOrEqual(t1);
    });
  });

  describe('signMessage', () => {
    it('produces non-empty signature', () => {
      const keypair = Keypair.generate();
      const message = 'Test message to sign';

      const signature = signMessage(message, keypair.secretKey);

      expect(signature).toBeDefined();
      expect(signature.length).toBeGreaterThan(0);
    });

    it('signature is base64 encoded', () => {
      const keypair = Keypair.generate();
      const signature = signMessage('test', keypair.secretKey);

      // Base64 should only contain valid chars
      expect(/^[A-Za-z0-9+/]+=*$/.test(signature)).toBe(true);
    });

    it('produces consistent signature for same message and keypair', () => {
      const keypair = Keypair.generate();
      const message = 'consistent message';

      const signature1 = signMessage(message, keypair.secretKey);
      const signature2 = signMessage(message, keypair.secretKey);

      // Ed25519 is deterministic
      expect(signature1).toBe(signature2);
    });

    it('produces different signature for different messages', () => {
      const keypair = Keypair.generate();

      const signature1 = signMessage('message 1', keypair.secretKey);
      const signature2 = signMessage('message 2', keypair.secretKey);

      expect(signature1).not.toBe(signature2);
    });

    it('produces different signature for different keypairs', () => {
      const keypair1 = Keypair.generate();
      const keypair2 = Keypair.generate();
      const message = 'same message';

      const signature1 = signMessage(message, keypair1.secretKey);
      const signature2 = signMessage(message, keypair2.secretKey);

      expect(signature1).not.toBe(signature2);
    });

    it('handles unicode messages', () => {
      const keypair = Keypair.generate();
      const message = '日本語メッセージ🔐';

      const signature = signMessage(message, keypair.secretKey);

      expect(signature).toBeDefined();
      expect(signature.length).toBeGreaterThan(0);
    });

    it('handles empty message', () => {
      const keypair = Keypair.generate();
      const message = '';

      const signature = signMessage(message, keypair.secretKey);

      expect(signature).toBeDefined();
      expect(signature.length).toBeGreaterThan(0);
    });

    it('handles long message', () => {
      const keypair = Keypair.generate();
      const message = 'x'.repeat(10000);

      const signature = signMessage(message, keypair.secretKey);

      expect(signature).toBeDefined();
      expect(signature.length).toBeGreaterThan(0);
    });
  });

  describe('verifySignature', () => {
    it('returns false for tampered signature', () => {
      const keypair = Keypair.generate();
      const message = 'test message';

      const signature = signMessage(message, keypair.secretKey);
      const tamperedSignature = signature.slice(0, -4) + 'AAAA';

      const isValid = verifySignature(message, tamperedSignature, keypair.publicKey.toBase58());

      expect(isValid).toBe(false);
    });

    it('returns false for invalid signature format', () => {
      const keypair = Keypair.generate();
      const isValid = verifySignature('message', 'not-valid-base64!!!', keypair.publicKey.toBase58());
      expect(isValid).toBe(false);
    });

    it('returns false for invalid public key', () => {
      const keypair = Keypair.generate();
      const signature = signMessage('message', keypair.secretKey);

      const isValid = verifySignature('message', signature, 'invalid-public-key');
      expect(isValid).toBe(false);
    });
  });
});
