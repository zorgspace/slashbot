/**
 * Prompt Components
 */

import { colors } from '../core';

// Sticky plan reference (set later to avoid circular dependency)
let _stickyPlanRef: { render: () => string } | null = null;

export function setStickyPlanRef(ref: { render: () => string }): void {
  _stickyPlanRef = ref;
}

export function prompt(): string {
  return `${colors.violet}${colors.bold}slashbot${colors.reset} ${colors.violetLight}>${colors.reset} `;
}

export function inputPrompt(): string {
  // Include sticky plan if visible
  if (_stickyPlanRef) {
    const planLine = _stickyPlanRef.render();
    if (planLine) {
      return `${planLine}${colors.violet}╰─${colors.reset} `;
    }
  }
  return `${colors.violet}╭─${colors.reset} `;
}

// Connector message display (Telegram/Discord)
export function connectorMessage(source: 'telegram' | 'discord', message: string): string {
  const label = source === 'telegram' ? 'Telegram' : 'Discord';
  const truncated = message.length > 80 ? message.slice(0, 77) + '...' : message;
  return `\n${colors.violet}╭─${colors.reset} ${colors.info}[${label}]${colors.reset} ${truncated}`;
}

export function connectorResponse(source: 'telegram' | 'discord', response: string): string {
  const label = source === 'telegram' ? 'Telegram' : 'Discord';
  const lines = response.split('\n');
  const preview = lines.slice(0, 3).join('\n');
  const truncated = preview.length > 200 ? preview.slice(0, 197) + '...' : preview;
  const moreLines = lines.length > 3 ? ` (+${lines.length - 3} lines)` : '';
  return `${colors.muted}⎿  Sent to ${label}${moreLines}${colors.reset}\n${colors.muted}${truncated}${colors.reset}`;
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
