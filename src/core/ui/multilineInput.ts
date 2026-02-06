/**
 * Multi-line Input Handler
 *
 * Provides Claude Code-style multi-line input where:
 * - Shift+Enter adds a new line
 * - Enter submits the input
 * - Arrow keys navigate within text
 * - Paste is supported via bracketed paste mode
 * - Ctrl+V pastes images from clipboard
 */

import { expandPaste, readImageFromClipboard } from './pasteHandler';
import { addImage, imageBuffer } from '../code/imageBuffer';
import { c, thinkingDisplay, colors } from './colors';
import { drawBox } from './components/box';
import { getGroupedCommands } from '../commands/parser';
import { state } from './state';

// Cursor blink rate
const CURSOR_BLINK_INTERVAL = 530; // ms - matches typical terminal blink rate

// Shift+Enter sequences (varies by terminal)
const SHIFT_ENTER_SEQUENCES = [
  '\x1b[13;2u', // Kitty keyboard protocol
  '\x1b[27;2;13~', // xterm modifyOtherKeys
  '\x1bOM', // Some terminals
];

// Image paste sequences
const IMAGE_PASTE_SEQUENCES = [
  '\x16', // Ctrl+V (universal - V for paste image)
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

    // Track previous visual state for proper clearing
    let prevDisplayedRows = 1;
    let prevCursorRow = 0;

    // Save terminal state
    const wasRaw = process.stdin.isRaw;

    const inputLinePrompt = options.prompt;

    // Write initial prompt
    process.stdout.write(inputLinePrompt);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    // Hide native cursor - we draw our own block cursor
    process.stdout.write('\x1b[?25l');

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

      // Calculate how many terminal rows the NEW text will occupy
      const newWrappedRows = Math.ceil(totalLength / termWidth) || 1;

      // Use PREVIOUS state for clearing (where cursor actually is)
      // Move up to the first row based on where we WERE
      if (prevCursorRow > 0) {
        process.stdout.write(`\x1b[${prevCursorRow}A`);
      }

      // Clear from the beginning of the line
      process.stdout.write('\r\x1b[K');

      // Clear all previously displayed rows (and any new ones we might need)
      const rowsToClear = Math.max(prevDisplayedRows, newWrappedRows);
      for (let i = 1; i < rowsToClear; i++) {
        process.stdout.write('\x1b[B\x1b[K'); // Move down and clear
      }
      // Move back up to the first row
      if (rowsToClear > 1) {
        process.stdout.write(`\x1b[${rowsToClear - 1}A`);
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

      // Draw raw output panel if enabled
      if (state.rawPanelEnabled) {
        // Save cursor position
        process.stdout.write('\x1b[s');
        // Panel starts at 60% of terminal width
        const panelCol = Math.floor(termWidth * 0.6);
        const panelWidth = termWidth - panelCol;
        // Draw panel border
        process.stdout.write(`\x1b[1;${panelCol}H┌${'─'.repeat(panelWidth - 2)}┐`);
        process.stdout.write(`\x1b[2;${panelCol}H│ Raw LLM Output${' '.repeat(panelWidth - 16)}│`);
        process.stdout.write(`\x1b[3;${panelCol}H├${'─'.repeat(panelWidth - 2)}┤`);
        // Draw content (last few lines)
        const outputLines = state.rawOutputText.split('\n').slice(-5);
        for (let i = 0; i < outputLines.length; i++) {
          const line = outputLines[i].substring(0, panelWidth - 2).padEnd(panelWidth - 2);
          process.stdout.write(`\x1b[${4 + i};${panelCol}H│${line}│`);
        }
        // Bottom border
        const bottomRow = 4 + outputLines.length;
        process.stdout.write(`\x1b[${bottomRow};${panelCol}H└${'─'.repeat(panelWidth - 2)}┘`);
        // Restore cursor
        process.stdout.write('\x1b[u');
      }

      // Update previous state for next redraw
      prevDisplayedRows = newWrappedRows;
      const newCursorTotal = promptWidth + cursorPos;
      prevCursorRow = Math.floor(newCursorTotal / termWidth);
    };

    const clearAllLines = () => {
      const termWidth = process.stdout.columns || 80;

      // Calculate total rows including all previous lines using ACTUAL previous state
      let totalRows = prevDisplayedRows;
      for (const line of lines) {
        const lineLength = 3 + line.length; // "   " continuation prefix
        totalRows += Math.ceil(lineLength / termWidth) || 1;
      }

      // Move up from current cursor row to the first row
      if (prevCursorRow > 0) {
        process.stdout.write(`\x1b[${prevCursorRow}A`);
      }

      // Move up past all the previous multi-lines
      if (lines.length > 0) {
        const rowsForPrevLines = totalRows - prevDisplayedRows;
        if (rowsForPrevLines > 0) {
          process.stdout.write(`\x1b[${rowsForPrevLines}A`);
        }
      }

      // Clear all lines from top to bottom
      process.stdout.write('\r\x1b[K');
      for (let i = 1; i < totalRows; i++) {
        process.stdout.write('\x1b[B\x1b[K');
      }

      // Move back to the top
      if (totalRows > 1) {
        process.stdout.write(`\x1b[${totalRows - 1}A`);
      }
      process.stdout.write('\r');

      // Reset tracking state
      prevDisplayedRows = 1;
      prevCursorRow = 0;
    };

    const redrawAllLines = () => {
      const termWidth = process.stdout.columns || 80;

      // Clear everything first
      clearAllLines();

      // Write all previous lines with prompts
      if (lines.length > 0) {
        // First line with main prompt
        process.stdout.write(inputLinePrompt);
        process.stdout.write(lines[0]);

        // Continuation lines
        for (let i = 1; i < lines.length; i++) {
          process.stdout.write('\n   '); // continuation indent
          process.stdout.write(lines[i]);
        }

        // Current line with continuation indent
        process.stdout.write('\n   ');
      } else {
        // No previous lines, write main prompt
        process.stdout.write(inputLinePrompt);
      }

      // Write current line content with cursor
      const beforeCursor = currentLine.slice(0, cursorPos);
      const charAtCursor = currentLine[cursorPos] || ' ';
      const afterCursor = currentLine.slice(cursorPos + 1);

      process.stdout.write(beforeCursor);
      if (cursorVisible) {
        process.stdout.write(`${colors.bgViolet}${colors.white}${charAtCursor}${colors.reset}`);
      } else {
        process.stdout.write(charAtCursor);
      }
      process.stdout.write(afterCursor);

      // Update tracking for current line
      const promptWidth = lines.length > 0 ? 3 : inputLinePrompt.replace(/\x1b\[[0-9;]*m/g, '').length;
      const totalLength = promptWidth + currentLine.length;
      prevDisplayedRows = Math.ceil(totalLength / termWidth) || 1;
      const cursorTotal = promptWidth + cursorPos;
      prevCursorRow = Math.floor(cursorTotal / termWidth);
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
      // Check for Ctrl+C - emit SIGINT to let signal handler manage exit
      if (str === '\x03') {
        // Stop cursor blink first
        if (blinkInterval) {
          clearInterval(blinkInterval);
          blinkInterval = null;
        }
        cursorVisible = false;
        // Reset state completely
        lines.length = 0;
        currentLine = '';
        cursorPos = 0;
        historyIndex = -1;
        // Emit SIGINT so the signal handler can track double Ctrl+C for exit
        // Signal handler will print the warning/prompt, next keystroke restarts cursor
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

      // Check for image paste sequences (Ctrl+V or Ctrl+Shift+V)
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
                  `\n${colors.violet}●${colors.reset} ${colors.violet}Image${colors.reset}(clipboard, ${sizeKB}KB)\n`,
                );
                process.stdout.write(`  ${colors.green}⎿  Ready${colors.reset}\n`);
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
        if (history.length > 0 && historyIndex < history.length - 1) {
          // Clear existing multi-line content first
          const hadMultipleLines = lines.length > 0;
          if (hadMultipleLines) {
            clearAllLines();
          }

          historyIndex++;
          const historyItem = history[history.length - 1 - historyIndex];
          lines.length = 0;

          // Handle multi-line history items
          if (historyItem.includes('\n')) {
            const historyLines = historyItem.split('\n');
            for (let i = 0; i < historyLines.length - 1; i++) {
              lines.push(historyLines[i]);
            }
            currentLine = historyLines[historyLines.length - 1];
            cursorPos = currentLine.length;
            resetCursorBlink();
            redrawAllLines();
          } else {
            currentLine = historyItem;
            cursorPos = currentLine.length;
            resetCursorBlink();
            if (hadMultipleLines) {
              process.stdout.write(inputLinePrompt);
            }
            redrawCurrentLine();
          }
        }
        return;
      }
      if (str === '\x1b[B') {
        // Down arrow - history
        if (historyIndex >= 0) {
          // First clear any existing multi-line content
          const hadMultipleLines = lines.length > 0;
          if (hadMultipleLines) {
            clearAllLines();
          }
          historyIndex--;
          lines.length = 0;
          if (historyIndex >= 0) {
            const historyItem = history[history.length - 1 - historyIndex];
            // Handle multi-line history items
            if (historyItem.includes('\n')) {
              const historyLines = historyItem.split('\n');
              for (let i = 0; i < historyLines.length - 1; i++) {
                lines.push(historyLines[i]);
              }
              currentLine = historyLines[historyLines.length - 1];
            } else {
              currentLine = historyItem;
            }
          } else {
            currentLine = '';
          }
          cursorPos = currentLine.length;
          resetCursorBlink();
          if (lines.length > 0) {
            redrawAllLines();
          } else if (hadMultipleLines) {
            // Need to redraw from fresh position after clearing
            process.stdout.write(inputLinePrompt);
            redrawCurrentLine();
          } else {
            redrawCurrentLine();
          }
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

      // Ctrl+P - toggle raw output panel
      if (str === '\x10') {
        state.rawPanelEnabled = !state.rawPanelEnabled;
        if (state.rawPanelEnabled) {
          state.rawOutputText = 'Raw LLM Output Panel Enabled\n';
        } else {
          state.rawOutputText = '';
        }
        redrawCurrentLine();
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
