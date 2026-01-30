/**
 * Paste Handler - Intercepts bracketed paste mode to show compressed placeholders
 *
 * When text is pasted (Cmd+V / Ctrl+V), it shows "[pasted: N chars]" instead of
 * the full text, allowing the user to continue typing before sending.
 *
 * Also handles Shift+Enter to insert newlines without submitting.
 */

import { Transform, TransformCallback } from 'stream';

// Bracketed paste mode escape sequences
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

// Shift+Enter sequences (varies by terminal)
// Kitty keyboard protocol: ESC [ 13 ; 2 u
// Some terminals: ESC O M or ESC [ M
const SHIFT_ENTER_SEQUENCES = [
  '\x1b[13;2u',  // Kitty keyboard protocol
  '\x1b[27;2;13~', // xterm modifyOtherKeys
  '\x1bOM',      // Some terminals
];

// Visible newline marker that won't trigger readline submit
const NEWLINE_MARKER = '⏎';

interface PasteEntry {
  id: number;
  content: string;
  placeholder: string;
}

class PasteBuffer {
  private entries: Map<number, string> = new Map();
  private nextId = 1;

  /**
   * Store pasted content and return a placeholder
   */
  store(content: string): string {
    const id = this.nextId++;
    this.entries.set(id, content);

    // Create a descriptive placeholder
    const lines = content.split('\n').length;
    const chars = content.length;

    let desc: string;
    if (lines > 1) {
      desc = `${lines} lines, ${chars} chars`;
    } else {
      desc = `${chars} chars`;
    }

    return `[pasted:${id}:${desc}]`;
  }

  /**
   * Expand all placeholders in text back to their original content
   * Also expands newline markers (⏎) to actual newlines
   */
  expand(text: string): string {
    // First expand paste placeholders
    let result = text.replace(/\[pasted:(\d+):[^\]]+\]/g, (match, idStr) => {
      const id = parseInt(idStr, 10);
      const content = this.entries.get(id);
      if (content !== undefined) {
        this.entries.delete(id); // Clean up after use
        return content;
      }
      return match; // Keep placeholder if not found
    });

    // Then expand newline markers
    result = result.split(NEWLINE_MARKER).join('\n');

    return result;
  }

  /**
   * Clear all stored paste entries
   */
  clear(): void {
    this.entries.clear();
  }
}

/**
 * Transform stream that intercepts bracketed paste sequences
 * and replaces them with placeholders
 */
class PasteTransform extends Transform {
  private buffer = '';
  private inPaste = false;
  private pasteContent = '';
  private pasteBuffer: PasteBuffer;

  constructor(pasteBuffer: PasteBuffer) {
    super();
    this.pasteBuffer = pasteBuffer;
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    let data = chunk.toString();

    // Handle Ctrl+C outside of paste mode - emit SIGINT signal
    if (!this.inPaste && data.includes('\x03')) {
      process.emit('SIGINT', 'SIGINT');
      // Remove Ctrl+C from data and continue processing the rest
      data = data.replace(/\x03/g, '');
      if (data.length === 0) {
        callback();
        return;
      }
    }

    // Handle Shift+Enter sequences - replace with newline marker
    if (!this.inPaste) {
      for (const seq of SHIFT_ENTER_SEQUENCES) {
        data = data.split(seq).join(NEWLINE_MARKER);
      }
    }

    this.buffer += data;

    let output = '';

    while (this.buffer.length > 0) {
      if (this.inPaste) {
        // Look for paste end sequence
        const endIdx = this.buffer.indexOf(PASTE_END);
        if (endIdx !== -1) {
          // Capture paste content up to end marker
          this.pasteContent += this.buffer.slice(0, endIdx);
          this.buffer = this.buffer.slice(endIdx + PASTE_END.length);
          this.inPaste = false;

          // Store and get placeholder
          if (this.pasteContent.length > 0) {
            const placeholder = this.pasteBuffer.store(this.pasteContent);
            output += placeholder;
          }
          this.pasteContent = '';
        } else {
          // Check if we might have a partial end sequence
          let partialMatch = false;
          for (let i = 1; i < PASTE_END.length && i <= this.buffer.length; i++) {
            if (this.buffer.slice(-i) === PASTE_END.slice(0, i)) {
              // Potential partial match at end - keep it buffered
              this.pasteContent += this.buffer.slice(0, -i);
              this.buffer = this.buffer.slice(-i);
              partialMatch = true;
              break;
            }
          }
          if (!partialMatch) {
            // No partial match, consume all as paste content
            this.pasteContent += this.buffer;
            this.buffer = '';
          }
          break; // Wait for more data
        }
      } else {
        // Look for paste start sequence
        const startIdx = this.buffer.indexOf(PASTE_START);
        if (startIdx !== -1) {
          // Output everything before the paste start
          output += this.buffer.slice(0, startIdx);
          this.buffer = this.buffer.slice(startIdx + PASTE_START.length);
          this.inPaste = true;
          this.pasteContent = '';
        } else {
          // Check if we might have a partial start sequence at the end
          let partialMatch = false;
          for (let i = 1; i < PASTE_START.length && i <= this.buffer.length; i++) {
            if (this.buffer.slice(-i) === PASTE_START.slice(0, i)) {
              // Potential partial match - output everything before, keep partial
              output += this.buffer.slice(0, -i);
              this.buffer = this.buffer.slice(-i);
              partialMatch = true;
              break;
            }
          }
          if (!partialMatch) {
            // No partial match, output all
            output += this.buffer;
            this.buffer = '';
          }
          break; // Wait for more data if partial match
        }
      }
    }

    if (output.length > 0) {
      this.push(output);
    }
    callback();
  }

  _flush(callback: TransformCallback): void {
    // Flush any remaining buffer
    if (this.buffer.length > 0) {
      if (this.inPaste) {
        this.pasteContent += this.buffer;
        if (this.pasteContent.length > 0) {
          const placeholder = this.pasteBuffer.store(this.pasteContent);
          this.push(placeholder);
        }
      } else {
        this.push(this.buffer);
      }
    }
    callback();
  }
}

// Singleton paste buffer
const pasteBuffer = new PasteBuffer();

/**
 * Enable bracketed paste mode on the terminal
 */
export function enableBracketedPaste(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?2004h');
  }
}

/**
 * Disable bracketed paste mode on the terminal
 */
export function disableBracketedPaste(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?2004l');
  }
}

/**
 * Create a transform stream that intercepts paste sequences
 */
export function createPasteTransform(): Transform {
  return new PasteTransform(pasteBuffer);
}

/**
 * Expand placeholders in text back to original pasted content
 */
export function expandPaste(text: string): string {
  return pasteBuffer.expand(text);
}

/**
 * Clear all stored paste entries
 */
export function clearPasteBuffer(): void {
  pasteBuffer.clear();
}
