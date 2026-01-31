# Adding Telegram Notifications to Slashbot

Slashbot supports Telegram notifications via the `telegraf` library. You can configure it using natural language prompts.

## Prerequisites

- Bun/Node.js installed
- Slashbot running (`bun run src/index.ts`)

## Step 1: Create Telegram Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram.
2. Send `/newbot`.
3. Choose name (e.g., Slashbot Notifier) and username (e.g., slashbot_notifier_bot).
4. Copy the **API token** (e.g., `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`).

## Step 2: Get Your Chat ID

1. Start a chat with your bot (search username, send `/start`).
2. Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Find `"chat":{"id":123456789` – note the ID (integer).

## Step 3: Configure Telegram

In Slashbot CLI, use a natural language prompt:

```
slashbot > Connect Telegram bot with token 123456:ABC-xyz on chat 987654321
```

Slashbot will configure the bot token and chat ID for you.

## Step 4: Test

Send a notification:

```
[[notify service="telegram"]]Hello from Slashbot![[/notify]]
```

## Usage Examples

- **Direct:** `[[notify service="telegram"]]Build failed![[/notify]]`
- **Scheduled:** `[[schedule cron="0 */6 * * *" name="health" notify="telegram"]]echo 'Health check'[[/schedule]]`
- **All services:** `[[notify service="all"]]Update ready[[/notify]]`

## Troubleshooting

- No token? Run `/login` for Grok API first (needed for actions).
- Permission error? Ensure bot has sendMessage rights.
- Check logs: Notifications in `src/notify/`.
- WhatsApp: Similar, use `WHATSAPP_ACCESS_TOKEN`.

See `src/notify/` for code, `.env.example` for vars.
