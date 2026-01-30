/**
 * ANSI Color System for Slashbot
 * Theme: Violet dominant (#8A2BE2)
 */

// ANSI escape codes
const ESC = '\x1b[';
const RESET = `${ESC}0m`;

// Violet theme colors (using 256-color mode for better violet support)
export const colors = {
  // Primary violet shades
  violet: `${ESC}38;5;135m`,        // Main violet
  violetLight: `${ESC}38;5;177m`,   // Light violet (for thinking)
  violetDark: `${ESC}38;5;93m`,     // Dark violet

  // Semantic colors
  success: `${ESC}38;5;34m`,        // Darker green
  green: `${ESC}38;5;34m`,          // Darker green
  error: `${ESC}38;5;124m`,         // Darker red
  red: `${ESC}38;5;124m`,           // Darker red
  warning: `${ESC}38;5;214m`,       // Orange
  info: `${ESC}38;5;39m`,           // Cyan
  muted: `${ESC}38;5;244m`,         // Gray
  white: `${ESC}38;5;255m`,         // White

  // Background colors
  bgViolet: `${ESC}48;5;135m`,
  bgVioletDark: `${ESC}48;5;53m`,
  bgGreen: `${ESC}48;5;22m`,      // Dark green background for added lines
  bgRed: `${ESC}48;5;52m`,        // Dark red background for removed lines
  bgGreenLight: `${ESC}48;5;28m`, // Lighter green for highlights
  bgRedLight: `${ESC}48;5;88m`,   // Lighter red for highlights

  // Styles
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  italic: `${ESC}3m`,
  underline: `${ESC}4m`,

  // Reset
  reset: RESET,
};

// Color helper functions

export const divider = (title = '') => {
  const width = process.stdout.columns || 80;
  const line = '─'.repeat(width);
  let output = '';
  if (title) {
    output += `${colors.bold}${colors.violetLight} ${title.padEnd(width - 2, '─')}${colors.reset}\n`;
  }
  output += `${colors.bgViolet}${colors.white}${line}${colors.reset}\n`;
  return output;
};

export const c = {
  violet: (text: string) => `${colors.violet}${text}${RESET}`,
  violetLight: (text: string) => `${colors.violetLight}${text}${RESET}`,
  violetDark: (text: string) => `${colors.violetDark}${text}${RESET}`,
  success: (text: string) => `${colors.success}${text}${RESET}`,
  error: (text: string) => `${colors.error}${text}${RESET}`,
  warning: (text: string) => `${colors.warning}${text}${RESET}`,
  info: (text: string) => `${colors.info}${text}${RESET}`,
  muted: (text: string) => `${colors.muted}${text}${RESET}`,
  white: (text: string) => `${colors.white}${text}${RESET}`,
  bold: (text: string) => `${colors.bold}${text}${RESET}`,
  dim: (text: string) => `${colors.dim}${text}${RESET}`,
  italic: (text: string) => `${colors.italic}${text}${RESET}`,
};

// Box drawing characters for UI
export const box = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  teeRight: '├',
  teeLeft: '┤',
};

// Thin border line
export function thinBorder(): string {
  const width = Math.min(process.stdout.columns || 80, 60);
  return `${colors.muted}${'─'.repeat(width)}${colors.reset}`;
}

// UI Components
export function drawBox(title: string, content: string, color = colors.violet): string {
  const lines = content.split('\n');
  const maxWidth = Math.max(title.length + 4, ...lines.map(l => l.length)) + 2;
  const width = Math.min(maxWidth, process.stdout.columns - 4 || 80);

  const horizontalLine = box.horizontal.repeat(width - 2);
  const titlePadded = ` ${title} `.padEnd(width - 2, box.horizontal);

  let result = `${color}${box.topLeft}${titlePadded}${box.topRight}${colors.reset}\n`;

  for (const line of lines) {
    const paddedLine = line.padEnd(width - 4);
    result += `${color}${box.vertical}${colors.reset} ${paddedLine} ${color}${box.vertical}${colors.reset}\n`;
  }

  result += `${color}${box.bottomLeft}${horizontalLine}${box.bottomRight}${colors.reset}`;

  return result;
}

export function spinner(frame: number): string {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  return `${colors.violet}${frames[frame % frames.length]}${colors.reset}`;
}

export function prompt(): string {
  return `${colors.violet}${colors.bold}slashbot${colors.reset} ${colors.violetLight}>${colors.reset} `;
}

export function thinkingBlock(content: string): string {
  return drawBox('THINKING', content, colors.violetLight);
}

