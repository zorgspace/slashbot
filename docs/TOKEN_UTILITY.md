# $SLASHBOT Token Utility

## Overview

$SLASHBOT is an SPL token on Solana that lets users pay for Grok API calls through Slashbot without managing API keys directly. Instead of signing up for X.AI and handling billing yourself, you hold $SLASHBOT tokens and the proxy billing system handles the rest.

---

## Token Details

| Property         | Value                                          |
| ---------------- | ---------------------------------------------- |
| **Name**         | SLASHBOT                                       |
| **Chain**        | Solana                                         |
| **Standard**     | SPL Token                                      |
| **Decimals**     | 9                                              |
| **Mint Address** | `AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS` |
| **Treasury**     | `DVGjCZVJ3jMw8gsHAQjuYFMj8xQJyVf17qKrciYCS9u7` |

---

## How It Works

### Payment Modes

Slashbot supports two payment modes:

| Mode        | Command        | How it works                                                |
| ----------- | -------------- | ----------------------------------------------------------- |
| **API Key** | `/mode apikey` | You provide your own X.AI API key. You pay X.AI directly.   |
| **Token**   | `/mode token`  | You pay with $SLASHBOT tokens via the proxy billing system. |

### Token Mode Flow

```
1. User holds $SLASHBOT tokens in their Slashbot wallet
2. User redeems tokens for credits (/redeem)
   → Tokens sent to treasury address
   → Credits added to user's account on the proxy
3. User sends a message to the AI
   → ProxyAuthProvider signs the request with session keypair
   → Request routes through proxy (getslashbot.com)
   → Proxy forwards to X.AI API, deducts credits
   → Response streamed back with billing info
4. User sees cost per request in real-time
```

### Proxy Billing System

The proxy sits between Slashbot and the X.AI API:

```
Slashbot CLI  →  Proxy (getslashbot.com)  →  X.AI API
              ←  Response + billing info   ←
```

**Why a proxy?**

- Users don't need to create an X.AI account or manage API keys
- One-click setup: create wallet, buy tokens, start using
- Usage metering and credit management handled server-side
- Session-based auth: wallet signs each request, no API keys transmitted

---

## Pricing

### Model Rates

Pricing is based on X.AI's official rates. The proxy adds a markup to cover infrastructure and treasury costs.

| Model                         | Input (per 1M tokens) | Output (per 1M tokens) |
| ----------------------------- | --------------------- | ---------------------- |
| `grok-4-1-fast-reasoning`     | $0.20                 | $0.50                  |
| `grok-4-1-fast-non-reasoning` | $0.20                 | $0.50                  |
| `grok-code-fast-1`            | $0.20                 | $1.50                  |

### Real-Time Conversion

Costs are calculated in USD, then converted to SOL and $SLASHBOT using real-time exchange rates:

```
USD cost = (input_tokens / 1M) * input_price + (output_tokens / 1M) * output_price
SOL cost = USD cost / SOL_USD_price
SLASHBOT cost = SOL cost / SLASHBOT_SOL_price
```

Exchange rate sources (with fallback chain):

1. **SOL/USD** — CoinGecko API (fallback: $150)
2. **SLASHBOT/SOL** — Jupiter quote API → DexScreener → Birdeye → hardcoded fallback

Rates are cached for 60 seconds to minimize API calls.

### Viewing Pricing

```
/pricing          # Show current model rates and exchange rates
/usage            # Show your token usage statistics
/balance          # Check wallet balance (SOL + $SLASHBOT)
```

---

## Wallet Management

Slashbot includes a built-in Solana wallet for managing $SLASHBOT tokens.

### Setup

```
/wallet create    # Generate a new wallet (shows seed phrase — save it!)
/wallet import    # Import an existing wallet from seed phrase or private key
```

### Daily Use

```
/wallet status    # Show wallet address, balances, session status
/wallet balance   # Quick balance check (SOL + $SLASHBOT)
/wallet unlock    # Authenticate wallet session (required before sending)
/wallet send      # Send SOL or $SLASHBOT to another address
/redeem           # Convert $SLASHBOT tokens to proxy credits
```

