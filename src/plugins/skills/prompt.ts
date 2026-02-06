/**
 * Skills Plugin - Prompt contribution
 */

export const SKILLS_PROMPT = `\`\`\`
<skill name="docker"/>
<skill-install url="https://example.com/skill.md"/>
\`\`\`
IMPORTANT:
- ONLY use skills when user EXPLICITLY asks for a skill
- Skills MUST be installed via <skill-install url="..."/> from a URL
- NEVER manually create skill files`;