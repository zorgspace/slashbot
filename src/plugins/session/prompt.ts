/**
 * Session tools prompt contribution
 */

export const SESSION_TOOLS_PROMPT = [
  '## Session Orchestration',
  '- Use `sessions_list` to discover active sessions and their activity.',
  '- Use `sessions_history` to inspect context from another session before coordinating.',
  '- Use `sessions_send` to send work or follow-up messages across sessions.',
  '- Use `sessions_usage` to inspect per-session token/request counters.',
  '- Use `sessions_compaction` to inspect context compaction health (condense/prune/summary).',
  '- Prefer `run=false` when queuing work; use `run=true` only when immediate execution is needed.',
  '- Session history may contain a compaction divider when old context was summarized; treat it as preserved context, not missing data.',
].join('\n');
