# feature.wallet

- Plugin ID: `feature.wallet`
- Category: `feature`
- Purpose: Solana wallet flows, token operations, proxy billing/auth support.

## User Commands

- `/solana` with subcommands:
- `create`, `import`, `export`, `balance`, `send`, `redeem`, `deposit`, `pricing`, `mode`, `usage`, `unlock`, `lock`, `status`

## Actions

- `wallet-status`, `wallet-send`

## Tools

- Wallet features are command/action driven (no broad generic tool set exposed here).

## Key Files

- `src/plugins/wallet/index.ts`
- `src/plugins/wallet/commands.ts`
- `src/plugins/wallet/services/index.ts`
- `src/plugins/wallet/provider.ts`
