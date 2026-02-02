# Slashbot

Autonomous AI Agent for Development, Automation & More

Slashbot is an ultra-powerful autonomous AI agent capable of executing shell commands, reading/editing files, managing Git securely, installing extensible skills, planning tasks, sending notifications, and more. It self-improves and works independently in your dev environment.

**Powerful, safe, and extensible** – built for pro developers and AI agents.

## 🎯 Key Features

- **File ops**: `<read>`, `<edit>`, `<write>`, `<glob>`, `<grep>`, `<ls>`
- **Code**: `<format>`, `<typecheck>`, auto-error fixing
- **Secure Git**: status, add, commit (no force-push or destructive resets)
- **Web**: `<fetch>`, `<search>` for research & APIs
- **Skills**: Specialized capabilities (e.g., Docker, Bags/Solana, Telegram) via `<skill>`
- **Task mgmt**: `<plan>` for multi-step tracking, `<task>` subtasks, `<schedule>` cron jobs
- **Notifications**: `<notify>`, Telegram/Discord integration
- **Autonomy**: Installs missing tools, fixes errors, persists context in `.slashbot/context/`
- **Security**: Defensive only, no malicious code, protected credentials

## 📋 Prerequisites

- Linux/macOS/Windows (WSL recommended)
- Bun **or** Node.js ≥20
- Git
- LLM API key (e.g., OpenAI, Grok, Claude – see config)

## 🚀 Quick Installation

```bash
# Clone (if from GitHub)
git clone https://github.com/your-user/slashbot.git
cd slashbot

# or from local source

# Install deps (Bun recommended for speed)
bun install
# Alt: npm install

# Automated scripts:
./scripts/install.sh  # Full setup
./scripts/build.sh    # Prod build
```

## 🏃‍♂️ Running

### Dev mode (hot-reload)

```bash
bun run dev
```

### Production

```bash
bun run build
bun dist/index.js  # or node dist/index.js
```

Slashbot starts in interactive mode (stdin) or configure Telegram/Discord for chat.

## ⚙️ Configuration

1. **Core files** (auto-created if missing):
   - `.slashbot/config/config.json`: General settings
   - `.slashbot/credentials.json`: API keys
     ```json
     {
       "openai": { "apiKey": "sk-..." }
     }
     ```

2. **Messaging connectors** (in Slashbot chat):

   ```
   <telegram-config bot_token="123:ABC..."/>  <!-- Create bot via @BotFather -->
   <discord-config bot_token="MTk..." channel_id="123456"/>
   ```

   **Restart Slashbot** after config.

3. **Permissions**: Edit `.slashbot/permissions.json` if needed.

## 💡 Usage

Slashbot understands English/French. Examples:

```
Fix the bug in src/login.ts
Create a plan to implement OAuth auth
<bash>ls src/</bash>
<edit path="src/utils.ts"><search>old</search><replace>new</replace></edit>
<plan operation="add" content="Step 1"/>
Search "best TypeScript practices 2024"
```

- **Multi-step**: Use `<plan>` for visual progress.
- **Skills**:
  ```
  <skill name="docker"/>  # Load Docker tools
  <skill-install url="https://ex.com/skill.md"/>  # New skill
  ```
- **Persistent context**: Saved in `.slashbot/context/topic/`.

### Advanced Examples

- **Automation**: `<schedule cron="0 9 * * *" name="backup">git add . && git commit -m 'Daily'</schedule>`
- **Notify**: `<notify>Task done!</notify>`

## 🛠️ Development & Contributing

```
bun vitest          # Tests
bun run format      # Format code
<typecheck/>        # TS check (in Slashbot)
```

- **Conventions**: Strict TS, no unnecessary comments, precise edits.
- **Git**: Always `git status` before commit.
- Contribute via PR. No secrets in repo.

## 📁 Project Structure

```
slashbot/
├── src/                 # Core logic (updater.ts, editor.ts, etc.)
├── scripts/             # install.sh, build.sh, deploy.sh
├── .slashbot/           # Config, context, skills, credentials (gitignore)
├── package.json
├── vitest.config.ts
└── README.md
```

## 🔒 Security & Limits

- **Defensive only**: Security analysis OK, no malware.
- **Git safe**: No --force, status checks.
- **Credentials**: Backup before changes, test before overwrite.
- **Forbidden**: rm sys dirs, destructive git.

## 📚 More Info

- [Installed Skills](.slashbot/skills/): Bags (Solana), Telegram, etc.
- Saved Context: `.slashbot/context/` (itineraries, research).
- Logs: `.slashbot/history`.

## License

MIT – Fork, improve, deploy!

---

_Slashbot: Your AI agent that codes for you. 🚀_
