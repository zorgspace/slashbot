import { describe, expect, it } from 'vitest';
import { extractAttr, extractBoolAttr } from '../../core/actions/parser';
import { getAgentsParserConfigs } from './parser';

function parseByCanonicalTag(tag: string, content: string) {
  const config = getAgentsParserConfigs().find(entry => entry.tags[0] === tag);
  if (!config) {
    throw new Error(`Parser config not found for ${tag}`);
  }
  return config.parse(content, { extractAttr, extractBoolAttr });
}

describe('agents parser prompt-tag compatibility', () => {
  it('supports agent-create prompt example attributes', () => {
    const actions = parseByCanonicalTag(
      'agent-create',
      '<agent-create name="MyAgent" responsibility="Handle auth" systemPrompt="You are an auth specialist." autoPoll="true"/>',
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'agent-create',
      name: 'MyAgent',
      responsibility: 'Handle auth',
      systemPrompt: 'You are an auth specialist.',
      autoPoll: true,
    });
  });

  it('supports agent-update with systemPrompt alias', () => {
    const actions = parseByCanonicalTag(
      'agent-update',
      '<agent-update agent="MyAgent" systemPrompt="Updated prompt" autoPoll="false"/>',
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'agent-update',
      agent: 'MyAgent',
      systemPrompt: 'Updated prompt',
      autoPoll: false,
    });
  });
});
