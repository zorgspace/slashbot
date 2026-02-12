/**
 * Grok API Utilities
 */

import type { ActionResult } from '../actions/types';
import { buildContinuationActionOutput } from './historyPolicy';

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

export function compressActionResults(
  results: Array<{ action?: string; result: string; success?: boolean; error?: string }>,
): string {
  return buildContinuationActionOutput(results as ActionResult[]);
}

/**
 * Generate compact environment information string
 */
export function getEnvironmentInfo(workDir: string): string {
  const fs = require('fs');
  const path = require('path');

  const cwd = workDir || process.cwd();
  const isGitRepo = fs.existsSync(path.join(cwd, '.git'));
  const today = new Date().toISOString().split('T')[0];
  return `\n<env>cwd=${cwd} git=${isGitRepo ? 'yes' : 'no'} platform=${process.platform} date=${today}</env>`;
}
