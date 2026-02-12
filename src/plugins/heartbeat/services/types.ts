/**
 * Heartbeat System Types
 *
 * Reimplemented from the OpenClaw heartbeat behavior:
 * - predictable scheduling semantics
 * - robust HEARTBEAT_OK handling
 * - effective-empty HEARTBEAT.md detection
 * - active-hours window enforcement
 */

/**
 * Active hours configuration - restrict heartbeats to certain times.
 */
export interface ActiveHours {
  start: string;
  end: string;
  timezone?: string;
}

/**
 * Heartbeat visibility settings.
 */
export interface HeartbeatVisibility {
  showOk?: boolean;
  showAlerts?: boolean;
  useIndicator?: boolean;
}

/**
 * User-configurable heartbeat settings.
 */
export interface HeartbeatConfig {
  enabled?: boolean;
  period?: string;
  every?: string;
  interval?: string;
  prompt?: string;
  model?: string;
  activeHours?: ActiveHours | string;
  ackMaxChars?: number;
  visibility?: HeartbeatVisibility;
  includeReasoning?: boolean;
  dedupeWindow?: string;
}

/**
 * Fully resolved runtime heartbeat configuration.
 */
export interface FullHeartbeatConfig {
  enabled: boolean;
  period: string;
  prompt?: string;
  model?: string;
  activeHours?: ActiveHours | string;
  ackMaxChars: number;
  visibility: Required<HeartbeatVisibility>;
  includeReasoning: boolean;
  dedupeWindowMs: number;
}

/**
 * Heartbeat result classification.
 */
export type HeartbeatResponseType = 'ok' | 'alert' | 'error';

export type HeartbeatRunStatus = 'ran' | 'skipped';

export type HeartbeatSkipReason =
  | 'disabled'
  | 'not-due'
  | 'quiet-hours'
  | 'empty-heartbeat-file'
  | 'alerts-disabled'
  | 'in-progress'
  | 'duplicate';

/**
 * Heartbeat execution result payload.
 */
export interface HeartbeatResult {
  type: HeartbeatResponseType;
  content: string;
  reasoning?: string;
  timestamp: Date;
  duration: number;
  actions?: HeartbeatAction[];
  status?: HeartbeatRunStatus;
  skipReason?: HeartbeatSkipReason;
  rawResponse?: string;
  didStripHeartbeatToken?: boolean;
}

/**
 * Action taken during heartbeat reflection.
 */
export interface HeartbeatAction {
  type: string;
  description: string;
  success: boolean;
  output?: string;
}

/**
 * Heartbeat state persisted to disk.
 */
export interface HeartbeatState {
  lastRun?: string;
  lastResult?: HeartbeatResponseType;
  consecutiveOks: number;
  totalRuns: number;
  totalAlerts: number;
  totalSkips: number;
  lastError?: string;
  lastDurationMs?: number;
  lastSkippedReason?: HeartbeatSkipReason;
  lastHeartbeatText?: string;
  lastHeartbeatSentAt?: number;
}

/**
 * OpenClaw-aligned defaults.
 */
export const HEARTBEAT_TOKEN = 'HEARTBEAT_OK';
export const DEFAULT_HEARTBEAT_EVERY = '30m';
export const DEFAULT_HEARTBEAT_ACK_MAX_CHARS = 300;
export const DEFAULT_HEARTBEAT_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_HEARTBEAT_PROMPT =
  'Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.';

/**
 * Parse a duration string to milliseconds.
 * Supports:
 * - single value: "5", "5m", "2h", "1d"
 * - chained values: "2h30m", "1d12h"
 * Defaults to minutes when no unit is provided.
 */
export function parseDurationOrNull(
  raw: string | undefined | null,
  opts: { defaultUnit?: 'ms' | 's' | 'm' | 'h' | 'd' } = {},
): number | null {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!value) return null;

  const tokenRegex = /(\d+(?:\.\d+)?)(ms|s|m|h|d)?/g;
  let total = 0;
  let consumed = '';
  let match: RegExpExecArray | null = null;

  while ((match = tokenRegex.exec(value)) !== null) {
    consumed += match[0];
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num < 0) return null;

    const unit = (match[2] ?? opts.defaultUnit ?? 'm') as 'ms' | 's' | 'm' | 'h' | 'd';
    const multiplier =
      unit === 'ms'
        ? 1
        : unit === 's'
          ? 1000
          : unit === 'm'
            ? 60_000
            : unit === 'h'
              ? 3_600_000
              : 86_400_000;
    total += Math.round(num * multiplier);
  }

  if (!consumed || consumed.length !== value.length) return null;
  if (!Number.isFinite(total) || total <= 0) return null;
  return total;
}

/**
 * Backwards compatible duration parser.
 * Falls back to 30m when parsing fails.
 */
export function parseDuration(duration: string): number {
  return parseDurationOrNull(duration, { defaultUnit: 'm' }) ?? 30 * 60 * 1000;
}

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
 * Missing content is treated as non-empty so heartbeat can still run.
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

