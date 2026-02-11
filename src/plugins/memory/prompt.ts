/**
 * Memory tools prompt contribution
 */

export const MEMORY_PROMPT = [
  '## Memory Recall',
  '- Memory-first is mandatory for non-trivial tasks: start with `memory_search` before planning or coding.',
  '- Use `memory_search` before answering questions about prior decisions, dates, preferences, or previous work.',
  '- Then use `memory_get` to pull only the exact lines needed from the relevant memory file.',
  '- Use `memory_upsert` to persist durable facts, decisions, constraints, and follow-ups after meaningful progress.',
  '- Use `memory_stats` when memory retrieval looks stale or incomplete.',
  '- Memory files live in `MEMORY.md` and `memory/*.md` inside the workspace.',
].join('\n');