export function actionBlock(content: string): string {
  return drawBox('ACTION', content, colors.warning);
}

export function responseBlock(content: string): string {
  return `${colors.white}${content}${colors.reset}`;
}

export function errorBlock(message: string): string {
  return `${colors.error}${colors.bold}[ERROR]${colors.reset} ${colors.error}${message}${colors.reset}`;
}

export function successBlock(message: string): string {
  return `${colors.success}${colors.bold}[OK]${colors.reset} ${colors.success}${message}${colors.reset}`;
}

// ASCII Art Skull Logo
export function getLogo(): string {
  return `${colors.violet} ▄▄▄▄▄▄▄
▐░░░░░░░▌
▐░▀░░░▀░▌
▐░░░▄░░░▌
▐░░▀▀▀░░▌
 ▀▀▀▀▀▀▀${colors.reset}`;
}

export interface BannerOptions {
  version?: string;
  workingDir?: string;
  contextFile?: string | null;
  tasksCount?: number;
}

export function banner(options: BannerOptions = {}): string {
  const { version = 'v1.0.0', workingDir, contextFile, tasksCount = 0 } = options;
  const cwd = workingDir || process.cwd();
  const shortCwd = cwd.replace(process.env.HOME || '', '~');

  const logoLines = [
    `${colors.violet} ▄▄▄▄▄▄▄${colors.reset}`,
    `${colors.violet}▐░░░░░░░▌${colors.reset}`,
    `${colors.violet}▐░▀░░░▀░▌${colors.reset}`,
    `${colors.violet}▐░░░▄░░░▌${colors.reset}`,
    `${colors.violet}▐░░▀▀▀░░▌${colors.reset}`,
    `${colors.violet} ▀▀▀▀▀▀▀${colors.reset}`,
  ];

  const infoLines = [
    `${colors.white}${colors.bold}Slashbot${colors.reset} ${colors.muted}${version}${colors.reset}`,
    `${colors.muted}Grok 4.1 · X.AI · ${shortCwd}${colors.reset}`,
    contextFile ? `${colors.muted}Context: ${contextFile}${colors.reset}` : '',
    tasksCount > 0 ? `${colors.muted}${tasksCount} task(s) scheduled${colors.reset}` : '',
    `${colors.muted}? for help · Tab to autocomplete${colors.reset}`,
  ].filter(line => line !== '');

  let result = '\n';
  for (let i = 0; i < Math.max(logoLines.length, infoLines.length); i++) {
    const logoLine = logoLines[i] || '         ';
    const infoLine = infoLines[i] || '';
    result += `${logoLine}  ${infoLine}\n`;
  }

  // Add thin border at end
  const width = Math.min(process.stdout.columns || 80, 60);
  result += `${colors.muted}${'─'.repeat(width)}${colors.reset}\n`;

  return result;
}

export function inputPrompt(): string {
  return `${colors.violet}╭─${colors.reset} `;
}

export function inputClose(): string {
  const width = Math.min(process.stdout.columns || 80, 60);
  return `${colors.muted}${'─'.repeat(width)}${colors.reset}`;
}

export function responseStart(): string {
  return '';
}

export function hintLine(): string {
  return `${colors.muted}? for help · Tab to autocomplete${colors.reset}`;
}

// Thinking animation
export class ThinkingAnimation {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frameIndex = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private text = '';
  private startTime: number = 0;
  private contextPath: string = '';

  start(initialText = 'Thinking...', contextPath?: string): void {
    this.text = initialText;
    this.frameIndex = 0;
    this.startTime = Date.now();
    this.contextPath = contextPath || '';
    process.stdout.write(`${colors.violetLight}${this.frames[0]} ${this.text}${colors.reset}`);

    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      process.stdout.write(`\r\x1b[K${colors.violetLight}${this.frames[this.frameIndex]} ${this.text}${colors.reset}`);
    }, 80);
  }

  update(text: string): void {
    this.text = text.slice(0, 60);
  }

  stop(): void {
    // Only output if animation was actually running (interval exists)
    const wasRunning = this.interval !== null;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Only write output if we were actually running
    if (wasRunning) {
      const duration = this.formatDuration(Date.now() - this.startTime);
      const shortPath = this.contextPath.replace(process.env.HOME || '', '~');
      const location = shortPath ? ` · ${shortPath}` : '';
      process.stdout.write(`\r\x1b[K${colors.muted}${duration}${location}${colors.reset}\n`);
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const m = minutes % 60;
      const s = seconds % 60;
      return `${hours}h ${m}m ${s}s`;
    } else if (minutes > 0) {
      const s = seconds % 60;
      return `${minutes}m ${s}s`;
    } else if (seconds > 0) {
      return `${seconds}s`;
    } else {
      return `${ms}ms`;
    }
  }
}

