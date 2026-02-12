import { describe, expect, it } from 'vitest';
import { buildContinuationActionOutput, summarizeToolResultForHistory } from './historyPolicy';
import type { ActionResult } from '../actions/types';

describe('historyPolicy', () => {
  it('summarizes explore tool output aggressively for history', () => {
    const payload = Array.from({ length: 30 }, (_, i) => `src/file-${i}.ts`).join('\n');
    const summary = summarizeToolResultForHistory('glob', payload);
    expect(summary).toContain('src/file-0.ts');
    expect(summary).toContain('[18 more lines]');
    expect(summary.length).toBeLessThan(payload.length);
  });

  it('caps continuation payload and preserves failed actions', () => {
    const results: ActionResult[] = Array.from({ length: 14 }, (_, i) => ({
      action: i === 2 ? 'Edit: src/app.ts' : `Read: src/file-${i}.ts`,
      success: i === 2 ? false : true,
      result: `result-${i}\n${'x'.repeat(800)}`,
      error: i === 2 ? 'no match' : undefined,
    }));

    const output = buildContinuationActionOutput(results);
    expect(output).toContain('Edit: src/app.ts');
    expect(output).toContain('older action result(s) omitted');
    expect(output.length).toBeLessThan(16_000);
  });
});
