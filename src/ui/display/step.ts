/**
 * Step Display - Claude Code-style output formatting
 */

import { colors } from '../core';

// Claude Code-style output formatting
export const step = {
  // Assistant message/thought (violet bullet)
  message: (text: string) => {
    console.log(`${colors.violet}●${colors.reset} ${text}`);
  },

  // Tool call: ● ToolName(args) - violet bullet and name
  tool: (toolName: string, args?: string) => {
    const argsStr = args ? `(${args})` : '';
    console.log(
      `${colors.violet}●${colors.reset} ${colors.violet}${toolName}${colors.reset}${argsStr}`,
    );
  },

  // Tool result: ⎿  Result text (indented, white for reads, green for success messages)
  result: (text: string, isError = false) => {
    const lines = text.split('\n');
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
  read: (filePath: string) => {
    console.log(
      `${colors.violet}●${colors.reset} ${colors.violet}Read${colors.reset}(${filePath})`,
    );
  },

  // Read result: ⎿  Read N lines - white
  readResult: (lineCount: number) => {
    console.log(`  ${colors.white}⎿  Read ${lineCount} lines${colors.reset}`);
  },

  // Grep action: ● Grep(pattern, file) - violet bullet and name
  grep: (pattern: string, filePattern?: string) => {
    const args = filePattern ? `"${pattern}", "${filePattern}"` : `"${pattern}"`;
    console.log(`${colors.violet}●${colors.reset} ${colors.violet}Grep${colors.reset}(${args})`);
  },

  // Grep result: ⎿  Found N matches - white (read operation)
  grepResult: (matches: number, preview?: string) => {
    if (matches === 0) {
      console.log(`  ${colors.white}⎿  No matches found${colors.reset}`);
    } else {
      console.log(
        `  ${colors.white}⎿  Found ${matches} match${matches > 1 ? 'es' : ''}${colors.reset}`,
      );
      if (preview) {
        preview.split('\n').forEach(line => {
          console.log(`     ${colors.white}${line}${colors.reset}`);
        });
      }
    }
  },

  // Bash/Exec action: ● Exec(command) - violet bullet and name
  bash: (command: string) => {
    console.log(
      `${colors.violet}●${colors.reset} ${colors.violet}Exec${colors.reset}(${command})`,
    );
  },

  // Bash result: ⎿  output - white for general, green for success, red for errors
  bashResult: (command: string, output: string, exitCode = 0) => {
    const isError = exitCode !== 0 || output.startsWith('Error:');
    const isSuccess =
      output.includes('No errors') || output.includes('success') || output.includes('✓');
    if (isError) {
      console.log(`  ${colors.error}⎿  Error: Exit code ${exitCode}${colors.reset}`);
      console.log(`     ${colors.muted}$ ${command}${colors.reset}`);
    } else if (isSuccess) {
      console.log(`  ${colors.green}⎿  ✓ ${output.trim().split('\n')[0]}${colors.reset}`);
      return; // Don't show full output for simple success
    } else {
      console.log(`  ${colors.white}⎿  $ ${command}${colors.reset}`);
    }
    if (output) {
      const lines = output.split('\n');
      lines.forEach(line => {
        const lineColor = isError ? colors.error : colors.white;
        console.log(`     ${lineColor}${line}${colors.reset}`);
      });
    }
  },

  // Edit/Update action: ● Edit(file_path) - violet bullet
  update: (filePath: string) => {
    console.log(
      `${colors.violet}●${colors.reset} ${colors.violet}Edit${colors.reset}(${filePath})`,
    );
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
  write: (filePath: string) => {
    console.log(
      `${colors.violet}●${colors.reset} ${colors.violet}Create${colors.reset}(${filePath})`,
    );
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
  schedule: (name: string, cron: string) => {
    console.log(
      `${colors.violet}●${colors.reset} ${colors.violet}Schedule${colors.reset}(${name}, "${cron}")`,
    );
  },

  // Skill action - violet bullet
  skill: (name: string) => {
    console.log(`${colors.violet}●${colors.reset} ${colors.violet}Skill${colors.reset}(${name})`);
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
    console.log(`${colors.white}●${colors.reset} ${colors.muted}${text}${colors.reset}`);
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
