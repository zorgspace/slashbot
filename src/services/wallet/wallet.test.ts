/**
 * Wallet Service Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as fs from 'fs';
import * as bip39 from 'bip39';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Helper to get mocked functions
const mockFs = fs as unknown as {
  existsSync: Mock;
  readFileSync: Mock;
  writeFileSync: Mock;
  mkdirSync: Mock;
};

// Mock the solana module to avoid network calls
vi.mock('./solana', () => ({
  generateKeypair: vi.fn(() => Keypair.generate()),
  importKeypair: vi.fn((secretKey: Uint8Array) => Keypair.fromSecretKey(secretKey)),
  getSolBalance: vi.fn(() => Promise.resolve(1.5)),
  getSlashbotBalance: vi.fn(() => Promise.resolve({ raw: BigInt(1000000000), formatted: '1.000000000', decimals: 9 })),
  transferSol: vi.fn(() => Promise.resolve({ success: true, signature: 'mock-sig-123' })),
  transferSlashbot: vi.fn(() => Promise.resolve({ success: true, signature: 'mock-sig-456' })),
  // Use actual PublicKey validation for realistic mock
  isValidAddress: vi.fn((addr: string) => {
    try {
      const { PublicKey } = require('@solana/web3.js');
      new PublicKey(addr);
      return true;
    } catch {
      return false;
    }
  }),
}));

// Import after mocks
import {
  walletExists,
  loadWallet,
  getPublicKey,
  createWallet,
  importWallet,
  importWalletFromSeed,
  isValidSeedPhrase,
  unlockWallet,
  verifyWalletPassword,
  exportPrivateKey,
  exportSeedPhrase,
  hasSeedPhrase,
  getBalances,
  sendSol,
  sendSlashbot,
  unlockSession,
  isSessionActive,
  clearSession,
  getSessionAuthHeaders,
} from './wallet';

describe('wallet', () => {
  const mockWalletData = {
    version: 1,
    encryptedKey: 'mock-encrypted-key',
    iv: 'mock-iv',
    salt: 'mock-salt',
    authTag: 'mock-auth-tag',
    publicKey: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    createdAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('walletExists', () => {
    it('returns true when wallet file exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      expect(walletExists()).toBe(true);
    });

    it('returns false when wallet file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(walletExists()).toBe(false);
    });
  });

  describe('loadWallet', () => {
    it('returns null when wallet file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(loadWallet()).toBeNull();
    });

    it('returns parsed wallet when file exists', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockWalletData));

      const wallet = loadWallet();
      expect(wallet).toEqual(mockWalletData);
    });

    it('returns null on parse error', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      expect(loadWallet()).toBeNull();
    });
  });

  describe('getPublicKey', () => {
    it('returns public key from wallet', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockWalletData));

      expect(getPublicKey()).toBe(mockWalletData.publicKey);
    });

    it('returns null when no wallet', () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(getPublicKey()).toBeNull();
    });
  });

  describe('isValidSeedPhrase', () => {
    it('validates correct 12-word seed phrase', () => {
      const validSeed = bip39.generateMnemonic(128); // 12 words
      expect(isValidSeedPhrase(validSeed)).toBe(true);
    });

    it('validates correct 24-word seed phrase', () => {
      const validSeed = bip39.generateMnemonic(256); // 24 words
      expect(isValidSeedPhrase(validSeed)).toBe(true);
    });

    it('rejects invalid seed phrase', () => {
      expect(isValidSeedPhrase('invalid seed phrase words')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidSeedPhrase('')).toBe(false);
    });
  });

  describe('createWallet', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(false);
    });

    it('creates wallet with valid data', () => {
      const result = createWallet('password123');

      expect(result.publicKey).toBeDefined();
      expect(result.seedPhrase).toBeDefined();
      expect(result.wallet).toBeDefined();
      expect(result.wallet.version).toBe(1);

      // Verify seed phrase is valid
      expect(bip39.validateMnemonic(result.seedPhrase)).toBe(true);
    });

    it('saves wallet to file', () => {
      createWallet('password123');

      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = mockFs.writeFileSync.mock.calls[0];
      expect(writeCall[0]).toContain('wallet.json');
    });

    it('encrypts seed phrase', () => {
      const result = createWallet('password123');

      expect(result.wallet.encryptedSeed).toBeDefined();
      expect(result.wallet.seedIv).toBeDefined();
      expect(result.wallet.seedSalt).toBeDefined();
      expect(result.wallet.seedAuthTag).toBeDefined();
    });
  });

  describe('importWallet', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(false);
    });

    it('imports wallet from valid private key', () => {
      const keypair = Keypair.generate();
      const privateKeyBase58 = bs58.encode(keypair.secretKey);

      const result = importWallet(privateKeyBase58, 'password123');

      expect(result.publicKey).toBe(keypair.publicKey.toBase58());
      expect(result.wallet.version).toBe(1);
    });

    it('saves imported wallet to file', () => {
      const keypair = Keypair.generate();
      const privateKeyBase58 = bs58.encode(keypair.secretKey);

      importWallet(privateKeyBase58, 'password123');

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('imported wallet has no seed phrase', () => {
      const keypair = Keypair.generate();
      const privateKeyBase58 = bs58.encode(keypair.secretKey);

      const result = importWallet(privateKeyBase58, 'password123');

      expect(result.wallet.encryptedSeed).toBeUndefined();
    });
  });

  describe('importWalletFromSeed', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(false);
    });

    it('imports wallet from valid seed phrase', () => {
      const seedPhrase = bip39.generateMnemonic();
      const result = importWalletFromSeed(seedPhrase, 'password123');

      expect(result.publicKey).toBeDefined();
      expect(result.wallet.version).toBe(1);
    });

    it('stores encrypted seed phrase', () => {
      const seedPhrase = bip39.generateMnemonic();
      const result = importWalletFromSeed(seedPhrase, 'password123');

      expect(result.wallet.encryptedSeed).toBeDefined();
    });

    it('normalizes seed phrase (lowercase, trim)', () => {
      const seedPhrase = bip39.generateMnemonic();
      const uppercaseSeed = seedPhrase.toUpperCase() + '  ';

      const result1 = importWalletFromSeed(seedPhrase, 'pass');
      mockFs.existsSync.mockReturnValue(false);
      const result2 = importWalletFromSeed(uppercaseSeed, 'pass');

      expect(result1.publicKey).toBe(result2.publicKey);
    });

    it('throws on invalid seed phrase', () => {
      expect(() => {
        importWalletFromSeed('invalid seed phrase', 'password');
      }).toThrow('Invalid seed phrase');
    });
  });

  describe('hasSeedPhrase', () => {
    it('returns true when seed phrase is stored', () => {
      const walletWithSeed = {
        ...mockWalletData,
        encryptedSeed: 'encrypted',
        seedIv: 'iv',
        seedSalt: 'salt',
        seedAuthTag: 'tag',
      };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(walletWithSeed));

      expect(hasSeedPhrase()).toBe(true);
    });

    it('returns false when no seed phrase', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockWalletData));

      expect(hasSeedPhrase()).toBe(false);
    });
  });

  describe('session management', () => {
    it('isSessionActive returns false initially', () => {
      expect(isSessionActive()).toBe(false);
    });

    it('clearSession clears active session', () => {
      // Can't fully test unlockSession without real encrypted wallet
      // but we can test clearSession
      clearSession();
      expect(isSessionActive()).toBe(false);
    });

    it('getSessionAuthHeaders returns null when no active session', () => {
      const headers = getSessionAuthHeaders();
      expect(headers).toBeNull();
    });
  });

  describe('getBalances', () => {
    it('returns null when no wallet configured', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const balances = await getBalances();
      expect(balances).toBeNull();
    });

    it('returns balances when wallet exists', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockWalletData));

      const balances = await getBalances();

      expect(balances).toEqual({
        sol: 1.5,
        slashbot: 1,
      });
    });
  });

  describe('sendSol', () => {
    it('returns error for invalid address', async () => {
      const result = await sendSol('password', 'invalid', 1.0);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid');
    });
  });

  describe('sendSlashbot', () => {
    it('returns error for invalid address', async () => {
      const result = await sendSlashbot('password', 'invalid', 100);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid');
    });
  });
});
