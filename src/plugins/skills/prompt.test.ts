import { describe, expect, it } from 'vitest';
import { SKILLS_PROMPT } from './prompt';

describe('SKILLS_PROMPT policy', () => {
  it('enforces mandatory skill selection workflow', () => {
    expect(SKILLS_PROMPT).toContain('## Skills (mandatory)');
    expect(SKILLS_PROMPT).toContain('<available_skills>');
    expect(SKILLS_PROMPT).toContain('<skill name="..."/>');
    expect(SKILLS_PROMPT).toContain('Do not load multiple skills up front');
  });
});
