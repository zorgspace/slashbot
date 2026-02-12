# feature.skills

- Plugin ID: `feature.skills`
- Category: `feature`
- Purpose: install/load reusable skills and inject installed skill context into prompts.

## User Commands

- `/skill` (alias `/skills`)
- `list`, `install`, `remove`, `info`, `dir`

## Actions

- `skill`, `skill-install`

## Tools

- No dedicated AI SDK tools (action + command driven).

## Key Files

- `src/plugins/skills/index.ts`
- `src/plugins/skills/commands.ts`
- `src/plugins/skills/services/SkillManager.ts`
