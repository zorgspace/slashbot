/**
 * Prompt Components
 */

import { colors } from '../core';

export function prompt(): string {
  return `${colors.violet}${colors.bold}slashbot${colors.reset} ${colors.violetLight}>${colors.reset} `;
}

export function inputPrompt(): string {
  return `${colors.violet}╭─${colors.reset} `;
}

// Connector status message (transcribing, downloading, etc.)
export function connectorStatus(source: 'telegram' | 'discord', status: string): string {
  const label = source === 'telegram' ? 'Telegram' : 'Discord';
  return `${colors.muted}   [${label}] ${status}${colors.reset}`;
}

// Connector message display (Telegram/Discord) - CLI-style prompt for user input
export function connectorMessage(source: 'telegram' | 'discord', message: string): string {
  const label = source === 'telegram' ? 'Telegram' : 'Discord';
  const lines = message.split('\n');

  // First line with connector label in prompt style
  let output = `${colors.violet}╭─${colors.reset} ${colors.info}[${label}]${colors.reset} ${lines[0]}`;

  // Continuation lines with indent
  for (let i = 1; i < lines.length; i++) {
    output += `\n   ${lines[i]}`;
  }

  return output;
}

// Connector response sent confirmation
export function connectorResponse(source: 'telegram' | 'discord', response: string): string {
  const label = source === 'telegram' ? 'Telegram' : 'Discord';
  const lines = response.split('\n');
  const preview = lines.slice(0, 2).join('\n');
  const truncated = preview.length > 100 ? preview.slice(0, 97) + '...' : preview;
  const moreLines = lines.length > 2 ? ` (+${lines.length - 2} lines)` : '';
  return `${colors.muted}⎿  Sent to ${label}${moreLines}${colors.reset}\n${colors.muted}   ${truncated.replace(/\n/g, '\n   ')}${colors.reset}`;
}

// Connector action status display
export function connectorAction(action: string, success: boolean): string {
  const icon = success ? `${colors.success}✓${colors.reset}` : `${colors.error}✗${colors.reset}`;
  return `${colors.muted}│${colors.reset} ${icon} ${action}`;
}

export function inputClose(): string {
  const width = Math.min(process.stdout.columns || 80, 60);
  return `${colors.muted}${'─'.repeat(width)}${colors.reset}`;
}

export function responseStart(): string {
  const now = new Date().toLocaleTimeString('fr-FR');
  return `${colors.muted}[${now}]${colors.reset} `;
}

export function hintLine(): string {
  return `${colors.muted}? for help · Tab to autocomplete${colors.reset}`;
}
