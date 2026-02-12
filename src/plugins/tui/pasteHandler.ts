/**
 * Paste Handler - Intercepts bracketed paste mode to show compressed placeholders
 *
 * When text is pasted (Cmd+V / Ctrl+V), it shows "[pasted: N chars]" instead of
 * the full text, allowing the user to continue typing before sending.
 *
 * Also handles Shift+Enter to insert newlines without submitting.
 * Ctrl+V pastes images from clipboard.
 */

import { Transform, TransformCallback } from 'stream';
import { spawn } from 'child_process';

// Bracketed paste mode escape sequences
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

// Shift+Enter sequences (varies by terminal)
// Kitty keyboard protocol: ESC [ 13 ; 2 u
// Some terminals: ESC O M or ESC [ M
const SHIFT_ENTER_SEQUENCES = [
  '\x1b[13;2u', // Kitty keyboard protocol
  '\x1b[27;2;13~', // xterm modifyOtherKeys
  '\x1bOM', // Some terminals
];

// Ctrl+V sequences for image paste
const CTRL_V_SEQUENCES = [
  '\x1b[118;5u', // Kitty keyboard protocol: Ctrl+v
  '\x1b[27;5;118~', // xterm modifyOtherKeys
  '\x16', // Ctrl+V raw
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
  private imageEntries: Map<number, string> = new Map();
  private nextImageId = 1;
  private lastPaste: { content: string; lines: number } | null = null;

  /**
   * Store pasted content and return a placeholder
   */
  store(content: string): string {
    const id = this.nextId++;
    this.entries.set(id, content);

    const lines = content.split('\n').length;
    return `[pasted content ${lines} line${lines > 1 ? 's' : ''}]`;
  }

  /**
   * Store image paste placeholder
   */
  storeImage(): string {
    const id = this.nextImageId++;
    this.imageEntries.set(id, 'pending');
    return `[image:${id}]`;
  }

  /**
   * Expand all placeholders in text back to their original content
   * Also expands newline markers (⏎) to actual newlines
   */
  async expand(text: string): Promise<string> {
    // First expand paste placeholders
    // Match both new format [pasted content X line(s)] and legacy [pasted:id:desc]
    let result = text.replace(/\[pasted content \d+ lines?\]/g, _match => {
      // Find the oldest unused entry (FIFO order)
      for (const [id, content] of this.entries) {
        this.entries.delete(id);
        // Save as lastPaste for persistent paste feature
        const lines = content.split('\n').length;
        this.lastPaste = { content, lines };
        return content;
      }
      return _match;
    });
    result = result.replace(/\[pasted:(\d+):[^\]]+\]/g, (match, idStr) => {
      const id = parseInt(idStr, 10);
      const content = this.entries.get(id);
      if (content !== undefined) {
        this.entries.delete(id);
        // Save as lastPaste for persistent paste feature
        const lines = content.split('\n').length;
        this.lastPaste = { content, lines };
        return content;
      }
      return match;
    });

    // Then expand image placeholders
    const imageRegex = /\[image:(\d+)\]/g;
    const matches = [...result.matchAll(imageRegex)];
    for (const match of matches) {
      const id = parseInt(match[1], 10);
      let content = this.imageEntries.get(id);
      if (content === 'pending') {
        const dataUrl = await readImageFromClipboard();
        if (dataUrl) {
          this.imageEntries.set(id, dataUrl);
          content = dataUrl;
        } else {
          this.imageEntries.delete(id);
          content = '[image:failed]';
        }
      } else if (!content) {
        content = '[image:failed]';
      }
      result = result.replace(match[0], content);
    }

    // Then expand newline markers
    result = result.split(NEWLINE_MARKER).join('\n');

    return result;
  }

  /**
   * Clear all stored paste entries
   */
  clear(): void {
    this.entries.clear();
    this.imageEntries.clear();
  }

  /**
   * Get the last expanded paste content (for persistent paste feature)
   */
  getLastPaste(): { content: string; lines: number } | null {
    return this.lastPaste;
  }

  /**
   * Clear the last paste (user pressed Escape or pasted new content)
   */
  clearLastPaste(): void {
    this.lastPaste = null;
  }

  /**
   * Get a summary string for the last paste, e.g. "[pasted: 50 lines]"
   */
  getLastPasteSummary(): string | null {
    if (!this.lastPaste) return null;
    const { lines } = this.lastPaste;
    return `[pasted: ${lines} line${lines > 1 ? 's' : ''}]`;
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

    // Handle Ctrl+V sequences - replace with image placeholder
    if (!this.inPaste) {
      for (const seq of CTRL_V_SEQUENCES) {
        if (data.includes(seq)) {
          data = data.split(seq).join(this.pasteBuffer.storeImage());
        }
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
export async function expandPaste(text: string): Promise<string> {
  return pasteBuffer.expand(text);
}

/**
 * Store pasted content and return a compressed placeholder
 */
export function storePaste(content: string): string {
  return pasteBuffer.store(content);
}

/**
 * Clear all stored paste entries
 */
export function clearPasteBuffer(): void {
  pasteBuffer.clear();
}

/**
 * Get the last expanded paste (for persistent paste feature)
 */
export function getLastPaste(): { content: string; lines: number } | null {
  return pasteBuffer.getLastPaste();
}

/**
 * Clear the persistent last paste
 */
export function clearLastPaste(): void {
  pasteBuffer.clearLastPaste();
}

/**
 * Get summary string for the persistent last paste, e.g. "[pasted: 50 lines]"
 */
export function getLastPasteSummary(): string | null {
  return pasteBuffer.getLastPasteSummary();
}

/**
 * Read image from system clipboard and return as base64 data URL
 * Supports Linux (X11/Wayland) and macOS
 */
export async function readImageFromClipboard(): Promise<string | null> {
  const platform = process.platform;

  return new Promise(resolve => {
    let cmd: string;
    let args: string[];

    if (platform === 'darwin') {
      // macOS - use osascript to get clipboard image
      cmd = 'osascript';
      args = [
        '-e',
        `
        use framework "AppKit"
        use scripting additions
        set pb to current application's NSPasteboard's generalPasteboard()
        set imgData to pb's dataForType:(current application's NSPasteboardTypePNG)
        if imgData is missing value then
          return ""
        else
          set base64 to (imgData's base64EncodedStringWithOptions:0) as text
          return base64
        end if
      `,
      ];
    } else {
      // Linux - try xclip first (X11), then wl-paste (Wayland)
      const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY;

      if (isWayland) {
        cmd = 'wl-paste';
        args = ['--type', 'image/png', '--no-newline'];
      } else {
        cmd = 'xclip';
        args = ['-selection', 'clipboard', '-t', 'image/png', '-o'];
      }
    }

    try {
      const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];

      proc.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      proc.on('close', code => {
        if (code !== 0 || chunks.length === 0) {
          resolve(null);
          return;
        }

        const data = Buffer.concat(chunks);
        if (data.length === 0) {
          resolve(null);
          return;
        }

        // For macOS, osascript returns base64 string directly
        // For Linux, we get raw PNG data
        let base64: string;
        if (platform === 'darwin') {
          base64 = data.toString('utf8').trim();
          if (!base64) {
            resolve(null);
            return;
          }
        } else {
          base64 = data.toString('base64');
        }

        resolve(`data:image/png;base64,${base64}`);
      });

      proc.on('error', () => {
        resolve(null);
      });

      // Timeout after 2 seconds
      setTimeout(() => {
        proc.kill();
        resolve(null);
      }, 2000);
    } catch {
      resolve(null);
    }
  });
}
