/**
 * Heartbeat System Types
 *
 * Inspired by OpenClaw's heartbeat system - periodic agent reflection
 * that allows the AI to surface alerts and take proactive actions.
 */

/**
 * Active hours configuration - restrict heartbeats to certain times
 */
export interface ActiveHours {
  start: string; // HH:MM format (24h)
  end: string; // HH:MM format (24h)
  timezone?: string; // IANA timezone, defaults to local
}

/**
 * Heartbeat visibility settings
 */
export interface HeartbeatVisibility {
  showOk?: boolean; // Show OK acknowledgments (default: false)
  showAlerts?: boolean; // Show alert content (default: true)
  useIndicator?: boolean; // Emit indicator events for UI (default: true)
}

/**
 * Heartbeat configuration
 */
export interface HeartbeatConfig {
  enabled?: boolean; // Enable heartbeat system (default: true)
  period?: string; // Interval as duration string: "30m", "1h", "2h" (default: "30m")
  prompt?: string; // Custom heartbeat instruction
  model?: string; // Optional model override for heartbeat runs
  activeHours?: ActiveHours; // Restrict to certain hours
  ackMaxChars?: number; // Max chars after OK before suppressing (default: 300)
  visibility?: HeartbeatVisibility; // Visibility settings
  includeReasoning?: boolean; // Include reasoning in output (default: false)
}

/**
 * Full heartbeat configuration
 */
export interface FullHeartbeatConfig extends HeartbeatConfig {}

/**
 * Heartbeat response type - what the agent returned
 */
export type HeartbeatResponseType = 'ok' | 'alert' | 'error';

/**
 * Heartbeat execution result
 */
export interface HeartbeatResult {
  type: HeartbeatResponseType;
  content: string; // The agent's response
  reasoning?: string; // Thinking/reasoning if available
  timestamp: Date;
  duration: number; // Execution time in ms
  actions?: HeartbeatAction[]; // Actions taken during heartbeat
}

/**
 * Action taken during heartbeat reflection
 */
export interface HeartbeatAction {
  type: string;
  description: string;
  success: boolean;
  output?: string;
}

/**
 * Heartbeat state persisted to disk
 */
export interface HeartbeatState {
  lastRun?: string; // ISO timestamp
  lastResult?: HeartbeatResponseType;
  consecutiveOks: number; // Track consecutive OK responses
  totalRuns: number;
  totalAlerts: number;
}

/**
 * Default heartbeat prompt - mirrors OpenClaw defaults.
 */
export const HEARTBEAT_TOKEN = 'HEARTBEAT_OK';
export const DEFAULT_HEARTBEAT_ACK_MAX_CHARS = 300;
export const DEFAULT_HEARTBEAT_PROMPT =
  'Follow the provided HEARTBEAT.md content strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply only HEARTBEAT_OK.';

/**
 * Parse duration string to milliseconds
 * Supports: "30m", "1h", "2h30m", "1d", etc.
 */
export function parseDuration(duration: string): number {
  const regex = /(\d+)([dhms])/gi;
  let total = 0;
  let match;

  while ((match = regex.exec(duration)) !== null) {
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case 'd':
        total += value * 24 * 60 * 60 * 1000;
        break;
      case 'h':
        total += value * 60 * 60 * 1000;
        break;
      case 'm':
        total += value * 60 * 1000;
        break;
      case 's':
        total += value * 1000;
        break;
    }
  }

  // Default to 30 minutes if invalid
  return total > 0 ? total : 30 * 60 * 1000;
}

/**
 * Format duration for display
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * Check if HEARTBEAT.md content is effectively empty.
 * Missing/undefined content is treated as non-empty so heartbeat can still run.
 */
export function isHeartbeatContentEffectivelyEmpty(content: string | undefined | null): boolean {
  if (content === undefined || content === null || typeof content !== 'string') {
    return false;
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#+(\s|$)/.test(trimmed)) continue;
    if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) continue;
    return false;
  }
  return true;
}

const ACTIVE_HOURS_TIME_PATTERN = /^([01]\d|2[0-3]|24):([0-5]\d)$/;

