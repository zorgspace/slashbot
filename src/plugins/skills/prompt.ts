/**
 * Skills Plugin - Prompt contribution
 */

export const SKILLS_PROMPT = [
  '## Skills (mandatory)',
  '- Before replying, scan `<available_skills>` and each `<description>` entry from installed skills context.',
  '- If exactly one skill clearly applies, load it first with `<skill name="..."/>` and follow it.',
  '- If multiple skills could apply, choose the most specific one first and load only that one.',
  '- If none clearly apply, continue without loading a skill.',
  '- Do not load multiple skills up front before selecting.',
  '',
  '## Skills Installation',
  '- Install a skill via `<skill-install url="..."/>`.',
  '- Do not manually create skill files unless the user explicitly asks for manual authoring.',
  '- When a skill exists for the task, treat it as authoritative before external research.',
].join('\n');
