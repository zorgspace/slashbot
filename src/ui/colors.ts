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
  success: `${ESC}38;5;82m`,        // Green
  green: `${ESC}38;5;82m`,          // Green
  error: `${ESC}38;5;196m`,         // Red
  red: `${ESC}38;5;196m`,           // Red
  warning: `${ESC}38;5;214m`,       // Orange
  info: `${ESC}38;5;39m`,           // Cyan
  muted: `${ESC}38;5;244m`,         // Gray
  white: `${ESC}38;5;255m`,         // White

  // Background colors
  bgViolet: `${ESC}48;5;135m`,
  bgVioletDark: `${ESC}48;5;53m`,

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
  isAuthorized?: boolean;
}

export function banner(options: BannerOptions = {}): string {
  const { version = 'v1.0.0', workingDir, contextFile, tasksCount = 0, isAuthorized = false } = options;
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
    isAuthorized ? '' : `${colors.muted}Code: /auth to authorize editing${colors.reset}`,
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
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    const duration = this.formatDuration(Date.now() - this.startTime);
    const shortPath = this.contextPath.replace(process.env.HOME || '', '~');
    const location = shortPath ? ` · ${shortPath}` : '';
    process.stdout.write(`\r\x1b[K${colors.muted}${duration}${location}${colors.reset}\n`);
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

// Step-by-step process display with colored dots (compact)
export const step = {
  // Search actions (gray dot) - inline result
  search: (label: string, detail?: string) => {
    const detailStr = detail ? ` ${colors.muted}${detail}${colors.reset}` : '';
    process.stdout.write(`${colors.muted}●${colors.reset} ${label}${detailStr}`);
  },
  // Edit actions (red dot) - inline result
  edit: (label: string, detail?: string) => {
    const detailStr = detail ? ` ${colors.muted}${detail}${colors.reset}` : '';
    process.stdout.write(`${colors.error}●${colors.reset} ${label}${detailStr}`);
  },
  // Exec/action (green dot) - inline result
  action: (label: string, detail?: string) => {
    const detailStr = detail ? ` ${colors.muted}${detail}${colors.reset}` : '';
    process.stdout.write(`${colors.success}●${colors.reset} ${label}${detailStr}`);
  },
  success: (label: string, detail?: string) => {
    const detailStr = detail ? ` ${colors.muted}${detail}${colors.reset}` : '';
    console.log(` ${colors.success}●${colors.reset} ${label}${detailStr}`);
  },
  error: (label: string, detail?: string) => {
    const detailStr = detail ? ` ${colors.muted}${detail}${colors.reset}` : '';
    console.log(` ${colors.error}✗${colors.reset} ${label}${detailStr}`);
  },
  info: (label: string) => {
    console.log(`  ${colors.muted}${label}${colors.reset}`);
  },
  // Show diff with red/green lines (more compact)
  diff: (removed: string, added: string) => {
    console.log(); // newline after action label
    const removedLines = removed.split('\n').slice(0, 2);
    const addedLines = added.split('\n').slice(0, 2);
    removedLines.forEach(line => {
      if (line.trim()) console.log(`  ${colors.error}- ${line.slice(0, 60)}${colors.reset}`);
    });
    addedLines.forEach(line => {
      if (line.trim()) console.log(`  ${colors.success}+ ${line.slice(0, 60)}${colors.reset}`);
    });
  },
  end: () => {} // no extra newline
};

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