/**
 * Check if current time is within active hours.
 * Supports object format { start: "HH:MM", end: "HH:MM", timezone?: "..." }
 * and string format "HH:MM-HH:MM" (local time).
 */
export function isWithinActiveHours(activeHours?: ActiveHours | string): boolean {
  if (!activeHours) return true;

  let startTime: string | undefined;
  let endTime: string | undefined;
  let timezone: string | undefined;
  if (typeof activeHours === 'string') {
    const parts = activeHours.split('-');
    if (parts.length !== 2) return true;
    startTime = parts[0].trim();
    endTime = parts[1].trim();
  } else {
    if (!activeHours.start || !activeHours.end) return true;
    startTime = activeHours.start;
    endTime = activeHours.end;
    timezone = activeHours.timezone;
  }

  if (
    !startTime ||
    !endTime ||
    !ACTIVE_HOURS_TIME_PATTERN.test(startTime) ||
    !ACTIVE_HOURS_TIME_PATTERN.test(endTime)
  ) {
    return true;
  }

  const parseMinutes = (raw: string, allow24: boolean): number | null => {
    const [hourStr, minuteStr] = raw.split(':');
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (hour === 24) {
      if (!allow24 || minute !== 0) return null;
      return 24 * 60;
    }
    return hour * 60 + minute;
  };

  const startMinutes = parseMinutes(startTime, false);
  const endMinutes = parseMinutes(endTime, true);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
    return true;
  }

  const resolveMinutesInTimeZone = (timeZone?: string): number | null => {
    try {
      if (!timeZone) {
        const now = new Date();
        return now.getHours() * 60 + now.getMinutes();
      }
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date());

      const map: Record<string, string> = {};
      for (const part of parts) {
        if (part.type !== 'literal') map[part.type] = part.value;
      }
      const hour = Number(map.hour);
      const minute = Number(map.minute);
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
      return hour * 60 + minute;
    } catch {
      return null;
    }
  };

  const currentMinutes = resolveMinutesInTimeZone(timezone);
  if (currentMinutes === null) {
    return true;
  }

  if (endMinutes > startMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  if (endMinutes < startMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  return true;
}

/**
 * Determine heartbeat response type
 */
export function parseHeartbeatResponse(
  response: string,
  ackMaxChars: number = DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
): { type: HeartbeatResponseType; content: string } {
  const trimmed = (response || '').trim();
  if (!trimmed) return { type: 'ok', content: '' };

  const stripTokenAtEdges = (raw: string): { text: string; didStrip: boolean } => {
    let text = raw.trim();
    if (!text) return { text: '', didStrip: false };
    if (!text.includes(HEARTBEAT_TOKEN)) return { text, didStrip: false };

    let didStrip = false;
    let changed = true;
    while (changed) {
      changed = false;
      const next = text.trim();
      if (next.startsWith(HEARTBEAT_TOKEN)) {
        text = next.slice(HEARTBEAT_TOKEN.length).trimStart();
        didStrip = true;
        changed = true;
        continue;
      }
      if (next.endsWith(HEARTBEAT_TOKEN)) {
        text = next.slice(0, Math.max(0, next.length - HEARTBEAT_TOKEN.length)).trimEnd();
        didStrip = true;
        changed = true;
      }
    }
    return { text: text.replace(/\s+/g, ' ').trim(), didStrip };
  };

  const stripMarkup = (text: string): string =>
    text
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/^[*`~_]+/, '')
      .replace(/[*`~_]+$/, '');

  const normalized = stripMarkup(trimmed);
  const hasToken = trimmed.includes(HEARTBEAT_TOKEN) || normalized.includes(HEARTBEAT_TOKEN);
  if (!hasToken) {
    return { type: 'alert', content: trimmed };
  }

  const strippedOriginal = stripTokenAtEdges(trimmed);
  const strippedNormalized = stripTokenAtEdges(normalized);
  const picked =
    strippedOriginal.didStrip && strippedOriginal.text ? strippedOriginal : strippedNormalized;

  if (!picked.didStrip) {
    return { type: 'alert', content: trimmed };
  }

  const rest = picked.text.trim();
  if (!rest || rest.length <= Math.max(0, ackMaxChars)) {
    return { type: 'ok', content: '' };
  }

  return { type: 'alert', content: rest };
}
