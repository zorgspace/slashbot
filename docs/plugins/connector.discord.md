# connector.discord

- Plugin ID: `connector.discord`
- Category: `connector`
- Purpose: Discord bot connector (inbound/outbound messaging, channel authorization, thread-aware status).

## User Commands

- `/discord <bot_token> <channel_id>`
- `/discord add <channel_id>`
- `/discord remove <channel_id>`
- `/discord primary <channel_id>`
- `/discord owner <user_id>`
- `/discord owner clear`
- `/discord clear`

## Actions

- `discord-config`, `discord-status`, `discord-add`, `discord-remove`, `discord-primary`, `discord-owner`, `discord-owner-clear`, `discord-clear`, `discord-send`

## Tools

- `discord_status`, `discord_add_channel`, `discord_remove_channel`, `discord_primary_channel`, `discord_owner_set`, `discord_owner_clear`, `discord_clear`, `discord_send`

## Key Files

- `src/connectors/discord/plugin.ts`
- `src/connectors/discord/commands.ts`
- `src/connectors/discord/connector.ts`
