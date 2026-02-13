import { describe, expect, it } from 'vitest';
import { cleanXmlTags } from './xml';

describe('cleanXmlTags', () => {
  it('unwraps markdown wrapper tags and preserves content', () => {
    const content = '<markdown># Result\n\n- item 1\n- item 2</markdown>';
    expect(cleanXmlTags(content)).toBe('# Result\n\n- item 1\n- item 2');
  });
});
