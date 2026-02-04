# Solana Wallet Integration Plan for Grok Payments

## Overview

Integrate Solana wallet functionality into Slashbot to enable users to pay for Grok API usage using $slashbot tokens or SOL. This creates a crypto-native payment system for the CLI tool.

**Token Details:**
- **$slashbot Token Mint**: `AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS`
- **Accepted Currencies**: SOL, $slashbot

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Slashbot CLI                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌──────────────┐   ┌───────────────────┐    │
│  │   Wallet    │   │   Payment    │   │   Grok Client     │    │
│  │   Manager   │   │   Service    │   │   (existing)      │    │
│  │             │◄──┤              │──►│                   │    │
│  │  - Create   │   │  - Check     │   │  - API calls      │    │
│  │  - Import   │   │    credits   │   │  - Token usage    │    │
│  │  - Balance  │   │  - Deduct    │   │                   │    │
│  │  - Export   │   │  - Top-up    │   │                   │    │
│  └─────────────┘   └──────────────┘   └───────────────────┘    │
│         │                 │                                     │
└─────────┼─────────────────┼─────────────────────────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────┐  ┌────────────────────────────────────────────┐
│  ~/.slashbot/   │  │              Solana Network                │
│   wallet.json   │  │  ┌────────────────────────────────────┐   │
│  (encrypted)    │  │  │  Payment Receiver Wallet           │   │
└─────────────────┘  │  │  (Treasury)                        │   │
                     │  └────────────────────────────────────┘   │
                     │  ┌────────────────────────────────────┐   │
                     │  │  $slashbot Token Program           │   │
                     │  │  AtiFyHm...BAGS                    │   │
                     │  └────────────────────────────────────┘   │
                     └────────────────────────────────────────────┘
```

---

## Implementation Steps

### Phase 1: Wallet Infrastructure

#### 1.1 Create Wallet Service (`src/wallet/WalletService.ts`)

**Responsibilities:**
- Generate new Solana keypair
- Import wallet from private key / seed phrase
- Export wallet (encrypted)
- Retrieve wallet public key
- Sign transactions

**Dependencies:**
- `@solana/web3.js` - Solana SDK
- `@solana/spl-token` - SPL token operations
- `bip39` - Mnemonic generation (optional)
- `tweetnacl` - Ed25519 signing (already in @solana/web3.js)

**File Structure:**
```
src/wallet/
├── WalletService.ts      # Main wallet operations
├── encryption.ts         # AES-256-GCM encrypt/decrypt (enhance existing)
├── types.ts              # Wallet interfaces
└── index.ts              # Exports
```

**Key Interfaces:**
```typescript
interface WalletConfig {
  version: number;
  encryptedKey: string;
  iv: string;
  salt: string;
  authTag: string;
  publicKey: string;        // Base58 Solana address
  createdAt: string;
  mnemonic?: string;        // Optional encrypted seed phrase
}

