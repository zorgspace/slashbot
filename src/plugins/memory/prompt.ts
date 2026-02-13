/**
 * Memory tools prompt contribution
 */

export const MEMORY_PROMPT = [
  '## Memory Recall',
  '- Before answering anything about prior work, decisions, dates, people, preferences, or todos: run `memory_search` first.',
  '- After search, use `memory_get` to pull only the needed lines from the selected memory file.',
  '- If confidence remains low after search, state that memory was checked and what is missing.',
  '- Use `memory_upsert` to persist durable facts, decisions, constraints, and follow-ups after meaningful progress.',
  '- Use `memory_stats` when memory retrieval looks stale or incomplete.',
  '- Memory files live in `MEMORY.md` and `memory/*.md` inside the workspace.',
].join('\n');
