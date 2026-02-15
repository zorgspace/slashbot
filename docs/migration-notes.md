# Migration Notes

## From slashclaw naming

- Canonical plugin type is now `SlashbotPlugin`.
- Backward compatibility alias remains available as `SlashClawPlugin`.

## Config migration

- Use `~/.slashbot/config.json` as global config.
- Workspace config lives at `<workspace>/.slashbot/config.json`.

## Plugin migration

- Ensure each plugin has `manifest.json` with `id`, `name`, `version`, `main`.
- Unknown ids in `allow`/`deny`/`entries` now fail fast.