interface WalletService {
  createWallet(password: string): Promise<WalletConfig>;
  importFromPrivateKey(key: string, password: string): Promise<WalletConfig>;
  importFromMnemonic(mnemonic: string, password: string): Promise<WalletConfig>;
  unlockWallet(password: string): Promise<Keypair>;
  getPublicKey(): string;
  signTransaction(tx: Transaction, password: string): Promise<Transaction>;
}
```

#### 1.2 Enhance Existing Wallet Storage

**Current**: `~/.slashbot/wallet.json` (already encrypted)

**Enhanced Structure:**
```json
{
  "version": 2,
  "encryptedSecretKey": "...",
  "iv": "...",
  "salt": "...",
  "authTag": "...",
  "publicKey": "7xKX...abc",
  "createdAt": "2026-02-02T...",
  "network": "mainnet-beta",
  "derivationPath": "m/44'/501'/0'/0'"
}
```

---

### Phase 2: Balance & Token Management

#### 2.1 Create Balance Service (`src/wallet/BalanceService.ts`)

**Responsibilities:**
- Fetch SOL balance
- Fetch $slashbot token balance
- Cache balances (with TTL)
- Format display values

**Key Methods:**
```typescript
interface BalanceService {
  getSOLBalance(): Promise<number>;
  getSlashbotBalance(): Promise<number>;
  getAllBalances(): Promise<{ sol: number; slashbot: number }>;
  refreshBalances(): Promise<void>;
}
```

**Implementation Notes:**
- Use `connection.getBalance()` for SOL
- Use `getTokenAccountsByOwner()` + filter by mint for $slashbot
- Cache for 30 seconds to avoid rate limits
- Display in both raw and formatted amounts

#### 2.2 Token Constants (`src/wallet/constants.ts`)

```typescript
export const SLASHBOT_TOKEN_MINT = 'AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS';
export const TREASURY_WALLET = 'TREASURY_PUBLIC_KEY_HERE'; // Set by admin
export const SOLANA_RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
export const TOKENS_PER_API_CALL = 1000; // $slashbot per 1M Grok tokens (example)
export const SOL_PER_API_CALL = 0.001;   // SOL per 1M Grok tokens (example)
```

---

### Phase 3: Payment Service

#### 3.1 Create Payment Service (`src/wallet/PaymentService.ts`)

**Responsibilities:**
- Check if user has sufficient balance
- Execute payments (SOL or $slashbot)
- Track local credit balance
- Handle payment failures gracefully

**Payment Flow:**
```
1. User sends message
2. PaymentService.checkCredits()
   - If credits > 0: proceed
   - If credits == 0: prompt for top-up
3. GrokClient.streamResponse() executes
4. PaymentService.deductCredits(tokensUsed)
5. If credits < threshold: warn user
```

**Key Methods:**
```typescript
interface PaymentService {
  checkCredits(): Promise<boolean>;
  hasMinimumBalance(): Promise<boolean>;
  topUpCredits(amount: number, currency: 'SOL' | 'SLASHBOT'): Promise<string>; // returns tx sig
  deductCredits(tokensUsed: number): void;
  getCreditsRemaining(): number;
  getPricing(): { solPerToken: number; slashbotPerToken: number };
}
```

#### 3.2 Payment Models

**Option A: Pre-paid Credits (Recommended for MVP)**
```
User deposits → Credits added locally → Deducted per API call
- Simple implementation
- Works offline after deposit
- No smart contract needed
```

**Option B: Per-Request Payments**
```
Each API call → Solana transaction → Then API call
- More complex
- Requires transaction confirmation
- Higher latency (1-2 seconds per tx)
```

**Option C: Subscription (Future)**
```
Monthly payment → Unlimited/quota usage
- Requires backend tracking
- More complex smart contract
```

**Recommended: Option A** with local credit tracking and periodic top-ups.

---

### Phase 4: CLI Commands

#### 4.1 Wallet Commands (`src/commands/handlers/wallet.ts`)

```
/wallet                    - Show wallet overview (address, balances)
/wallet create            - Create new wallet with password
/wallet import            - Import from private key or mnemonic
/wallet export            - Export encrypted backup
/wallet deposit           - Show deposit address & QR code
/wallet balance           - Show SOL and $slashbot balances
/wallet send <to> <amt>   - Send tokens (future)
/wallet topup <amount>    - Convert deposits to API credits
```

**Command Registration:**
```typescript
// src/commands/handlers/wallet.ts
export const walletCommands: CommandHandler[] = [
  {
    name: 'wallet',
    description: 'Manage Solana wallet for API payments',
    execute: async (args, context) => {
      // Subcommand routing
    }
  }
];
```

#### 4.2 Pricing Commands

```
/pricing                  - Show current rates
/usage                    - Show API usage and remaining credits
/credits                  - Show credit balance
```

---

### Phase 5: Integration with GrokClient

#### 5.1 Modify API Call Flow (`src/api/client.ts`)

**Before (current):**
```typescript
async streamResponse(messages: Message[]) {
  // Direct API call
  const response = await fetch(this.apiUrl, { ... });
}
```

**After (with payments):**
```typescript
async streamResponse(messages: Message[]) {
  // Check credits before API call
  const paymentService = getService<PaymentService>(TYPES.PaymentService);

  if (!await paymentService.checkCredits()) {
    throw new InsufficientCreditsError(
      'Insufficient credits. Run /wallet topup to add more.'
    );
  }

  // Execute API call
  const response = await fetch(this.apiUrl, { ... });

  // Deduct credits after successful response
  const tokensUsed = this.usageStats.totalTokens;
  paymentService.deductCredits(tokensUsed);
}
```

#### 5.2 Add Payment Events

```typescript
// src/events/types.ts
export interface PaymentEvents {
  'credits:low': { remaining: number; threshold: number };
  'credits:depleted': {};
  'payment:success': { txSignature: string; amount: number };
  'payment:failed': { error: string };
}
```

---

### Phase 6: UI Components

#### 6.1 Wallet Display (`src/ui/wallet.ts`)

```typescript
export function displayWalletOverview(wallet: WalletInfo): void {
  console.log(chalk.bold('\n💰 Wallet Overview\n'));
  console.log(`Address: ${chalk.cyan(wallet.publicKey)}`);
  console.log(`SOL Balance: ${chalk.yellow(wallet.solBalance.toFixed(4))} SOL`);
  console.log(`$slashbot Balance: ${chalk.green(wallet.slashbotBalance.toLocaleString())} $SLASHBOT`);
  console.log(`API Credits: ${chalk.blue(wallet.credits.toLocaleString())} tokens`);
}

