/**
 * Step Display - Claude Code-style output formatting
 */

import { colors } from '../core';

// Clear current line (removes any prompt character before output)
const clearLine = () => process.stdout.write('\r\x1b[K');

// No display limit - show full output
function truncateForDisplay(text: string): string {
  return text; // No truncation
}

/**
 * Macro function for displaying step actions
 * @param actionName - The name of the action (e.g., "Read", "Say", "Grep")
 * @param actionParam - The parameter(s) to display (e.g., file path, pattern)
 * @param output - Optional output/result to display below the action
 * @param options - Display options
 */
export function stepAction(
  actionName: string,
  actionParam: string,
  output?: string,
  options: {
    bullet?: 'filled' | 'empty'; // ● or ○
    color?: string; // Color for action name (default: violet)
    outputColor?: string; // Color for output (default: white)
    outputPrefix?: string; // Prefix for output (default: "⎿  ")
  } = {},
): void {
  const {
    bullet = 'filled',
    color = colors.violet,
    outputColor = colors.white,
    outputPrefix = '⎿  ',
  } = options;

  const bulletChar = bullet === 'filled' ? '●' : '○';
  const bulletColor = bullet === 'filled' ? color : colors.white;

  // Display action line: ● ActionName(param)
  console.log(
    `${bulletColor}${bulletChar}${colors.reset} ${color}${actionName}${colors.reset}(${actionParam})`,
  );

  // Display output if provided
  if (output !== undefined) {
    const lines = output.split('\n');
    lines.forEach((line, i) => {
      const prefix = i === 0 ? outputPrefix : '   ';
      console.log(`  ${outputColor}${prefix}${line}${colors.reset}`);
    });
  }
}

/**
 * Shorthand for common action patterns
 */
export const stepMacro = {
  /** Display action with violet bullet and optional output */
  action: (name: string, param: string, output?: string) =>
    stepAction(name, param, output, { bullet: 'filled', color: colors.violet }),

  /** Display action with white empty bullet (for say/message actions) */
  message: (name: string, param: string, output?: string) =>
    stepAction(name, param, output, { bullet: 'empty', color: colors.white }),

  /** Display action with info/blue bullet */
  info: (name: string, param: string, output?: string) =>
    stepAction(name, param, output, { bullet: 'filled', color: colors.info }),

  /** Display success output */
  success: (name: string, param: string, output: string) =>
    stepAction(name, param, `✓ ${output}`, { bullet: 'filled', color: colors.violet, outputColor: colors.green }),

  /** Display error output */
  error: (name: string, param: string, output: string) =>
    stepAction(name, param, `Error: ${output}`, { bullet: 'filled', color: colors.violet, outputColor: colors.error }),
};

