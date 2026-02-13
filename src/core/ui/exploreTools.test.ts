import { describe, expect, it } from 'vitest';

import { isExploreToolName } from './exploreTools';

describe('isExploreToolName', () => {
  it('matches common read/search/list explore tools', () => {
    const positives = [
      'read_file',
      'Read',
      'LS',
      'glob',
      'grep',
      'find_files',
      'search code',
      'list directories',
      'tree',
      'cat',
    ];

    for (const value of positives) {
      expect(isExploreToolName(value), `expected ${value} to be explore`).toBe(true);
    }
  });

  it('ignores non-explore tools', () => {
    const negatives = ['git_status', 'todo_read', 'memory_search', 'bash', 'say_message'];
    for (const value of negatives) {
      expect(isExploreToolName(value), `expected ${value} to not be explore`).toBe(false);
    }
  });
});