function parseMinutes(raw: string, opts: { allow24: boolean }): number | null {
  if (!ACTIVE_HOURS_TIME_PATTERN.test(raw)) return null;
  const [hourStr, minuteStr] = raw.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour === 24) {
    if (!opts.allow24 || minute !== 0) return null;
    return 24 * 60;
  }
  return hour * 60 + minute;
}

function resolveMinutesInTimeZone(nowMs: number, timeZone?: string): number | null {
  try {
    if (!timeZone) {
      const now = new Date(nowMs);
      return now.getHours() * 60 + now.getMinutes();
    }
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(nowMs));

    const map: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        map[part.type] = part.value;
      }
    }

    const hour = Number(map.hour);
    const minute = Number(map.minute);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

/**
 * Check if current time is within active hours.
 * Supports object format and "HH:MM-HH:MM" shorthand.
 */
export function isWithinActiveHours(
  activeHours?: ActiveHours | string,
  nowMs: number = Date.now(),
): boolean {
  if (!activeHours) return true;

  let start: string | undefined;
  let end: string | undefined;
  let timezone: string | undefined;

  if (typeof activeHours === 'string') {
    const [startRaw, endRaw] = activeHours.split('-').map(part => part.trim());
    start = startRaw;
    end = endRaw;
  } else {
    start = activeHours.start;
    end = activeHours.end;
    timezone = activeHours.timezone;
  }

  if (!start || !end) return true;
  const startMin = parseMinutes(start, { allow24: false });
  const endMin = parseMinutes(end, { allow24: true });
  if (startMin === null || endMin === null || startMin === endMin) return true;

  const currentMin = resolveMinutesInTimeZone(nowMs, timezone);
  if (currentMin === null) return true;

  if (endMin > startMin) {
    return currentMin >= startMin && currentMin < endMin;
  }
  return currentMin >= startMin || currentMin < endMin;
}

export type StripHeartbeatMode = 'heartbeat' | 'message';

function stripTokenAtEdges(raw: string): { text: string; didStrip: boolean } {
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
}

/**
 * Strip HEARTBEAT_OK in either heartbeat or regular-message mode.
 */
export function stripHeartbeatToken(
  raw?: string,
  opts: { mode?: StripHeartbeatMode; maxAckChars?: number } = {},
): { shouldSkip: boolean; text: string; didStrip: boolean } {
  if (!raw) return { shouldSkip: true, text: '', didStrip: false };
  const trimmed = raw.trim();
  if (!trimmed) return { shouldSkip: true, text: '', didStrip: false };

  const mode = opts.mode ?? 'message';
  const parsedAck = typeof opts.maxAckChars === 'string' ? Number(opts.maxAckChars) : opts.maxAckChars;
  const maxAckChars = Math.max(
    0,
    typeof parsedAck === 'number' && Number.isFinite(parsedAck)
      ? parsedAck
      : DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  );

  const stripMarkup = (text: string) =>
    text
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/^[*`~_]+/, '')
      .replace(/[*`~_]+$/, '');

  const normalized = stripMarkup(trimmed);
  const hasToken = trimmed.includes(HEARTBEAT_TOKEN) || normalized.includes(HEARTBEAT_TOKEN);
  if (!hasToken) {
    return { shouldSkip: false, text: trimmed, didStrip: false };
  }

  const strippedOriginal = stripTokenAtEdges(trimmed);
  const strippedNormalized = stripTokenAtEdges(normalized);
  const picked =
    strippedOriginal.didStrip && strippedOriginal.text ? strippedOriginal : strippedNormalized;

  if (!picked.didStrip) {
    return { shouldSkip: false, text: trimmed, didStrip: false };
  }

  if (!picked.text) {
    return { shouldSkip: true, text: '', didStrip: true };
  }

  const rest = picked.text.trim();
  if (mode === 'heartbeat' && rest.length <= maxAckChars) {
    return { shouldSkip: true, text: '', didStrip: true };
  }

  return { shouldSkip: false, text: rest, didStrip: true };
}

/**
 * Determine heartbeat response type.
 */
export function parseHeartbeatResponse(
  response: string,
  ackMaxChars: number = DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
): { type: HeartbeatResponseType; content: string; didStripHeartbeatToken: boolean } {
  const trimmed = (response || '').trim();
  if (!trimmed) return { type: 'ok', content: '', didStripHeartbeatToken: false };

  const stripped = stripHeartbeatToken(trimmed, { mode: 'heartbeat', maxAckChars: ackMaxChars });
  if (stripped.shouldSkip) {
    return { type: 'ok', content: '', didStripHeartbeatToken: stripped.didStrip };
  }

  if (stripped.didStrip) {
    return { type: 'alert', content: stripped.text, didStripHeartbeatToken: true };
  }

  return { type: 'alert', content: trimmed, didStripHeartbeatToken: false };
}