// Claude Code-style output formatting
export const step = {
  // Assistant message/thought (white bullet)
  message: (text: string) => {
    console.log(`\n${colors.white}●${colors.reset} ${text}`);
  },

  // Tool call: ● ToolName(args)
  tool: (toolName: string, args?: string) => {
    const argsStr = args ? `(${args})` : '';
    console.log(`\n${colors.white}●${colors.reset} ${colors.bold}${toolName}${colors.reset}${argsStr}`);
  },

  // Tool result: ⎿  Result text (indented, supports multiline)
  result: (text: string, isError = false) => {
    const lines = text.split('\n');
    const color = isError ? colors.error : colors.muted;
    lines.forEach((line, i) => {
      const prefix = i === 0 ? '⎿ ' : '  ';
      console.log(`  ${color}${prefix}${line}${colors.reset}`);
    });
  },

  // Read action: ● Read(file_path) - green bullet
  read: (filePath: string) => {
    console.log(`\n${colors.success}●${colors.reset} ${colors.bold}Read${colors.reset}(${filePath})`);
  },

  // Read result: ⎿  Read N lines - grey/muted
  readResult: (lineCount: number) => {
    console.log(`  ${colors.muted}⎿  Read ${lineCount} lines${colors.reset}`);
  },

  // Grep action: ● Grep(pattern, file)
  grep: (pattern: string, filePattern?: string) => {
    const args = filePattern ? `"${pattern}", "${filePattern}"` : `"${pattern}"`;
    console.log(`\n${colors.white}●${colors.reset} ${colors.bold}Grep${colors.reset}(${args})`);
  },

  // Grep result: ⎿  Found N matches
  grepResult: (matches: number, preview?: string) => {
    if (matches === 0) {
      console.log(`  ${colors.muted}⎿  No matches found${colors.reset}`);
    } else {
      console.log(`  ${colors.muted}⎿  Found ${matches} match${matches > 1 ? 'es' : ''}${colors.reset}`);
      if (preview) {
        preview.split('\n').slice(0, 5).forEach(line => {
          console.log(`     ${colors.muted}${line}${colors.reset}`);
        });
      }
    }
  },

  // Bash/Exec action: ● Bash(command)
  bash: (command: string) => {
    // Truncate long commands
    const displayCmd = command.length > 60 ? command.slice(0, 57) + '...' : command;
    console.log(`\n${colors.white}●${colors.reset} ${colors.bold}Bash${colors.reset}(${displayCmd})`);
  },

  // Bash result: ⎿  $ command \n output
  bashResult: (command: string, output: string, exitCode = 0) => {
    if (exitCode !== 0) {
      console.log(`  ${colors.error}⎿  Error: Exit code ${exitCode}${colors.reset}`);
      console.log(`     ${colors.muted}$ ${command}${colors.reset}`);
    } else {
      console.log(`  ${colors.muted}⎿  $ ${command}${colors.reset}`);
    }
    if (output) {
      output.split('\n').slice(0, 10).forEach(line => {
        console.log(`     ${colors.muted}${line}${colors.reset}`);
      });
    }
  },

  // Edit/Update action: ● Update(file_path)
  update: (filePath: string) => {
    console.log(`\n${colors.white}●${colors.reset} ${colors.bold}Update${colors.reset}(${filePath})`);
  },

  // Edit result with diff display
  updateResult: (success: boolean, linesRemoved: number, linesAdded: number, context?: { before?: string[]; after?: string[]; lineStart?: number }) => {
    if (!success) {
      console.log(`  ${colors.error}⎿  Failed - pattern not found${colors.reset}`);
      return;
    }

    if (linesRemoved > 0 && linesAdded === 0) {
      console.log(`  ${colors.muted}⎿  Removed ${linesRemoved} line${linesRemoved > 1 ? 's' : ''}${colors.reset}`);
    } else if (linesAdded > 0 && linesRemoved === 0) {
      console.log(`  ${colors.muted}⎿  Added ${linesAdded} line${linesAdded > 1 ? 's' : ''}${colors.reset}`);
    } else {
      console.log(`  ${colors.muted}⎿  Updated${colors.reset}`);
    }

    // Show context with line numbers if provided
    if (context) {
      const startLine = context.lineStart || 1;
      context.before?.forEach((line, i) => {
        const lineNum = String(startLine + i).padStart(4, ' ');
        console.log(`      ${colors.muted}${lineNum}${colors.reset}   ${line}`);
      });
      context.after?.forEach((line, i) => {
        const lineNum = String(startLine + (context.before?.length || 0) + i).padStart(4, ' ');
        console.log(`      ${colors.muted}${lineNum}${colors.reset} ${colors.success}- ${line}${colors.reset}`);
      });
    }
  },

  // Create action: ● Write(file_path)
  write: (filePath: string) => {
    console.log(`\n${colors.white}●${colors.reset} ${colors.bold}Write${colors.reset}(${filePath})`);
  },

  // Create result
  writeResult: (success: boolean, lineCount?: number) => {
    if (success) {
      const info = lineCount ? ` (${lineCount} lines)` : '';
      console.log(`  ${colors.muted}⎿  Created${info}${colors.reset}`);
    } else {
      console.log(`  ${colors.error}⎿  Failed to create file${colors.reset}`);
    }
  },

  // Schedule action
  schedule: (name: string, cron: string) => {
    console.log(`\n${colors.white}●${colors.reset} ${colors.bold}Schedule${colors.reset}(${name}, "${cron}")`);
  },

  // Skill action
  skill: (name: string) => {
    console.log(`\n${colors.white}●${colors.reset} ${colors.bold}Skill${colors.reset}(${name})`);
  },

  // Success result (green checkmark style)
  success: (message: string) => {
    console.log(`  ${colors.success}⎿  ${message}${colors.reset}`);
  },

  // Error result - red bullet and text
  error: (message: string) => {
    console.log(`  ${colors.error}⎿  Error: ${message}${colors.reset}`);
  },

  // Diff display with removed/added lines (Claude Code style)
  diff: (removed: string[], added: string[], filePath?: string, lineStart = 1) => {
    removed.forEach((line, i) => {
      const lineNum = String(lineStart + i).padStart(4, ' ');
      console.log(`      ${colors.muted}${lineNum}${colors.reset} ${colors.error}- ${line}${colors.reset}`);
    });
    added.forEach((line, i) => {
      const lineNum = String(lineStart + removed.length + i).padStart(4, ' ');
      console.log(`      ${colors.muted}${lineNum}${colors.reset} ${colors.success}+ ${line}${colors.reset}`);
    });
  },

  // Thinking/status message
  thinking: (text: string) => {
    console.log(`\n${colors.white}●${colors.reset} ${colors.muted}${text}${colors.reset}`);
  },

  end: () => {}
};

