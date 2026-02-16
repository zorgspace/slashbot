import { describe, expect, test } from 'vitest';
import { PromptAssembler } from '../src/core/kernel/prompt-assembler.js';

describe('PromptAssembler', () => {
  test('includes default core prompt', async () => {
    const assembler = new PromptAssembler();
    const result = await assembler.assemble();
    expect(result).toContain('You are Slashbot, a local-first assistant.');
  });

  test('setCorePrompt overrides default', async () => {
    const assembler = new PromptAssembler();
    assembler.setCorePrompt('Custom core prompt');
    const result = await assembler.assemble();
    expect(result).toContain('Custom core prompt');
    expect(result).not.toContain('You are Slashbot');
  });

  test('registerSection with priority sorting', async () => {
    const assembler = new PromptAssembler();
    assembler.registerSection({ id: 'low', pluginId: 'p', priority: 200, content: 'LOW' });
    assembler.registerSection({ id: 'high', pluginId: 'p', priority: 10, content: 'HIGH' });
    const result = await assembler.assemble();
    expect(result.indexOf('HIGH')).toBeLessThan(result.indexOf('LOW'));
  });

  test('registerContextProvider with async providers', async () => {
    const assembler = new PromptAssembler();
    assembler.registerContextProvider({
      id: 'async',
      pluginId: 'p',
      provide: async () => 'Async context data',
    });
    const result = await assembler.assemble();
    expect(result).toContain('Async context data');
  });

  test('empty sections and contexts are filtered', async () => {
    const assembler = new PromptAssembler();
    assembler.registerSection({ id: 'empty', pluginId: 'p', content: '   ' });
    assembler.registerContextProvider({ id: 'empty-ctx', pluginId: 'p', provide: () => '' });
    assembler.registerSection({ id: 'real', pluginId: 'p', content: 'Real content' });
    const result = await assembler.assemble();
    expect(result).toContain('Real content');
    // Should not have extra blank segments
    expect(result.split('\n\n').filter(s => s.trim() === '')).toHaveLength(0);
  });

  test('parts joined with double newline', async () => {
    const assembler = new PromptAssembler();
    assembler.registerSection({ id: 's1', pluginId: 'p', content: 'Section A' });
    assembler.registerContextProvider({ id: 'c1', pluginId: 'p', provide: () => 'Context B' });
    const result = await assembler.assemble();
    expect(result).toContain('Section A\n\nContext B');
  });

  test('no sections or providers: just core prompt', async () => {
    const assembler = new PromptAssembler();
    const result = await assembler.assemble();
    expect(result).toContain('Slashbot');
    expect(result.split('\n\n').filter(s => s.trim()).length).toBe(1);
  });

  test('same priority: alphabetical by id', async () => {
    const assembler = new PromptAssembler();
    assembler.registerSection({ id: 'beta', pluginId: 'p', priority: 50, content: 'BETA' });
    assembler.registerSection({ id: 'alpha', pluginId: 'p', priority: 50, content: 'ALPHA' });
    const result = await assembler.assemble();
    expect(result.indexOf('ALPHA')).toBeLessThan(result.indexOf('BETA'));
  });

  test('context provider returning empty string is filtered', async () => {
    const assembler = new PromptAssembler();
    assembler.registerContextProvider({ id: 'empty', pluginId: 'p', provide: () => '' });
    assembler.registerContextProvider({ id: 'real', pluginId: 'p', provide: () => 'Real' });
    const result = await assembler.assemble();
    expect(result).toContain('Real');
  });

  test('multiple context providers all included', async () => {
    const assembler = new PromptAssembler();
    assembler.registerContextProvider({ id: 'a', pluginId: 'p', provide: () => 'CTX_A' });
    assembler.registerContextProvider({ id: 'b', pluginId: 'p', provide: () => 'CTX_B' });
    const result = await assembler.assemble();
    expect(result).toContain('CTX_A');
    expect(result).toContain('CTX_B');
  });

  test('setCorePrompt to empty string works', async () => {
    const assembler = new PromptAssembler();
    assembler.setCorePrompt('');
    assembler.registerSection({ id: 's', pluginId: 'p', content: 'Section' });
    const result = await assembler.assemble();
    expect(result).toContain('Section');
  });

  test('many sections all included', async () => {
    const assembler = new PromptAssembler();
    for (let i = 0; i < 10; i++) {
      assembler.registerSection({ id: `s${i}`, pluginId: 'p', content: `SEC${i}` });
    }
    const result = await assembler.assemble();
    for (let i = 0; i < 10; i++) {
      expect(result).toContain(`SEC${i}`);
    }
  });
});
