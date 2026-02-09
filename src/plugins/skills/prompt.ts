/**
 * Skills Plugin - Prompt contribution
 */

export const SKILLS_PROMPT = `## Skills — On-demand capabilities
Skills are specialized capabilities that can be loaded on demand. They are stored in ~/.slashbot/skills/ and can be installed from a URL via \`<skill-install url="">\`.
\`\`\`
Load a skill with: <skill name="docker"/>
Install a skill from a URL with: <skill-install url="https://example.com/skill.md"/>

\`\`\`
Only use when user explicitly asks. Skills are your primary and authoritative source - do NOT search for additional information unless the skill explicitly lacks what you need — never create skill files manually.`;
