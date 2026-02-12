# connector.telegram

- Plugin ID: `connector.telegram`
- Category: `connector`
- Purpose: Telegram bot connector with multi-chat authorization and response gating.

## User Commands

- `/telegram <bot_token> [chat_id]`
- `/telegram add <chat_id>`
- `/telegram remove <chat_id>`
- `/telegram primary <chat_id>`
- `/telegram gate <open|command>`
- `/telegram trigger /command`
- `/telegram clear`

## Actions

- `telegram-config`, `telegram-status`, `telegram-add`, `telegram-remove`, `telegram-primary`, `telegram-clear`, `telegram-send`

## Tools

- `telegram_status`, `telegram_add_chat`, `telegram_remove_chat`, `telegram_primary_chat`, `telegram_clear`, `telegram_send`

## Key Files

- `src/connectors/telegram/plugin.ts`
- `src/connectors/telegram/commands.ts`
- `src/connectors/telegram/connector.ts`
