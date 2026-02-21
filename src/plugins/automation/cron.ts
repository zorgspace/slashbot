/**
 * Cron parsing and scheduling helpers used by the automation plugin.
 */
export interface CronSchedule {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
}

function parseIntegerToken(token: string, label: string): number {
  if (!/^\d+$/.test(token)) {
    throw new Error(`Invalid cron ${label}: "${token}"`);
  }
  const value = Number(token);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid cron ${label}: "${token}"`);
  }
  return value;
}

function assertRangeValue(value: number, min: number, max: number, label: string): void {
  if (value < min || value > max) {
    throw new Error(`Cron ${label} out of range (${min}-${max}): ${value}`);
  }
}

export function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  const parts = field.split(',');
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) {
      throw new Error(`Invalid cron field: "${field}"`);
    }
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }
    if (part.includes('/')) {
      const stepParts = part.split('/');
      if (stepParts.length !== 2) {
        throw new Error(`Invalid cron step syntax: "${part}"`);
      }
      const [rangeToken, stepToken] = stepParts;
      const step = parseIntegerToken(stepToken, 'step');
      if (step <= 0) {
        throw new Error(`Invalid cron step: ${step}`);
      }
      let start: number;
      let end: number;
      if (rangeToken === '*') {
        start = min;
        end = max;
      } else if (rangeToken.includes('-')) {
        const rangeParts = rangeToken.split('-');
        if (rangeParts.length !== 2) {
          throw new Error(`Invalid cron range syntax: "${rangeToken}"`);
        }
        const lo = parseIntegerToken(rangeParts[0], 'range start');
        const hi = parseIntegerToken(rangeParts[1], 'range end');
        assertRangeValue(lo, min, max, 'range start');
        assertRangeValue(hi, min, max, 'range end');
        if (lo > hi) {
          throw new Error(`Invalid cron range: ${lo}-${hi}`);
        }
        start = lo;
        end = hi;
      } else {
        start = parseIntegerToken(rangeToken, 'start');
        assertRangeValue(start, min, max, 'start');
        end = max;
      }
      for (let i = start; i <= end; i += step) values.add(i);
      continue;
    }
    if (part.includes('-')) {
      const rangeParts = part.split('-');
      if (rangeParts.length !== 2) {
        throw new Error(`Invalid cron range syntax: "${part}"`);
      }
      const lo = parseIntegerToken(rangeParts[0], 'range start');
      const hi = parseIntegerToken(rangeParts[1], 'range end');
      assertRangeValue(lo, min, max, 'range start');
      assertRangeValue(hi, min, max, 'range end');
      if (lo > hi) {
        throw new Error(`Invalid cron range: ${lo}-${hi}`);
      }
      for (let i = lo; i <= hi; i++) values.add(i);
      continue;
    }
    const value = parseIntegerToken(part, 'value');
    assertRangeValue(value, min, max, 'value');
    values.add(value);
  }
  return values;
}

export function parseCronExpression(expr: string): CronSchedule {
  const aliases: Record<string, string> = {
    '@hourly': '0 * * * *',
    '@daily': '0 0 * * *',
    '@weekly': '0 0 * * 0',
    '@monthly': '0 0 1 * *',
  };
  const normalized = aliases[expr.trim()] ?? expr.trim();
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron: ${expr}`);
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

export function computeNextCronRun(schedule: CronSchedule, from: Date): Date {
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  const maxIter = 525_600; // ~1 year in minutes
  for (let i = 0; i < maxIter; i++) {
    if (
      schedule.month.has(next.getMonth() + 1) &&
      schedule.dayOfMonth.has(next.getDate()) &&
      schedule.dayOfWeek.has(next.getDay()) &&
      schedule.hour.has(next.getHours()) &&
      schedule.minute.has(next.getMinutes())
    ) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }
  throw new Error('No next cron run found within 1 year');
}
