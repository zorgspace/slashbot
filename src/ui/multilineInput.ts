/**
 * Multi-line Input Handler
 *
 * Provides Claude Code-style multi-line input where:
 * - Shift+Enter adds a new line
 * - Enter submits the input
 * - Arrow keys navigate within text
 * - Paste is supported via bracketed paste mode
 */

import { expandPaste } from './pasteHandler';

// Shift+Enter sequences (varies by terminal)
const SHIFT_ENTER_SEQUENCES = [
  '\x1b[13;2u',     // Kitty keyboard protocol
  '\x1b[27;2;13~',  // xterm modifyOtherKeys
  '\x1bOM',         // Some terminals
];

// Bracketed paste mode sequences
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

interface MultilineInputOptions {
  prompt: string;
  history?: string[];
  completer?: (line: string) => [string[], string];
}

/**
 * Read multi-line input from the user
 * - Shift+Enter adds a new line (displayed as continuation)
 * - Enter submits all lines
 * - Left/Right arrows move cursor
 * - Paste is supported
 */
export function readMultilineInput(options: MultilineInputOptions): Promise<string> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    let currentLine = '';
    let cursorPos = 0; // Position within currentLine
    let historyIndex = -1;
    const history = options.history || [];

    // Paste handling state
    let inPaste = false;
    let pasteBuffer = '';

    // Save terminal state
    const wasRaw = process.stdin.isRaw;

    // Print initial prompt
    process.stdout.write(options.prompt);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw ?? false);
      }
    };

    const submit = () => {
      cleanup();
      process.stdout.write('\n');
      const fullInput = [...lines, currentLine].join('\n');
      // Expand any paste placeholders
      resolve(expandPaste(fullInput));
    };

    const getPromptWidth = () => {
      if (lines.length > 0) {
        return 3; // Continuation indent "   "
      }
      // Remove ANSI codes to get actual width
      return options.prompt.replace(/\x1b\[[0-9;]*m/g, '').length;
    };

    const redrawCurrentLine = () => {
      // Clear current line and redraw
      process.stdout.write('\r\x1b[K');
      if (lines.length > 0) {
        process.stdout.write('   '); // Continuation indent
      } else {
        process.stdout.write(options.prompt);
      }
      process.stdout.write(currentLine);
      // Move cursor to correct position
      const moveBack = currentLine.length - cursorPos;
      if (moveBack > 0) {
        process.stdout.write(`\x1b[${moveBack}D`);
      }
    };

    const insertText = (text: string) => {
      // Insert text at cursor position
      currentLine = currentLine.slice(0, cursorPos) + text + currentLine.slice(cursorPos);
      cursorPos += text.length;
      redrawCurrentLine();
    };

    const deleteChar = () => {
      if (cursorPos > 0) {
        currentLine = currentLine.slice(0, cursorPos - 1) + currentLine.slice(cursorPos);
        cursorPos--;
        redrawCurrentLine();
      } else if (lines.length > 0) {
        // Go back to previous line
        const prevLine = lines.pop()!;
        cursorPos = prevLine.length;
        currentLine = prevLine + currentLine;
        // Move cursor up and redraw
        process.stdout.write('\x1b[A'); // Move up
        redrawCurrentLine();
      }
    };

    const handlePastedContent = (content: string) => {
      // Handle pasted content - may contain newlines
      const pasteLines = content.split('\n');

      if (pasteLines.length === 1) {
        // Single line paste - just insert
        insertText(pasteLines[0]);
      } else {
        // Multi-line paste
        // Insert first part into current line
        insertText(pasteLines[0]);

        // Add middle lines as complete lines
        for (let i = 1; i < pasteLines.length - 1; i++) {
          lines.push(currentLine);
          currentLine = pasteLines[i];
          cursorPos = currentLine.length;
          process.stdout.write('\n   ');
          process.stdout.write(currentLine);
        }

        // Handle last line
        if (pasteLines.length > 1) {
          lines.push(currentLine);
          currentLine = pasteLines[pasteLines.length - 1];
          cursorPos = currentLine.length;
          process.stdout.write('\n   ');
          process.stdout.write(currentLine);
        }
      }
    };

    const onData = (data: Buffer) => {
      let str = data.toString();

      // Handle bracketed paste mode
      if (inPaste) {
        const endIdx = str.indexOf(PASTE_END);
        if (endIdx !== -1) {
          // End of paste
          pasteBuffer += str.slice(0, endIdx);
          handlePastedContent(pasteBuffer);
          pasteBuffer = '';
          inPaste = false;
          // Process any remaining data after paste end
          str = str.slice(endIdx + PASTE_END.length);
          if (str.length === 0) return;
        } else {
          // Still in paste, accumulate
          pasteBuffer += str;
          return;
        }
      }

      // Check for paste start
      const pasteStartIdx = str.indexOf(PASTE_START);
      if (pasteStartIdx !== -1) {
        // Process data before paste
        const beforePaste = str.slice(0, pasteStartIdx);
        if (beforePaste.length > 0) {
          processInput(beforePaste);
        }
        // Start paste mode
        inPaste = true;
        pasteBuffer = str.slice(pasteStartIdx + PASTE_START.length);
        // Check if paste end is in same chunk
        const endIdx = pasteBuffer.indexOf(PASTE_END);
        if (endIdx !== -1) {
          handlePastedContent(pasteBuffer.slice(0, endIdx));
          pasteBuffer = '';
          inPaste = false;
          const afterPaste = pasteBuffer.slice(endIdx + PASTE_END.length);
          if (afterPaste.length > 0) {
            processInput(afterPaste);
          }
        }
        return;
      }

      processInput(str);
    };

    const processInput = (str: string) => {
      // Check for Ctrl+C
      if (str === '\x03') {
        process.emit('SIGINT', 'SIGINT');
        return;
      }

      // Check for Ctrl+D (EOF)
      if (str === '\x04') {
        if (currentLine === '' && lines.length === 0) {
          cleanup();
          process.stdout.write('\n');
          resolve('');
        }
        return;
      }

      // Check for Shift+Enter sequences
      for (const seq of SHIFT_ENTER_SEQUENCES) {
        if (str.includes(seq)) {
          // Add current line and start a new one
          lines.push(currentLine);
          currentLine = '';
          cursorPos = 0;
          process.stdout.write('\n   '); // New line with continuation indent
          return;
        }
      }

      // Check for Enter (submit)
      if (str === '\r' || str === '\n') {
        submit();
        return;
      }

      // Check for Backspace
      if (str === '\x7f' || str === '\b') {
        deleteChar();
        return;
      }

      // Check for Delete key
      if (str === '\x1b[3~') {
        if (cursorPos < currentLine.length) {
          currentLine = currentLine.slice(0, cursorPos) + currentLine.slice(cursorPos + 1);
          redrawCurrentLine();
        }
        return;
      }

      // Arrow keys
      if (str === '\x1b[C') { // Right arrow
        if (cursorPos < currentLine.length) {
          cursorPos++;
          process.stdout.write('\x1b[C');
        }
        return;
      }
      if (str === '\x1b[D') { // Left arrow
        if (cursorPos > 0) {
          cursorPos--;
          process.stdout.write('\x1b[D');
        }
        return;
      }
      if (str === '\x1b[A') { // Up arrow - history
        if (lines.length === 0 && history.length > 0) {
          if (historyIndex < history.length - 1) {
            historyIndex++;
            currentLine = history[history.length - 1 - historyIndex];
            cursorPos = currentLine.length;
            redrawCurrentLine();
          }
        }
        return;
      }
      if (str === '\x1b[B') { // Down arrow - history
        if (lines.length === 0 && historyIndex >= 0) {
          historyIndex--;
          if (historyIndex >= 0) {
            currentLine = history[history.length - 1 - historyIndex];
          } else {
            currentLine = '';
          }
          cursorPos = currentLine.length;
          redrawCurrentLine();
        }
        return;
      }

      // Home key
      if (str === '\x1b[H' || str === '\x01') { // Home or Ctrl+A
        cursorPos = 0;
        redrawCurrentLine();
        return;
      }

      // End key
      if (str === '\x1b[F' || str === '\x05') { // End or Ctrl+E
        cursorPos = currentLine.length;
        redrawCurrentLine();
        return;
      }

      // Ctrl+K - kill to end of line
      if (str === '\x0b') {
        currentLine = currentLine.slice(0, cursorPos);
        redrawCurrentLine();
        return;
      }

      // Ctrl+U - kill to start of line
      if (str === '\x15') {
        currentLine = currentLine.slice(cursorPos);
        cursorPos = 0;
        redrawCurrentLine();
        return;
      }

      // Ctrl+W - delete word backward
      if (str === '\x17') {
        const before = currentLine.slice(0, cursorPos);
        const after = currentLine.slice(cursorPos);
        const trimmed = before.trimEnd();
        const lastSpace = trimmed.lastIndexOf(' ');
        const newBefore = lastSpace === -1 ? '' : trimmed.slice(0, lastSpace + 1);
        currentLine = newBefore + after;
        cursorPos = newBefore.length;
        redrawCurrentLine();
        return;
      }

      // Ignore other escape sequences
      if (str.startsWith('\x1b')) {
        return;
      }

      // Regular character input - insert at cursor
      insertText(str);
    };

    process.stdin.on('data', onData);
  });
}
