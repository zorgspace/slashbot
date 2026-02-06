/**
 * Box Drawing Components
 */

import { colors } from '../core';

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