// Status line (muted, with timing info)
export function statusLine(action: string, elapsed?: string, tokens?: number, thinkTime?: string): string {
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
    errors.slice(0, 5).forEach(e => {
      output += `  ${colors.muted}${e}${colors.reset}\n`;
    });
  }
  return output;
}

/**
 * File Viewer - Claude Code style file display with line numbers and diff highlighting
 */
export interface DiffLine {
  lineNumber: number;
  content: string;
  type: 'unchanged' | 'added' | 'removed' | 'context';
}

export class FileViewer {
  private maxLineWidth: number;

  constructor() {
    this.maxLineWidth = Math.min(process.stdout.columns || 80, 100) - 10;
  }

  /**
   * Format a line number with padding
   */
  private formatLineNumber(num: number, maxNum: number): string {
    const padding = String(maxNum).length;
    return String(num).padStart(padding, ' ');
  }

  /**
   * Display file content with line numbers
   */
  displayFile(filePath: string, content: string, startLine = 1, endLine?: number): void {
    const lines = content.split('\n');
    const maxLine = endLine || lines.length;
    const displayLines = lines.slice(startLine - 1, endLine);

    // Header
    console.log(`${colors.muted}╭─ ${filePath}${colors.reset}`);

    displayLines.forEach((line, i) => {
      const lineNum = startLine + i;
      const numStr = this.formatLineNumber(lineNum, maxLine);
      const truncatedLine = line.length > this.maxLineWidth
        ? line.slice(0, this.maxLineWidth - 3) + '...'
        : line;
      console.log(`${colors.muted}│${colors.reset} ${colors.muted}${numStr}${colors.reset} ${colors.white}${truncatedLine}${colors.reset}`);
    });

    console.log(`${colors.muted}╰─${colors.reset}`);
  }

