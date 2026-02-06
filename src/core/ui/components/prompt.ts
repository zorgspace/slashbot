/**
 * Prompt Components
 */

import { colors } from '../core';

export function prompt(): string {
  return `${colors.violet}${colors.bold}slashbot${colors.reset} ${colors.violetLight}>${colors.reset} `;
}

export function inputPrompt(): string {
  return `${colors.violet}>${colors.reset} `;
}

// Connector status message (transcribing, downloading, etc.)
export function connectorStatus(source: 'telegram' | 'discord', status: string): string {
  const label = source === 'telegram' ? 'Telegram' : 'Discord';
  return `${colors.muted}   [${label}] ${status}${colors.reset}`;
}

// Connector message display (Telegram/Discord) - step format with blue bullet
export function connectorMessage(source: 'telegram' | 'discord', message: string): string {
  const label = source === 'telegram' ? 'Telegram' : 'Discord';
  const lines = message.split('\n');

  // First line with blue bullet and source name (step format like tool calls)
  let output = `${colors.blue}●${colors.reset} ${colors.blue}${label}${colors.reset}`;

  // Message content on next line with indent
  output += `\n  ${colors.white}⎿  ${lines[0]}${colors.reset}`;

  // Continuation lines with indent
  for (let i = 1; i < lines.length; i++) {
    output += `\n     ${colors.white}${lines[i]}${colors.reset}`;
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
  return ''; // No separator line after task completion
}

export function responseStart(): string {
  const now = new Date().toLocaleTimeString('fr-FR');
  return `${colors.muted}[${now}]${colors.reset} `;
}

export function hintLine(): string {
  return `${colors.muted}? for help · Tab to autocomplete${colors.reset}`;
}
