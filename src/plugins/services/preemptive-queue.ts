/**
 * PreemptiveQueue — per-context sequential job processing with preemption.
 *
 * When a new job is enqueued for a context that already has a running job,
 * the current job is aborted, any stale queued jobs are dropped, and the
 * new job becomes the next one processed.
 *
 * Jobs receive an `AbortSignal` so they can detect preemption and skip
 * sending responses for aborted work.
 */
export type QueueJob = (signal: AbortSignal) => Promise<void>;

export class PreemptiveQueue {
  private readonly pending = new Map<string, QueueJob[]>();
  private readonly processing = new Set<string>();
  private readonly activeAbort = new Map<string, AbortController>();

  /** Enqueue a job for the given context. Preempts if busy. */
  enqueue(contextId: string, job: QueueJob): void {
    if (this.processing.has(contextId)) {
      // Preempt: abort current job, drop stale queue, enqueue the new one
      this.activeAbort.get(contextId)?.abort();
      this.pending.set(contextId, [job]);
      return;
    }

    const queue = this.pending.get(contextId) ?? [];
    queue.push(job);
    this.pending.set(contextId, queue);
    void this.drain(contextId);
  }

  /** Returns true if a job is currently running for the given context. */
  isBusy(contextId: string): boolean {
    return this.processing.has(contextId);
  }

  /** Abort all running jobs and clear all queues. */
  shutdown(): void {
    for (const ac of this.activeAbort.values()) ac.abort();
    this.activeAbort.clear();
    this.pending.clear();
    this.processing.clear();
  }

  private async drain(contextId: string): Promise<void> {
    if (this.processing.has(contextId)) return;
    this.processing.add(contextId);
    try {
      while (true) {
        const queue = this.pending.get(contextId);
        const next = queue?.shift();
        if (!next) {
          this.pending.delete(contextId);
          break;
        }
        const ac = new AbortController();
        this.activeAbort.set(contextId, ac);
        try {
          await next(ac.signal);
        } catch {
          // Keep draining queued jobs even if one task fails unexpectedly.
        } finally {
          this.activeAbort.delete(contextId);
        }
      }
    } finally {
      this.processing.delete(contextId);
      if ((this.pending.get(contextId)?.length ?? 0) > 0) {
        void this.drain(contextId);
      }
    }
  }
}