  /**
   * Display a diff between old and new content with colored backgrounds
   */
  displayDiff(filePath: string, oldContent: string, newContent: string): void {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const diffLines = this.computeDiff(oldLines, newLines);

    if (diffLines.length === 0) {
      console.log(`${colors.muted}No changes${colors.reset}`);
      return;
    }

    const maxLineNum = Math.max(...diffLines.map(d => d.lineNumber));

    // Header
    console.log(`${colors.muted}╭─ ${filePath}${colors.reset}`);

    for (const diff of diffLines) {
      const numStr = this.formatLineNumber(diff.lineNumber, maxLineNum);
      const truncatedContent = diff.content.length > this.maxLineWidth
        ? diff.content.slice(0, this.maxLineWidth - 3) + '...'
        : diff.content;

      // Pad the line to fill the width for background color
      const paddedContent = truncatedContent.padEnd(this.maxLineWidth, ' ');

      switch (diff.type) {
        case 'removed':
          console.log(`${colors.muted}│${colors.reset} ${colors.error}${numStr}${colors.reset} ${colors.bgRed}${colors.white}- ${paddedContent}${colors.reset}`);
          break;
        case 'added':
          console.log(`${colors.muted}│${colors.reset} ${colors.success}${numStr}${colors.reset} ${colors.bgGreen}${colors.white}+ ${paddedContent}${colors.reset}`);
          break;
        case 'context':
          console.log(`${colors.muted}│${colors.reset} ${colors.muted}${numStr}${colors.reset}   ${colors.muted}${truncatedContent}${colors.reset}`);
          break;
        default:
          console.log(`${colors.muted}│${colors.reset} ${colors.muted}${numStr}${colors.reset}   ${colors.white}${truncatedContent}${colors.reset}`);
      }
    }

    console.log(`${colors.muted}╰─${colors.reset}`);
  }

  /**
   * Simple diff computation - find removed and added lines
   */
  private computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
    const result: DiffLine[] = [];
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);

    let oldIdx = 0;
    let newIdx = 0;
    let lineNum = 1;

    // Find the first difference
    while (oldIdx < oldLines.length && newIdx < newLines.length && oldLines[oldIdx] === newLines[newIdx]) {
      oldIdx++;
      newIdx++;
      lineNum++;
    }

    // Add context before (up to 3 lines)
    const contextStart = Math.max(0, oldIdx - 3);
    for (let i = contextStart; i < oldIdx; i++) {
      result.push({
        lineNumber: i + 1,
        content: oldLines[i],
        type: 'context'
      });
    }

    // Find removed lines
    const removedStart = oldIdx;
    while (oldIdx < oldLines.length && !newSet.has(oldLines[oldIdx])) {
      result.push({
        lineNumber: oldIdx + 1,
        content: oldLines[oldIdx],
        type: 'removed'
      });
      oldIdx++;
    }

    // Find added lines
    while (newIdx < newLines.length && !oldSet.has(newLines[newIdx])) {
      result.push({
        lineNumber: newIdx + 1,
        content: newLines[newIdx],
        type: 'added'
      });
      newIdx++;
    }

    // Add context after (up to 3 lines)
    const contextEnd = Math.min(newLines.length, newIdx + 3);
    for (let i = newIdx; i < contextEnd; i++) {
      result.push({
        lineNumber: i + 1,
        content: newLines[i],
        type: 'context'
      });
    }

    return result;
  }

  /**
   * Display inline edit preview (old -> new)
   */
  displayInlineEdit(filePath: string, oldText: string, newText: string, context?: string): void {
    console.log(`${colors.muted}╭─ Edit: ${filePath}${colors.reset}`);

    // Show context if provided
    if (context) {
      const contextLines = context.split('\n').slice(0, 2);
      contextLines.forEach(line => {
        const truncated = line.slice(0, this.maxLineWidth);
        console.log(`${colors.muted}│   ${truncated}${colors.reset}`);
      });
    }

    // Show removed lines
    const oldLines = oldText.split('\n');
    oldLines.forEach(line => {
      const truncated = line.slice(0, this.maxLineWidth);
      const padded = truncated.padEnd(this.maxLineWidth, ' ');
      console.log(`${colors.muted}│${colors.reset} ${colors.bgRed}${colors.white}- ${padded}${colors.reset}`);
    });

    // Show added lines
    const newLines = newText.split('\n');
    newLines.forEach(line => {
      const truncated = line.slice(0, this.maxLineWidth);
      const padded = truncated.padEnd(this.maxLineWidth, ' ');
      console.log(`${colors.muted}│${colors.reset} ${colors.bgGreen}${colors.white}+ ${padded}${colors.reset}`);
    });

    console.log(`${colors.muted}╰─${colors.reset}`);
  }
}

// Global file viewer instance
export const fileViewer = new FileViewer();

