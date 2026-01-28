# slashbot

CLI assistant powered by Grok API - lightweight Claude Code alternative

## Stack

- TypeScript

## Structure

```
slashbot/
├── .claude/
├── src/
```

## Commands

### Build

```bash
bun run build
```

```bash
bun run dev
```

## Conventions

- Consistent TypeScript usage
- Factorize code
- Minimal token usage in prompts

## Safety
- Don't run destructive commands without user confirmation context
- Avoid force pushes, hard resets, or irreversible operations
- Do not git push directly unless explicitly asked by the user
- Be careful with rm, chmod, chown on system paths

## Notes

- Be consistent, factorize everything and be curious and save tokens

