# Adding Telegram Notifications to Slashbot

Slashbot supports Telegram notifications via the `telegraf` library and `TELEGRAM_BOT_TOKEN` env var. Use in-app `/notify` command or action syntax.

## Prerequisites

- Bun/Node.js installed
- Slashbot running (`bun run src/index.ts`)

## Step 1: Create Telegram Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram.
2. Send `/newbot`.
3. Choose name (e.g., Slashbot Notifier) and username (e.g., slashbot_notifier_bot).
4. Copy the **API token** (e.g., `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`).

## Step 2: Configure Environment

Add to `.env` (create if missing, copy from `.env.example`):

```
TELEGRAM_BOT_TOKEN=your_token_here
```

Reload Slashbot or restart.

## Step 3: Get Your Chat ID

1. Start a chat with your bot (search username, send `/start`).
2. Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Find `"chat":{"id":123456789` – note the ID (integer).

## Step 4: Configure Notifications

In Slashbot CLI:

```
/notify telegram 123456789
```

(Replace `123456789` with your chat ID. Use `/notify help` for options.)

## Step 5: Test

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
