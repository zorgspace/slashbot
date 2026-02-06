// Cron Expression Parser
// Supports standard 5-field cron: minute hour day-of-month month day-of-week
// Examples: every minute, every hour, daily at midnight, etc.

export interface CronField {
  values: number[];
  min: number;
  max: number;
}

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

const FIELD_RANGES = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dayOfWeek: { min: 0, max: 6 }, // 0 = Sunday
};

/**
 * Parse a single cron field
 */
function parseField(field: string, min: number, max: number): number[] {
  const values: Set<number> = new Set();

  // Handle comma-separated values
  const parts = field.split(',');

  for (const part of parts) {
    // Handle step values (*/5, 1-10/2)
    const [range, stepStr] = part.split('/');
    const step = stepStr ? parseInt(stepStr, 10) : 1;

    if (range === '*') {
      // All values with step
      for (let i = min; i <= max; i += step) {
        values.add(i);
      }
    } else if (range.includes('-')) {
      // Range (e.g., 1-5)
      const [startStr, endStr] = range.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      for (let i = start; i <= end; i += step) {
        if (i >= min && i <= max) {
          values.add(i);
        }
      }
    } else {
      // Single value
      const val = parseInt(range, 10);
      if (val >= min && val <= max) {
        values.add(val);
      }
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}

/**
 * Parse a full cron expression
 */
export function parseCron(expression: string): ParsedCron | null {
  const parts = expression.trim().split(/\s+/);

  if (parts.length !== 5) {
    return null;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  try {
    return {
      minute: {
        values: parseField(minute, FIELD_RANGES.minute.min, FIELD_RANGES.minute.max),
        ...FIELD_RANGES.minute,
      },
      hour: {
        values: parseField(hour, FIELD_RANGES.hour.min, FIELD_RANGES.hour.max),
        ...FIELD_RANGES.hour,
      },
      dayOfMonth: {
        values: parseField(dayOfMonth, FIELD_RANGES.dayOfMonth.min, FIELD_RANGES.dayOfMonth.max),
        ...FIELD_RANGES.dayOfMonth,
      },
      month: {
        values: parseField(month, FIELD_RANGES.month.min, FIELD_RANGES.month.max),
        ...FIELD_RANGES.month,
      },
      dayOfWeek: {
        values: parseField(dayOfWeek, FIELD_RANGES.dayOfWeek.min, FIELD_RANGES.dayOfWeek.max),
        ...FIELD_RANGES.dayOfWeek,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Check if a date matches a cron expression
 */
export function matchesCron(cron: ParsedCron, date: Date): boolean {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // JS months are 0-indexed
  const dayOfWeek = date.getDay(); // 0 = Sunday

  return (
    cron.minute.values.includes(minute) &&
    cron.hour.values.includes(hour) &&
    cron.dayOfMonth.values.includes(dayOfMonth) &&
    cron.month.values.includes(month) &&
    cron.dayOfWeek.values.includes(dayOfWeek)
  );
}

/**
 * Get the next run time for a cron expression
 */
export function getNextRunTime(expression: string, from: Date = new Date()): Date | null {
  const cron = parseCron(expression);
  if (!cron) return null;

  // Start from the next minute
  const next = new Date(from);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(next.getMinutes() + 1);

  // Search up to 1 year ahead
  const maxDate = new Date(from);
  maxDate.setFullYear(maxDate.getFullYear() + 1);

  while (next < maxDate) {
    if (matchesCron(cron, next)) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  return null;
}

/**
 * Format a cron expression for display
 */
export function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return 'Invalid cron';

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Common patterns
  if (expression === '* * * * *') return 'Every minute';
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.slice(2), 10);
    if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return `Every ${interval} minute${interval > 1 ? 's' : ''}`;
    }
  }
  if (minute === '0' && hour === '*') return 'Every hour';
  if (minute === '0' && hour === '0') return 'Daily at midnight';
  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }
  if (dayOfWeek === '1-5' || dayOfWeek === '1,2,3,4,5') {
    return `Weekdays at ${hour}:${minute.padStart(2, '0')}`;
  }
  if (dayOfWeek === '0,6' || dayOfWeek === '6,0') {
    return `Weekends at ${hour}:${minute.padStart(2, '0')}`;
  }

  return expression;
}

/**
 * Validate a cron expression
 */
export function isValidCron(expression: string): boolean {
  return parseCron(expression) !== null;
}
