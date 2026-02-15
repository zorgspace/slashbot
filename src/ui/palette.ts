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
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

const BADGES: Record<string, { label: string; color: string }> = {
  user:      { label: 'you', color: palette.user },
  assistant: { label: 'bot', color: palette.assistant },
  system:    { label: 'sys', color: palette.muted },
  warn:      { label: 'wrn', color: palette.warn },
  error:     { label: 'err', color: palette.error },
};

export function badgeFor(line: ChatLine): { label: string; color: string } {
  if (line.logLevel === 'warn') return BADGES.warn;
  if (line.logLevel === 'error') return BADGES.error;
  return BADGES[line.role] ?? BADGES.system;
}