export function displayDepositInstructions(address: string): void {
  console.log(chalk.bold('\n📥 Deposit Instructions\n'));
  console.log('Send SOL or $slashbot tokens to:');
  console.log(chalk.cyan.bold(`\n  ${address}\n`));
  console.log('After deposit confirms, run: /wallet topup');
}
```

#### 6.2 Credit Warning Banner

```typescript
// Show warning when credits are low
if (credits < LOW_CREDIT_THRESHOLD) {
  console.log(chalk.yellow.bold(
    `⚠️  Low credits: ${credits.toLocaleString()} remaining. Run /wallet topup`
  ));
}
```

---

### Phase 7: Security Considerations

#### 7.1 Private Key Protection

- **Never** store unencrypted private keys
- Use AES-256-GCM with user password
- Require password for every transaction signing
- Optional: Session-based unlock (timeout after 5 min)
- Clear memory after use (`sodium_memzero` equivalent)

#### 7.2 Transaction Safety

- Show transaction preview before signing
- Require explicit confirmation for sends
- Maximum transaction limits (configurable)
- Blocklist known scam addresses

#### 7.3 RPC Security

- Use trusted RPC endpoints (Helius, QuickNode, or self-hosted)
- Validate transaction responses
- Handle network errors gracefully

---

### Phase 8: Configuration

#### 8.1 Add to Config (`src/config/config.ts`)

```typescript
interface SlashbotConfig {
  // Existing...

  // New wallet config
  wallet: {
    network: 'mainnet-beta' | 'devnet' | 'testnet';
    rpcEndpoint: string;
    autoTopup: boolean;
    lowCreditWarning: number;
    preferredCurrency: 'SOL' | 'SLASHBOT';
  };

