# Telegram Connector

## What It Does

Slashbot can receive Telegram messages and reply in the same chat.

Current runtime behavior:

- Accepts messages only from authorized chat IDs
- Replies to the same chat that sent the message
- Supports voice transcription and inbound images
- Splits long responses to Telegram limits
- Uses a lock so only one Slashbot process owns Telegram at a time

## Prerequisites

- Telegram bot token from `@BotFather`
- A target chat ID (optional if auto-detected)

## Configure

Start Slashbot:

```bash
bun run dev
```

Inside Slashbot:

```text
/telegram <bot_token> <chat_id>
```

Or auto-detect chat ID:

```text
/telegram <bot_token>
```

Auto-detect requires that you send at least one message to the bot first.

## Manage Authorized Chats

- `/telegram` show current connector status
- `/telegram add <chat_id>` authorize another chat
- `/telegram remove <chat_id>` remove an authorized chat
- `/telegram primary <chat_id>` switch primary chat
- `/telegram clear` remove Telegram config

After add/remove/primary changes, restart Slashbot to apply updates.

## Notes

- Voice messages need `OPENAI_API_KEY` configured for transcription.
- Telegram connector configuration is stored in `~/.slashbot/credentials.json`.
