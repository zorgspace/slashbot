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

export interface ChatLine {
  id: string;
  role: 'system' | 'user' | 'assistant';
  text: string;
  label?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

const BADGES: Record<string, { label: string; color: string; bg: string }> = {
  user:      { label: 'you', color: palette.user,      bg: '#2a2240' },
  assistant: { label: 'bot', color: palette.assistant,  bg: '#1e2336' },
  system:    { label: 'sys', color: palette.muted,      bg: '#1e2030' },
  warn:      { label: 'wrn', color: palette.warn,       bg: '#2a2240' },
  error:     { label: 'err', color: palette.error,      bg: '#2d1a24' },
};

export function badgeFor(line: ChatLine): { label: string; color: string; bg: string } {
  if (line.logLevel === 'warn') return BADGES.warn;
  if (line.logLevel === 'error') return BADGES.error;
  return BADGES[line.role] ?? BADGES.system;
}