// Claude Code-style output formatting
export const step = {
  // Add a blank line for visual separation between action groups
  newline: () => {
    console.log();
  },

  // Assistant message/thought (blue bullet)
  message: (text: string) => {
    console.log(`${colors.info}●${colors.reset} ${text}`);
  },

  // Tool call: ● ToolName(args) - blue bullet and name
  tool: (toolName: string, args?: string) => {
    clearLine(); // Clear any prompt before output
    const argsStr = args ? `(${args})` : '';
    console.log(
      `${colors.info}●${colors.reset} ${colors.info}${toolName}${colors.reset}${argsStr}`,
    );
  },

  // Tool result: ⎿  Result text (indented, white for reads, green for success messages)
  // Display truncated to MAX_DISPLAY_LINES, full output kept for LLM context
  result: (text: string, isError = false) => {
    clearLine(); // Clear any prompt before output
    const truncated = truncateForDisplay(text);
    const lines = truncated.split('\n');
    // Use green for success indicators, red for errors, white for general info
    const isSuccess =
      text.includes('No errors') ||
      text.includes('success') ||
      text.includes('Created') ||
      text.includes('Updated');
    const color = isError ? colors.error : isSuccess ? colors.green : colors.white;
    lines.forEach((line, i) => {
      // Add checkmark for success messages
      const checkmark = i === 0 && isSuccess && !isError ? '✓ ' : '';
      const prefix = i === 0 ? '⎿  ' : '   ';
      console.log(`  ${color}${prefix}${checkmark}${line}${colors.reset}`);
    });
  },

  // Read action: ● Read(file_path) - violet bullet and name
  read: (filePath: string, output?: string) => {
    stepAction('Read', filePath, output);
  },

  // Read result: ⎿  Read N lines - white
  readResult: (lineCount: number) => {
    console.log(`  ${colors.white}⎿  Read ${lineCount} lines${colors.reset}`);
  },

  // Grep action: ● Grep(pattern, file) - violet bullet and name
  grep: (pattern: string, filePattern?: string, output?: string) => {
    const args = filePattern ? `"${pattern}", "${filePattern}"` : `"${pattern}"`;
    stepAction('Grep', args, output);
  },

  // Grep result: ⎿  Found N matches - white (read operation)
  // Display truncated to MAX_DISPLAY_LINES, full output kept for LLM context
  grepResult: (matches: number, preview?: string) => {
    if (matches === 0) {
      console.log(`  ${colors.white}⎿  No matches found${colors.reset}`);
    } else {
      console.log(
        `  ${colors.white}⎿  Found ${matches} match${matches > 1 ? 'es' : ''}${colors.reset}`,
      );
      if (preview) {
        const truncated = truncateForDisplay(preview);
        truncated.split('\n').forEach(line => {
          console.log(`     ${colors.white}${line}${colors.reset}`);
        });
      }
    }
  },

  // Bash/Exec action: ● Exec(command) - violet bullet and name
  bash: (command: string, output?: string) => {
    stepAction('Exec', command, output);
  },

  // Bash result: just show status (output is streamed in real-time)
  bashResult: (_command: string, output: string, exitCode = 0) => {
    const isError = exitCode !== 0 || output.startsWith('Error:');
    const isSuccess =
      output.includes('No errors') || output.includes('success') || output.includes('✓');
    // Only show status indicator - output was already streamed to console
    if (isError) {
      console.log(`  ${colors.error}⎿  Exit code ${exitCode}${colors.reset}`);
    } else if (isSuccess) {
      console.log(`  ${colors.green}⎿  ✓ Done${colors.reset}`);
    } else {
      console.log(`  ${colors.white}⎿  Done${colors.reset}`);
    }
  },

  // Edit/Update action: ● Edit(file_path) - violet bullet
  update: (filePath: string, output?: string) => {
    stepAction('Edit', filePath, output);
  },

  // Edit result indicator - golf green
  updateResult: (
    success: boolean,
    _linesRemoved: number,
    _linesAdded: number,
    _context?: { before?: string[]; after?: string[]; lineStart?: number },
  ) => {
    if (success) {
      console.log(`  ${colors.green}⎿  Updated${colors.reset}`);
    } else {
      console.log(`  ${colors.error}⎿  Failed - pattern not found${colors.reset}`);
    }
  },

  // Create action: ● Create(file_path) - violet bullet
  write: (filePath: string, output?: string) => {
    stepAction('Create', filePath, output);
  },

  // Create result - golf green
  writeResult: (success: boolean, lineCount?: number) => {
    if (success) {
      const info = lineCount ? ` (${lineCount} lines)` : '';
      console.log(`  ${colors.green}⎿  Created${info}${colors.reset}`);
    } else {
      console.log(`  ${colors.error}⎿  Failed to create file${colors.reset}`);
    }
  },

  // Schedule action - violet bullet
  schedule: (name: string, cron: string, output?: string) => {
    stepAction('Schedule', `${name}, "${cron}"`, output);
  },

  // Skill action - violet bullet
  skill: (name: string, output?: string) => {
    stepAction('Skill', name, output);
  },

  // Success result - golf green with checkmark
  success: (message: string) => {
    console.log(`  ${colors.green}⎿  ✓ ${message}${colors.reset}`);
  },

  // Error result - red
  error: (message: string) => {
    console.log(`  ${colors.error}⎿  Error: ${message}${colors.reset}`);
  },

  // Warning result - orange
  warning: (message: string) => {
    console.log(`  ${colors.warning}⎿  ⚠ ${message}${colors.reset}`);
  },

  // Diff display with removed/added lines (Claude Code style with colored backgrounds)
  diff: (removed: string[], added: string[], filePath?: string, lineStart = 1) => {
    // Show removed lines with red background
    removed.forEach((line, i) => {
      const lineNum = String(lineStart + i).padStart(3, ' ');
      console.log(
        `      ${colors.muted}${lineNum}${colors.reset} ${colors.error}-${colors.reset} ${colors.bgRed}${colors.white}${line}${colors.reset}`,
      );
    });

    // Show added lines with green background
    added.forEach((line, i) => {
      const lineNum = String(lineStart + i).padStart(3, ' ');
      console.log(
        `      ${colors.muted}${lineNum}${colors.reset} ${colors.success}+${colors.reset} ${colors.bgGreen}${colors.white}${line}${colors.reset}`,
      );
    });

    // Show summary
    const addedCount = added.length;
    const removedCount = removed.length;
    const parts: string[] = [];
    if (addedCount > 0) parts.push(`Added ${addedCount} line${addedCount > 1 ? 's' : ''}`);
    if (removedCount > 0) parts.push(`removed ${removedCount} line${removedCount > 1 ? 's' : ''}`);
    if (parts.length > 0) {
      console.log(`      ${colors.muted}${parts.join(', ')}${colors.reset}`);
    }
  },

  // Thinking/status message
  thinking: (text: string) => {
    clearLine(); // Clear any prompt before output
    console.log(`${colors.white}●${colors.reset} ${colors.muted}${text}${colors.reset}`);
  },

  // Image loaded action: ● Image(source, size) - violet bullet
  image: (source: string, sizeKB: number, output?: string) => {
    stepAction('Image', `${source}, ${sizeKB}KB`, output);
  },

  // Image result - green
  imageResult: () => {
    console.log(`  ${colors.green}⎿  Ready${colors.reset}`);
  },

  // Connector action: ● Telegram(action) - cyan bullet
  connector: (source: string, action: string, output?: string) => {
    clearLine(); // Clear any prompt before output
    const sourceName = source.charAt(0).toUpperCase() + source.slice(1);
    stepAction(sourceName, action, output, { bullet: 'filled', color: colors.info });
  },

  // Connector result - white
  connectorResult: (message: string) => {
    clearLine(); // Clear any prompt/spinner before output
    process.stdout.write('\n'); // Ensure we're on a new line after any spinner
    console.log(`  ${colors.white}⎿  ${message}${colors.reset}`);
  },

  // Say action: ○ Say() in white, then ⎿ message
  say: (message: string) => {
    stepAction('Say', '', message, { bullet: 'empty', color: colors.white });
  },

  // Heartbeat action: ● Heartbeat(mode) - blue circle
  heartbeat: (mode: string = 'reflection') => {
    clearLine();
    stepAction('Heartbeat', mode, undefined, { bullet: 'filled', color: colors.blue });
  },

  // Heartbeat result - blue for OK, yellow for alert
  heartbeatResult: (_isOk: boolean) => {
  },

  // Heartbeat update action: ● HeartbeatUpdate() - blue circle
  heartbeatUpdate: () => {
    clearLine();
    stepAction('HeartbeatUpdate', 'HEARTBEAT.md', undefined, { bullet: 'filled', color: colors.blue });
  },

  // Heartbeat update result - green for success, red for failure
  heartbeatUpdateResult: (success: boolean) => {
    if (success) {
      console.log(`  ${colors.green}⎿  Updated HEARTBEAT.md${colors.reset}`);
    } else {
      console.log(`  ${colors.error}⎿  Failed to update HEARTBEAT.md${colors.reset}`);
    }
  },

  end: () => {},
};

// Status line (muted, with timing info)
export function statusLine(
  action: string,
  elapsed?: string,
  tokens?: number,
  thinkTime?: string,
): string {
  let parts = [`${colors.violetLight}* ${action}${colors.reset}`];
  if (elapsed) parts.push(`${elapsed}`);
  if (tokens) parts.push(`↓ ${tokens} tokens`);
  if (thinkTime) parts.push(`thought for ${thinkTime}`);
  return `${colors.muted}${parts.join(' · ')}${colors.reset}`;
}

// Build status indicator
export function buildStatus(success: boolean, errors?: string[]): string {
  if (success) {
    return `${colors.success}✓ Build OK${colors.reset}`;
  }
  let output = `${colors.error}✗ Build failed${colors.reset}\n`;
  if (errors) {
    errors.forEach(e => {
      output += `  ${colors.muted}${e}${colors.reset}\n`;
    });
  }
  return output;
}
