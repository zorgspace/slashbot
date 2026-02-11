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
 * Default heartbeat prompt - instructs the agent on heartbeat behavior
 */
export const DEFAULT_HEARTBEAT_PROMPT = `[HEARTBEAT - PERIODIC REFLECTION]

You are receiving a scheduled heartbeat. This is your opportunity to:
1. Review HEARTBEAT.md if it exists (your personal checklist/context)
2. Check for any pending work, reminders, or items needing attention
3. Take proactive actions if needed (notifications, file updates, etc.)

RESPONSE RULES:
- Do NOT infer or repeat tasks from prior conversations
- Do NOT take destructive actions without explicit prior instructions
- Focus on surfacing important items, not routine status updates

If HEARTBEAT.md exists, follow its instructions strictly.
Otherwise, briefly review your context and surface anything urgent.`;

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
 * Check if current time is within active hours
 * Supports both object format { start: "HH:MM", end: "HH:MM" }
 * and string format "HH:MM-HH:MM"
 */
export function isWithinActiveHours(activeHours?: ActiveHours | string): boolean {
  if (!activeHours) return true;

  let startTime: string;
  let endTime: string;

  // Handle string format "HH:MM-HH:MM"
  if (typeof activeHours === 'string') {
    const parts = activeHours.split('-');
    if (parts.length !== 2) return true; // Invalid format, allow all
    startTime = parts[0].trim();
    endTime = parts[1].trim();
  } else {
    // Object format { start, end }
    if (!activeHours.start || !activeHours.end) return true;
    startTime = activeHours.start;
    endTime = activeHours.end;
  }

  const now = new Date();
  const startParts = startTime.split(':');
  const endParts = endTime.split(':');

  if (startParts.length < 2 || endParts.length < 2) return true; // Invalid format

  const [startHour, startMin] = startParts.map(Number);
  const [endHour, endMin] = endParts.map(Number);

  if (isNaN(startHour) || isNaN(startMin) || isNaN(endHour) || isNaN(endMin)) {
    return true; // Invalid numbers, allow all
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  // Handle overnight ranges (e.g., 22:00 to 06:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Determine heartbeat response type
 */
export function parseHeartbeatResponse(
  response: string,
  _ackMaxChars: number = 300,
): { type: HeartbeatResponseType; content: string } {
  const trimmed = response.trim();
  return { type: 'alert', content: trimmed };
}
