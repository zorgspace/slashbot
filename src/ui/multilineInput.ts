/**
 * Multi-line Input Handler
 *
 * Provides Claude Code-style multi-line input where:
 * - Shift+Enter adds a new line
 * - Enter submits the input
 * - Arrow keys navigate within text
 * - Paste is supported via bracketed paste mode
 * - Ctrl+Shift+V pastes images from clipboard
 */

import { expandPaste, readImageFromClipboard } from './pasteHandler';
import { addImage, imageBuffer } from '../code/imageBuffer';
import { c, thinkingDisplay, colors } from './colors';
import { drawBox } from './components/box';
import { getGroupedCommands } from '../commands/parser';

// Cursor blink rate
const CURSOR_BLINK_INTERVAL = 530; // ms - matches typical terminal blink rate

// Shift+Enter sequences (varies by terminal)
const SHIFT_ENTER_SEQUENCES = [
  '\x1b[13;2u', // Kitty keyboard protocol
  '\x1b[27;2;13~', // xterm modifyOtherKeys
  '\x1bOM', // Some terminals
];

// Image paste sequences
// Ctrl+Shift+V varies by terminal, Ctrl+P is more universal
const IMAGE_PASTE_SEQUENCES = [
  '\x10', // Ctrl+P (universal - P for Paste image)
  '\x1b[118;6u', // Kitty keyboard protocol: Ctrl+Shift+V
  '\x1b[27;6;118~', // xterm modifyOtherKeys: Ctrl+Shift+V
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
  return new Promise(resolve => {
    const lines: string[] = [];
    let currentLine = '';
    let cursorPos = 0; // Position within currentLine
    let historyIndex = -1;
    const history = options.history || [];

    // Cursor blinking state
    let cursorVisible = true;
    let blinkInterval: ReturnType<typeof setInterval> | null = null;

    // Paste handling state
    let inPaste = false;
    let pasteBuffer = '';

    // Save terminal state
    const wasRaw = process.stdin.isRaw;

    // Separate sticky plan from input prompt for proper redraw
    // If prompt contains newline, the part before is the sticky plan (displayed once)
    // and the part after is the actual input prompt (used for redraws)
    const promptParts = options.prompt.split('\n');
    const hasStickyPlan = promptParts.length > 1;
    const inputLinePrompt = hasStickyPlan ? promptParts[promptParts.length - 1] : options.prompt;

    // Print initial prompt (includes sticky plan if present)
    process.stdout.write(options.prompt);
    // Hide native terminal cursor
    process.stdout.write('\x1b[?25l');

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const cleanup = () => {
      if (blinkInterval) {
        clearInterval(blinkInterval);
        blinkInterval = null;
      }
      process.stdout.write('\x1b[?25h'); // Show native cursor again
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
      // Remove ANSI codes to get actual width (use input line prompt, not full prompt)
      return inputLinePrompt.replace(/\x1b\[[0-9;]*m/g, '').length;
    };

    const redrawCurrentLine = () => {
      const termWidth = process.stdout.columns || 80;
      const promptWidth = getPromptWidth();
      const totalLength = promptWidth + currentLine.length;

      // Calculate how many terminal rows the text occupies
      const wrappedRows = Math.ceil(totalLength / termWidth) || 1;

      // Move cursor to the beginning of the first row of this logical line
      // and clear all wrapped rows
      if (wrappedRows > 1) {
        const cursorTotal = promptWidth + cursorPos;
        const currentRow = Math.floor(cursorTotal / termWidth);
        if (currentRow > 0) {
          process.stdout.write(`\x1b[${currentRow}A`);
        }
      }

      // Clear from the beginning of the line
      process.stdout.write('\r\x1b[K');

      // Clear any additional wrapped rows below
      for (let i = 1; i < wrappedRows; i++) {
        process.stdout.write('\x1b[B\x1b[K'); // Move down and clear
      }
      // Move back up to the first row
      if (wrappedRows > 1) {
        process.stdout.write(`\x1b[${wrappedRows - 1}A`);
      }
      process.stdout.write('\r');

      // Write the prompt
      if (lines.length > 0) {
        process.stdout.write('   '); // Continuation indent
      } else {
        process.stdout.write(inputLinePrompt);
      }

      // Write text with block cursor (highlights char at cursor position)
      const beforeCursor = currentLine.slice(0, cursorPos);
      const charAtCursor = currentLine[cursorPos] || ' '; // Space if at end
      const afterCursor = currentLine.slice(cursorPos + 1);

      process.stdout.write(beforeCursor);
      if (cursorVisible) {
        // Block cursor: highlight the character at cursor position
        process.stdout.write(`${colors.bgViolet}${colors.white}${charAtCursor}${colors.reset}`);
      } else {
        process.stdout.write(charAtCursor);
      }
      process.stdout.write(afterCursor);
    };

    // Reset cursor to visible state (call on any user input)
    const resetCursorBlink = () => {
      cursorVisible = true;
      if (blinkInterval) {
        clearInterval(blinkInterval);
      }
      blinkInterval = setInterval(() => {
        cursorVisible = !cursorVisible;
        redrawCurrentLine();
      }, CURSOR_BLINK_INTERVAL);
    };

    const insertText = (text: string) => {
      // Insert text at cursor position
      currentLine = currentLine.slice(0, cursorPos) + text + currentLine.slice(cursorPos);
      cursorPos += text.length;
      resetCursorBlink();
      redrawCurrentLine();
    };

    const deleteChar = () => {
      if (cursorPos > 0) {
        currentLine = currentLine.slice(0, cursorPos - 1) + currentLine.slice(cursorPos);
        cursorPos--;
        resetCursorBlink();
        redrawCurrentLine();
      } else if (lines.length > 0) {
        // Go back to previous line
        const prevLine = lines.pop()!;
        cursorPos = prevLine.length;
        currentLine = prevLine + currentLine;
        // Move cursor up and redraw
        process.stdout.write('\x1b[A'); // Move up
        resetCursorBlink();
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
      // Check for Ctrl+C - clear current input and start fresh
      if (str === '\x03') {
        // Clear the current line display
        process.stdout.write('\r\x1b[K');
        // Clear any multi-line content above
        for (let i = 0; i < lines.length; i++) {
          process.stdout.write('\x1b[A\x1b[K'); // Move up and clear
        }
        // Reset state completely
        lines.length = 0;
        currentLine = '';
        cursorPos = 0;
        historyIndex = -1;
        // Show canceled indicator and redraw fresh prompt
        process.stdout.write(`${colors.muted}^C${colors.reset}\n`);
        process.stdout.write(inputLinePrompt);
        resetCursorBlink();
        redrawCurrentLine();
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

      // Check for image paste sequences (Ctrl+P or Ctrl+Shift+V)
      for (const seq of IMAGE_PASTE_SEQUENCES) {
        if (str === seq || str.includes(seq)) {
          // Async clipboard read - need to handle carefully
          process.stdout.write(c.muted(' Reading clipboard...'));
          readImageFromClipboard()
            .then(dataUrl => {
              // Clear the "Reading clipboard..." message
              process.stdout.write('\r\x1b[K');
              if (lines.length > 0) {
                process.stdout.write('   ');
              } else {
                process.stdout.write(inputLinePrompt);
              }
              process.stdout.write(currentLine);

              if (dataUrl) {
                addImage(dataUrl);
                const sizeKB = Math.round(dataUrl.length / 1024);
                process.stdout.write(
                  `\n${c.success('🖼️  Image pasted from clipboard')} (${sizeKB}KB)\n`,
                );
                process.stdout.write(c.muted('   Now ask a question about the image\n'));
                // Redraw prompt
                if (lines.length > 0) {
                  process.stdout.write('   ');
                } else {
                  process.stdout.write(inputLinePrompt);
                }
                process.stdout.write(currentLine);
              } else {
                process.stdout.write(
                  `\n${c.warning('No image in clipboard')} (use xclip/wl-paste on Linux)\n`,
                );
                // Redraw prompt
                if (lines.length > 0) {
                  process.stdout.write('   ');
                } else {
                  process.stdout.write(inputLinePrompt);
                }
                process.stdout.write(currentLine);
              }
            })
            .catch(() => {
              process.stdout.write('\r\x1b[K');
              if (lines.length > 0) {
                process.stdout.write('   ');
              } else {
                process.stdout.write(inputLinePrompt);
              }
              process.stdout.write(currentLine);
            });
          return;
        }
      }

      // Check for Enter (submit) - handle \r, \n, or \r\n
      if (str === '\r' || str === '\n' || str === '\r\n') {
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
          resetCursorBlink();
          redrawCurrentLine();
        }
        return;
      }

      // Arrow keys
      if (str === '\x1b[C') {
        // Right arrow
        if (cursorPos < currentLine.length) {
          cursorPos++;
          resetCursorBlink();
          redrawCurrentLine();
        }
        return;
      }
      if (str === '\x1b[D') {
        // Left arrow
        if (cursorPos > 0) {
          cursorPos--;
          resetCursorBlink();
          redrawCurrentLine();
        }
        return;
      }
      if (str === '\x1b[A') {
        // Up arrow - history
        if (lines.length === 0 && history.length > 0) {
          if (historyIndex < history.length - 1) {
            historyIndex++;
            currentLine = history[history.length - 1 - historyIndex];
            cursorPos = currentLine.length;
            resetCursorBlink();
            redrawCurrentLine();
          }
        }
        return;
      }
      if (str === '\x1b[B') {
        // Down arrow - history
        if (lines.length === 0 && historyIndex >= 0) {
          historyIndex--;
          if (historyIndex >= 0) {
            currentLine = history[history.length - 1 - historyIndex];
          } else {
            currentLine = '';
          }
          cursorPos = currentLine.length;
          resetCursorBlink();
          redrawCurrentLine();
        }
        return;
      }

      // Home key
      if (str === '\x1b[H' || str === '\x01') {
        // Home or Ctrl+A
        cursorPos = 0;
        resetCursorBlink();
        redrawCurrentLine();
        return;
      }

      // End key
      if (str === '\x1b[F' || str === '\x05') {
        // End or Ctrl+E
        cursorPos = currentLine.length;
        resetCursorBlink();
        redrawCurrentLine();
        return;
      }

      // Ctrl+K - kill to end of line
      if (str === '\x0b') {
        currentLine = currentLine.slice(0, cursorPos);
        resetCursorBlink();
        redrawCurrentLine();
        return;
      }

      // Ctrl+U - kill to start of line
      if (str === '\x15') {
        currentLine = currentLine.slice(cursorPos);
        cursorPos = 0;
        resetCursorBlink();
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
        resetCursorBlink();
        redrawCurrentLine();
        return;
      }

      // Ctrl+O - toggle thinking display
      if (str === '\x0f') {
        // Clear current line, show thinking, then redraw prompt
        process.stdout.write('\r\x1b[K');
        thinkingDisplay.toggle();
        // Redraw prompt and current input
        if (lines.length > 0) {
          process.stdout.write('   ');
        } else {
          process.stdout.write(inputLinePrompt);
        }
        process.stdout.write(currentLine);
        return;
      }

      // Tab completion
      if (str === '\t') {
        if (options.completer) {
          const [completions, prefix] = options.completer(currentLine);
          if (completions.length === 1) {
            // Single completion - replace the line
            currentLine = completions[0];
            cursorPos = currentLine.length;
            redrawCurrentLine();
          } else if (completions.length > 1) {
            // Check if we're completing slash commands for beautiful display
            const isCommandCompletion = completions.every(comp => comp.startsWith('/'));
            if (isCommandCompletion) {
              // Beautiful grouped command display
              const groupedCommands = getGroupedCommands();
              process.stdout.write('\n');
              for (const group of groupedCommands) {
                if (group.cmds.length > 0) {
                  process.stdout.write(`${c.violet(c.bold(group.title + ':'))}\n`);
                  for (const cmd of group.cmds) {
                    const paddedName = cmd.name.padEnd(12);
                    process.stdout.write(`  ${c.violet(paddedName)} ${c.muted(cmd.description)}\n`);
                  }
                  process.stdout.write('\n');
                }
              }
            } else {
              // Regular completion display
              process.stdout.write('\n');
              for (const completion of completions.slice(0, 20)) {
                process.stdout.write(`  ${completion}\n`);
              }
              if (completions.length > 20) {
                process.stdout.write(`  ... and ${completions.length - 20} more\n`);
              }
            }
            // Redraw prompt after completions
            if (lines.length > 0) {
              process.stdout.write('   ');
            } else {
              process.stdout.write(inputLinePrompt);
            }
            process.stdout.write(currentLine);
          }
        }
        return;
      }

      // Ignore other escape sequences
      if (str.startsWith('\x1b')) {
        return;
      }

      // Regular character input - insert at cursor
      insertText(str);
    };

    // Initial draw with cursor and start blinking (after all functions are defined)
    redrawCurrentLine();
    blinkInterval = setInterval(() => {
      cursorVisible = !cursorVisible;
      redrawCurrentLine();
    }, CURSOR_BLINK_INTERVAL);

    process.stdin.on('data', onData);
  });
}
