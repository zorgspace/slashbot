import type { RunRecord } from './types.js';

const MAX_CONCURRENT_DEFAULT = 8;
const MAX_DEPTH_DEFAULT = 2;
const ARCHIVE_AFTER_MS = 60 * 60 * 1000; // 1 hour

export class RunRegistry {
  private runs = new Map<string, RunRecord>();
  maxConcurrent = MAX_CONCURRENT_DEFAULT;
  maxDepth = MAX_DEPTH_DEFAULT;

  create(record: RunRecord): void {
    this.runs.set(record.runId, record);
  }

  get(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  /** Find a run by runId prefix, label, or numeric 1-based index of active runs. */
  resolve(target: string): RunRecord | undefined {
    // Exact runId
    const exact = this.runs.get(target);
    if (exact) return exact;

    // Numeric index (1-based) into active runs
    const idx = parseInt(target, 10);
    if (!isNaN(idx) && idx >= 1) {
      const active = this.active();
      if (idx <= active.length) return active[idx - 1];
    }

    // "last" keyword
    if (target === 'last') {
      const active = this.active();
      return active.length > 0 ? active[active.length - 1] : undefined;
    }

    // Label match
    const all = Array.from(this.runs.values());
    for (const r of all) {
      if (r.label === target) return r;
    }

    // RunId prefix match
    for (const r of all) {
      if (r.runId.startsWith(target)) return r;
    }

    // Label prefix match
    for (const r of all) {
      if (r.label.startsWith(target)) return r;
    }

    return undefined;
  }

  active(): RunRecord[] {
    return Array.from(this.runs.values()).filter((r) => r.status === 'pending' || r.status === 'running');
  }

  recent(limit = 20): RunRecord[] {
    return Array.from(this.runs.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  activeCount(): number {
    return this.active().length;
  }

  /** Sweep completed runs older than the archive threshold. */
  sweep(): number {
    const cutoff = Date.now() - ARCHIVE_AFTER_MS;
    let swept = 0;
    for (const [id, r] of Array.from(this.runs.entries())) {
      if ((r.status === 'completed' || r.status === 'error' || r.status === 'killed') && r.createdAt < cutoff) {
        this.runs.delete(id);
        swept++;
      }
    }
    return swept;
  }
}
