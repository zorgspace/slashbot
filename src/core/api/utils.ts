/**
 * Grok API Utilities
 */

/**
 * Simple LRU cache with max entries - evicts oldest on overflow
 */
export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    // Move to end (most recently used)
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    // If key exists, delete first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }

  *[Symbol.iterator](): IterableIterator<[K, V]> {
    yield* this.cache;
  }
}

/**
 * Format action results for LLM context
 * No truncation - send full results to the LLM
 * Clearly labeled to distinguish from user input
 */
export function compressActionResults(
  results: Array<{ action?: string; result: string; success?: boolean; error?: string }>,
): string {
  const formattedResults = results
    .map(r => {
      const action = r.action ?? '';
      const success = r.success ?? false;
      const status = success ? '✓' : '✗';
      const errorNote = r.error ? ` (${r.error})` : '';
      return `[${status}] ${action}${errorNote}\n${r.result}`;
    })
    .join('\n\n');

  return `<action-output>\n${formattedResults}\n</action-output>`;
}

/**
 * Generate environment information string
 */
export function getEnvironmentInfo(workDir: string): string {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');

  const cwd = workDir || process.cwd();
  const isGitRepo = fs.existsSync(path.join(cwd, '.git'));
  const platform = process.platform;
  const osVersion = `${os.type()} ${os.release()}`;
  const today = new Date().toISOString().split('T')[0];

  return `
<env>
Working directory: ${cwd}
Is directory a git repo: ${isGitRepo ? 'Yes' : 'No'}
Platform: ${platform}
OS Version: ${osVersion}
Today's date: ${today}
</env>`;
}