  // Pricing (can be updated remotely)
  pricing: {
    slashbotPerMillionTokens: number;
    solPerMillionTokens: number;
    treasuryAddress: string;
  };
}
```

#### 8.2 Environment Variables

```bash
# .env additions
SOLANA_RPC_ENDPOINT=https://api.mainnet-beta.solana.com
SLASHBOT_TREASURY=<treasury-public-key>
SLASHBOT_TOKEN_MINT=AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS
```

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `src/wallet/WalletService.ts` | Core wallet operations |
| `src/wallet/BalanceService.ts` | Balance fetching & caching |
| `src/wallet/PaymentService.ts` | Credit management & payments |
| `src/wallet/encryption.ts` | Enhanced encryption utilities |
| `src/wallet/constants.ts` | Token addresses, RPC endpoints |
| `src/wallet/types.ts` | TypeScript interfaces |
| `src/wallet/index.ts` | Module exports |
| `src/commands/handlers/wallet.ts` | Wallet CLI commands |
| `src/ui/wallet.ts` | Wallet UI components |

### Modified Files

| File | Changes |
|------|---------|
| `src/api/client.ts` | Add payment checks before/after API calls |
| `src/config/config.ts` | Add wallet & pricing config |
| `src/config/constants.ts` | Add wallet-related constants |
| `src/di/container.ts` | Register wallet services |
| `src/di/types.ts` | Add wallet service types |
| `src/commands/registry.ts` | Register wallet commands |
| `src/events/EventBus.ts` | Add payment events |
| `src/index.ts` | Initialize wallet on startup |
| `package.json` | Add Solana dependencies |

### Dependencies to Add

```json
{
  "dependencies": {
    "@solana/web3.js": "^1.95.0",
    "@solana/spl-token": "^0.4.0",
    "bip39": "^3.1.0",
    "bs58": "^5.0.0"
  }
}
```

---

## Testing Strategy

### Unit Tests

```
src/wallet/__tests__/
├── WalletService.test.ts    # Wallet creation, import, export
├── BalanceService.test.ts   # Balance fetching (mocked RPC)
├── PaymentService.test.ts   # Credit logic, deduction
└── encryption.test.ts       # Encryption/decryption
```

### Integration Tests

- Create wallet → Deposit (devnet) → Top-up → Make API call → Check credits
- Test with both SOL and $slashbot payments
- Test low-credit warnings
- Test insufficient balance handling

### Manual Testing Checklist

- [ ] Create new wallet
- [ ] Import from private key
- [ ] View balances (SOL + $slashbot)
- [ ] Deposit SOL on devnet
- [ ] Deposit $slashbot on devnet
- [ ] Top-up credits
- [ ] Make API call (credits deducted)
- [ ] Low credit warning displays
- [ ] Zero credit blocks API calls
- [ ] Export wallet backup
- [ ] Restore from backup

---

## Migration Path

### For Existing Users

1. Prompt to create/link wallet on first run after update
2. Provide grace period (free credits) during transition
3. Clear documentation in `/help wallet`
4. Migration guide in release notes

### Backwards Compatibility

- If no wallet configured, fall back to existing API key method
- Optional flag: `--no-wallet` to disable payment system
- Environment variable: `SLASHBOT_FREE_MODE=true` for development

---

## Future Enhancements

1. **Subscription Model** - Monthly $slashbot payments for unlimited use
2. **Staking Rewards** - Stake $slashbot for discounted rates
3. **Referral System** - Earn credits for referrals
4. **Multi-wallet Support** - Switch between wallets
5. **Hardware Wallet** - Ledger/Trezor support
6. **On-chain Usage Tracking** - Transparent usage receipts
7. **DAO Governance** - Token holders vote on pricing

---

## Open Questions

1. **Pricing Model**: What's the exchange rate? (X $slashbot per 1M Grok tokens?)
2. **Treasury Management**: Who controls the treasury wallet?
3. **Refunds**: How to handle failed API calls after payment?
4. **Rate Limits**: Any limits beyond credit balance?
5. **Devnet Testing**: Deploy test $slashbot token on devnet?
6. **Oracle**: How to determine SOL↔$slashbot exchange rate?

---

## Summary

This plan introduces a complete Solana-based payment system for Slashbot:

- **Wallet Management**: Create, import, export Solana wallets
- **Multi-currency**: Accept both SOL and $slashbot tokens
- **Credit System**: Pre-paid credits deducted per API call
- **CLI Integration**: New `/wallet` commands
- **Security**: Encrypted key storage, transaction confirmations
- **Extensibility**: Foundation for subscriptions, staking, etc.

The MVP focuses on the credit-based model (Phase 1-6) with security hardened from the start. Future phases can add advanced features like subscriptions and staking.
