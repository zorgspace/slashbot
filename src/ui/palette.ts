/**
 * @module ui/palette
 *
 * Shared color palette and chat line types for the Slashbot TUI.
 * Provides the Tokyo Night-inspired color tokens used by every UI
 * component, along with the {@link ChatLine} interface and badge
 * helpers for message rendering.
 *
 * @see {@link palette} -- Color token map
 * @see {@link ChatLine} -- Chat message data structure
 * @see {@link badgeFor} -- Badge color/label resolver
 */

/** Color token map following a Tokyo Night-inspired theme. */
export const palette = {
  accent: '#bb9af7',
  text: '#c0caf5',
  muted: '#565f89',
  dim: '#3b4261',
  inputBg: '#2e3347',
  inputFg: '#a9b1d6',
  user: '#bb9af7',
  assistant: '#c0caf5',
  success: '#9ece6a',
  warn: '#9d7cd8',
  error: '#f7768e',
};

/** Represents a single line of chat output in the TUI. */
export interface ChatLine {
  /** Unique identifier for React keying. */
  id: string;
  /** Sender role: system message, user input, or assistant response. */
  role: 'system' | 'user' | 'assistant';
  /** The text content of the message. */
  text: string;
  /** Optional display label override (e.g. connector name). */
  label?: string;
  /** Optional severity level; affects badge and text coloring. */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

const BADGES: Record<string, { label: string; color: string; bg: string }> = {
  user:      { label: 'you', color: palette.user,      bg: '#2a2240' },
  assistant: { label: 'bot', color: palette.assistant,  bg: '#1e2336' },
  system:    { label: 'sys', color: palette.muted,      bg: '#1e2030' },
  warn:      { label: 'wrn', color: palette.warn,       bg: '#2a2240' },
  error:     { label: 'err', color: palette.error,      bg: '#2d1a24' },
};

/**
 * Returns the badge configuration (label, foreground color, background color)
 * for a given chat line based on its role and log level.
 *
 * @param line - The chat line to resolve a badge for.
 * @returns Badge with label text, foreground color, and background color.
 */
export function badgeFor(line: ChatLine): { label: string; color: string; bg: string } {
  if (line.logLevel === 'warn') return BADGES.warn;
  if (line.logLevel === 'error') return BADGES.error;
  return BADGES[line.role] ?? BADGES.system;
}
