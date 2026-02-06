/**
 * Solana Operations Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js';

// Import the actual module - this file tests the real implementation
import {
  generateKeypair,
  importKeypair,
  isValidAddress,
} from './solana';

describe('solana', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateKeypair', () => {
    it('generates valid Solana keypair', () => {
      const keypair = generateKeypair();

      expect(keypair).toBeInstanceOf(Keypair);
      expect(keypair.publicKey).toBeDefined();
      expect(keypair.secretKey).toBeDefined();
      expect(keypair.secretKey.length).toBe(64);
    });

    it('generates unique keypairs', () => {
      const keypair1 = generateKeypair();
      const keypair2 = generateKeypair();

      expect(keypair1.publicKey.toBase58()).not.toBe(keypair2.publicKey.toBase58());
    });

    it('generates keypairs with valid public keys', () => {
      const keypair = generateKeypair();
      const publicKeyBase58 = keypair.publicKey.toBase58();

      // Valid base58 Solana address should be 32-44 chars
      expect(publicKeyBase58.length).toBeGreaterThanOrEqual(32);
      expect(publicKeyBase58.length).toBeLessThanOrEqual(44);
    });
  });

  describe('importKeypair', () => {
    it('imports keypair from secret key', () => {
      const original = Keypair.generate();
      const imported = importKeypair(original.secretKey);

      expect(imported.publicKey.toBase58()).toBe(original.publicKey.toBase58());
    });

    it('preserves secret key after import', () => {
      const original = Keypair.generate();
      const imported = importKeypair(original.secretKey);

      expect(imported.secretKey).toEqual(original.secretKey);
    });

    it('throws on invalid secret key length', () => {
      expect(() => {
        importKeypair(new Uint8Array(32)); // Should be 64 bytes
      }).toThrow();
    });
  });

  describe('isValidAddress', () => {
    it('returns true for valid Solana address', () => {
      const keypair = Keypair.generate();
      expect(isValidAddress(keypair.publicKey.toBase58())).toBe(true);
    });

    it('returns true for known valid system program address', () => {
      expect(isValidAddress(SystemProgram.programId.toBase58())).toBe(true);
    });

    it('returns true for known token program address', () => {
      expect(isValidAddress('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')).toBe(true);
    });

    it('returns false for invalid address', () => {
      expect(isValidAddress('invalid')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isValidAddress('')).toBe(false);
    });

    it('returns false for address with invalid base58 characters', () => {
      // Base58 excludes 0, O, I, l
      expect(isValidAddress('0OIl1111111111111111111111111111')).toBe(false);
    });

    it('returns false for too short address', () => {
      expect(isValidAddress('ABC123')).toBe(false);
    });

    it('handles addresses of varying valid lengths', () => {
      // Generate several keypairs and verify their addresses
      for (let i = 0; i < 10; i++) {
        const keypair = Keypair.generate();
        expect(isValidAddress(keypair.publicKey.toBase58())).toBe(true);
      }
    });
  });
});

describe('solana types', () => {
  it('exports correct token mint', async () => {
    const { SLASHBOT_TOKEN_MINT } = await import('./types');
    expect(SLASHBOT_TOKEN_MINT).toBe('AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS');
  });

  it('exports correct treasury address', async () => {
    const { TREASURY_ADDRESS } = await import('./types');
    expect(TREASURY_ADDRESS).toBe('DVGjCZVJ3jMw8gsHAQjuYFMj8xQJyVf17qKrciYCS9u7');
  });

  it('exports correct token decimals', async () => {
    const { TOKEN_DECIMALS } = await import('./types');
    expect(TOKEN_DECIMALS).toBe(9);
  });

  it('exports correct default RPC URL', async () => {
    const { DEFAULT_RPC_URL } = await import('./types');
    expect(DEFAULT_RPC_URL).toBe('https://api.mainnet-beta.solana.com');
  });
});

describe('solana address formats', () => {
  it('treasury address is valid', () => {
    expect(isValidAddress('DVGjCZVJ3jMw8gsHAQjuYFMj8xQJyVf17qKrciYCS9u7')).toBe(true);
  });

  it('token mint address is valid', () => {
    expect(isValidAddress('AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS')).toBe(true);
  });
});