### Security

| Feature             | Implementation                                |
| ------------------- | --------------------------------------------- |
| **Encryption**      | AES-256-GCM with password-derived key         |
| **Key storage**     | Encrypted in `~/.slashbot/wallet.json`        |
| **Session auth**    | Keypair signs each API request body           |
| **Session timeout** | 30-minute inactivity timeout                  |
| **Seed backup**     | Encrypted seed phrase stored alongside key    |
| **Password policy** | Never stored, never logged, never transmitted |

### Wallet Architecture

```
~/.slashbot/
├── wallet.json          # Encrypted private key + seed phrase
└── wallet-config.json   # Proxy URL + public wallet address
```

The wallet is password-protected. On startup in token mode, Slashbot prompts for the password. The decrypted keypair is held in memory for the session duration and used to sign proxy requests.

---

## Credit System

### How Credits Work

1. **Deposit** — User sends $SLASHBOT tokens to the treasury address via `/redeem`
2. **Credit** — The proxy verifies the on-chain transaction and credits the user's account
3. **Spend** — Each API call deducts credits based on token usage and current exchange rates
4. **Check** — `/balance` and `/usage` show remaining credits and spending history

### Balance Checks

Before each API call in token mode, the `ProxyAuthProvider` validates:

1. Wallet exists and is configured
2. Proxy is reachable
3. User has sufficient $SLASHBOT balance or credits
4. If no credits remain, it suggests running `/redeem`

---

## Acquiring $SLASHBOT

### Where to Buy

$SLASHBOT is a standard SPL token tradable on Solana DEXes:

- **Jupiter** — Swap any Solana token for $SLASHBOT
- **Raydium** — If a liquidity pool exists
- **Any Solana DEX** — Using the mint address

### Mint Address

```
AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS
```

### Quick Start

```bash
# 1. Start slashbot
slashbot

# 2. Create a wallet
/wallet create

# 3. Fund your wallet with SOL (for gas) and $SLASHBOT
#    Send tokens to the wallet address shown by /wallet status

# 4. Switch to token mode
/mode token

# 5. Redeem tokens for credits
/redeem 1000

# 6. Start using Slashbot
> explain this codebase
```

---

## Technical Reference

### Key Components

| Component         | Location                                        | Purpose                       |
| ----------------- | ----------------------------------------------- | ----------------------------- |
| WalletPlugin      | `src/plugins/wallet/index.ts`                   | Plugin entry point            |
| ProxyAuthProvider | `src/plugins/wallet/provider.ts`                | Routes requests through proxy |
| PricingService    | `src/plugins/wallet/services/pricingService.ts` | Cost calculation              |
| ExchangeRates     | `src/plugins/wallet/services/exchangeRates.ts`  | Real-time price feeds         |
| xaiPricing        | `src/plugins/wallet/services/xaiPricing.ts`     | Model pricing table           |
| WalletService     | `src/plugins/wallet/services/wallet.ts`         | Wallet lifecycle              |
| SolanaService     | `src/plugins/wallet/services/solana.ts`         | On-chain operations           |
| CryptoService     | `src/plugins/wallet/services/crypto.ts`         | AES-256-GCM encryption        |

### Configuration

Proxy settings are loaded from `~/.slashbot/wallet-config.json`:

```json
{
  "walletAddress": "YOUR_PUBLIC_KEY",
  "proxyUrl": "https://getslashbot.com",
  "configuredAt": "2026-01-15T10:30:00Z"
}
```

Constants in `src/core/config/constants.ts`:

```typescript
PROXY_CONFIG = {
  BASE_URL: 'https://getslashbot.com',
  GROK_ENDPOINT: '/api/grok',
  CREDITS_ENDPOINT: '/api/credits',
  TREASURY_ADDRESS: 'DVGjCZVJ3jMw8gsHAQjuYFMj8xQJyVf17qKrciYCS9u7',
  TOKEN_MINT: 'AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS',
};
```

---

_See also: [ARCHITECTURE.md](./ARCHITECTURE.md) | [ROADMAP.md](./ROADMAP.md)_
