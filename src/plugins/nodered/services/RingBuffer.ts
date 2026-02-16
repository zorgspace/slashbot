/**
 * Fixed-size circular buffer for in-memory log capture.
 * Used by NodeRedManager to store recent stdout/stderr for quick access.
 */

/**
 * Generic ring buffer with configurable capacity.
 * When full, oldest items are automatically discarded (FIFO).
 *
 * Default capacity: 200 lines (optimized for Node-RED log capture)
 */
export class RingBuffer<T = string> {
  private readonly capacity: number;
  private buffer: T[];
  private head: number; // Next write position
  private count: number; // Current number of items

  constructor(capacity: number = 200) {
    this.capacity = Math.max(0, capacity);
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }

  /**
   * Append an item to the buffer.
   * If buffer is full, discards the oldest item.
   */
  push(item: T): void {
    if (this.capacity === 0) return;

    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;

    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Get the last N items in insertion order.
   */
  tail(n?: number): T[] {
    if (this.count === 0) return [];

    const itemsToReturn = n === undefined ? this.count : Math.max(0, Math.floor(n));
    const actualCount = Math.min(itemsToReturn, this.count);
    if (actualCount === 0) return [];

    const result: T[] = [];
    const isFull = this.count === this.capacity;
    const oldestIndex = isFull ? this.head : 0;
    const startIndex = (oldestIndex + this.count - actualCount + this.capacity) % this.capacity;

    for (let i = 0; i < actualCount; i++) {
      const index = (startIndex + i) % this.capacity;
      result.push(this.buffer[index]);
    }

    return result;
  }

  /** Get all items in insertion order. */
  toArray(): T[] {
    return this.tail();
  }

  /** Clear the buffer and reset to empty state. */
  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }

  /** Current number of items stored in the buffer. */
  get size(): number {
    return this.count;
  }
}
