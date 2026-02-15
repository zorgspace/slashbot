/**
 * Fixed-size circular buffer for in-memory log capture.
 * Used by NodeRedManager to store recent stdout/stderr for quick access.
 *
 * @see /specs/001-nodered-lifecycle/data-model.md
 */

/**
 * Generic ring buffer with configurable capacity.
 * When full, oldest items are automatically discarded (FIFO).
 *
 * Default capacity: 200 lines (optimized for Node-RED log capture)
 *
 * Example:
 * ```typescript
 * const buffer = new RingBuffer<string>(3);
 * buffer.push('a');
 * buffer.push('b');
 * buffer.push('c');
 * buffer.push('d'); // Wraps - discards 'a'
 * buffer.tail(2); // ['c', 'd']
 * ```
 */
export class RingBuffer<T = string> {
  private readonly capacity: number;
  private buffer: T[];
  private head: number; // Next write position
  private count: number; // Current number of items

  /**
   * Create a new ring buffer.
   *
   * @param capacity - Maximum number of items to store. Default: 200.
   */
  constructor(capacity: number = 200) {
    this.capacity = Math.max(0, capacity); // Handle negative capacity
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }

  /**
   * Append an item to the buffer.
   * If buffer is full, discards the oldest item.
   *
   * @param item - The item to append
   */
  push(item: T): void {
    if (this.capacity === 0) {
      // Degenerate case: capacity 0 means no storage
      return;
    }

    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;

    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Get the last N items in insertion order.
   *
   * @param n - Number of items to return. Default: all items. Negative values return empty array.
   * @returns Array of last n items (or all if n not provided)
   */
  tail(n?: number): T[] {
    if (this.count === 0) {
      return [];
    }

    // Default to all items if n not provided
    const itemsToReturn = n === undefined ? this.count : Math.max(0, Math.floor(n));

    // Cap at actual count
    const actualCount = Math.min(itemsToReturn, this.count);

    if (actualCount === 0) {
      return [];
    }

    const result: T[] = [];

    // Calculate the starting index (oldest item in the window)
    // If buffer is not full: start from index 0
    // If buffer is full: start from head (oldest item)
    const isFull = this.count === this.capacity;
    const oldestIndex = isFull ? this.head : 0;

    // Start from (actualCount items before head)
    const startIndex = (oldestIndex + this.count - actualCount + this.capacity) % this.capacity;

    for (let i = 0; i < actualCount; i++) {
      const index = (startIndex + i) % this.capacity;
      result.push(this.buffer[index]);
    }

    return result;
  }

  /**
   * Get all items in insertion order.
   * Alias for tail() with no arguments.
   *
   * @returns Array of all items in buffer
   */
  toArray(): T[] {
    return this.tail();
  }

  /**
   * Clear the buffer and reset to empty state.
   */
  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }

  /**
   * Current number of items stored in the buffer.
   * Never exceeds capacity.
   */
  get size(): number {
    return this.count;
  }
}
