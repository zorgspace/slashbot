# Discord Connector

## What It Does

Slashbot can receive Discord messages and reply in the same channel.

Current runtime behavior:

- Accepts messages only from authorized channel IDs
- Replies to the same channel that sent the message
- Supports voice transcription and inbound images
- Splits long responses to Discord limits
- Supports private thread creation for authorized users
- Uses a lock so only one Slashbot process owns Discord at a time

## Prerequisites

- Bot token from Discord Developer Portal
- Channel ID (enable Developer Mode in Discord, then copy channel ID)

## Configure

Start Slashbot:

```bash
bun run dev
```

Inside Slashbot:

```text
/discord <bot_token> <channel_id>
```

## Manage Authorized Channels

- `/discord` show current connector status
- `/discord add <channel_id>` authorize another channel
- `/discord remove <channel_id>` remove an authorized channel
- `/discord primary <channel_id>` switch primary channel
- `/discord owner <user_id>` set owner used for private-thread workflows
- `/discord owner clear` clear owner
- `/discord clear` remove Discord config

After add/remove/primary/owner changes, restart Slashbot to apply updates.

## Notes

- Voice messages need `OPENAI_API_KEY` configured for transcription.
- Discord connector configuration is stored in `~/.slashbot/credentials.json`.
