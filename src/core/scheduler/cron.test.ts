import { describe, it, expect } from 'vitest';
import { parseCron, matchesCron, getNextRunTime, describeCron, isValidCron } from './cron';

describe('parseCron', () => {
  it('parses "* * * * *" (every minute)', () => {
    const result = parseCron('* * * * *');
    expect(result).not.toBeNull();
    expect(result!.minute.values).toHaveLength(60); // 0-59
    expect(result!.hour.values).toHaveLength(24); // 0-23
    expect(result!.dayOfMonth.values).toHaveLength(31); // 1-31
    expect(result!.month.values).toHaveLength(12); // 1-12
    expect(result!.dayOfWeek.values).toHaveLength(7); // 0-6
  });

  it('parses "0 9 * * 1-5" (weekdays at 9am)', () => {
    const result = parseCron('0 9 * * 1-5');
    expect(result).not.toBeNull();
    expect(result!.minute.values).toEqual([0]);
    expect(result!.hour.values).toEqual([9]);
    expect(result!.dayOfWeek.values).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses "*/15 * * * *" (every 15 minutes)', () => {
    const result = parseCron('*/15 * * * *');
    expect(result).not.toBeNull();
    expect(result!.minute.values).toEqual([0, 15, 30, 45]);
  });

  it('parses "0 0 1 1 *" (Jan 1st midnight)', () => {
    const result = parseCron('0 0 1 1 *');
    expect(result).not.toBeNull();
    expect(result!.minute.values).toEqual([0]);
    expect(result!.hour.values).toEqual([0]);
    expect(result!.dayOfMonth.values).toEqual([1]);
    expect(result!.month.values).toEqual([1]);
  });

  it('parses comma-separated values "0,30 9,17 * * *"', () => {
    const result = parseCron('0,30 9,17 * * *');
    expect(result).not.toBeNull();
    expect(result!.minute.values).toEqual([0, 30]);
    expect(result!.hour.values).toEqual([9, 17]);
  });

  it('parses step with range "0-30/10 * * * *"', () => {
    const result = parseCron('0-30/10 * * * *');
    expect(result).not.toBeNull();
    expect(result!.minute.values).toEqual([0, 10, 20, 30]);
  });

  it('returns null for invalid expressions', () => {
    expect(parseCron('invalid')).toBeNull();
    expect(parseCron('* * *')).toBeNull(); // Only 3 fields
    expect(parseCron('* * * * * *')).toBeNull(); // 6 fields
    expect(parseCron('')).toBeNull();
  });

  it('handles single values correctly', () => {
    const result = parseCron('5 10 15 6 3');
    expect(result).not.toBeNull();
    expect(result!.minute.values).toEqual([5]);
    expect(result!.hour.values).toEqual([10]);
    expect(result!.dayOfMonth.values).toEqual([15]);
    expect(result!.month.values).toEqual([6]);
    expect(result!.dayOfWeek.values).toEqual([3]);
  });
});

describe('matchesCron', () => {
  it('matches exact minute/hour/day', () => {
    const cron = parseCron('30 14 15 6 *')!;
    const date = new Date(2024, 5, 15, 14, 30); // June 15, 2024, 14:30
    expect(matchesCron(cron, date)).toBe(true);
  });

  it('does not match wrong minute', () => {
    const cron = parseCron('30 14 * * *')!;
    const date = new Date(2024, 5, 15, 14, 31); // 14:31 instead of 14:30
    expect(matchesCron(cron, date)).toBe(false);
  });

  it('does not match wrong hour', () => {
    const cron = parseCron('30 14 * * *')!;
    const date = new Date(2024, 5, 15, 15, 30); // 15:30 instead of 14:30
    expect(matchesCron(cron, date)).toBe(false);
  });

  it('matches every minute cron', () => {
    const cron = parseCron('* * * * *')!;
    const date = new Date();
    expect(matchesCron(cron, date)).toBe(true);
  });

  it('handles day-of-week correctly (Sunday = 0)', () => {
    const cron = parseCron('0 9 * * 0')!; // Sunday
    const sunday = new Date(2024, 5, 16, 9, 0); // June 16, 2024 is Sunday
    const monday = new Date(2024, 5, 17, 9, 0); // June 17, 2024 is Monday
    expect(matchesCron(cron, sunday)).toBe(true);
    expect(matchesCron(cron, monday)).toBe(false);
  });

  it('handles month boundaries', () => {
    const cron = parseCron('0 0 1 * *')!; // First day of every month
    const firstDay = new Date(2024, 6, 1, 0, 0); // July 1
    const secondDay = new Date(2024, 6, 2, 0, 0); // July 2
    expect(matchesCron(cron, firstDay)).toBe(true);
    expect(matchesCron(cron, secondDay)).toBe(false);
  });
});

describe('getNextRunTime', () => {
  it('finds next minute for "* * * * *"', () => {
    const from = new Date(2024, 5, 15, 14, 30, 0);
    const next = getNextRunTime('* * * * *', from);
    expect(next).not.toBeNull();
    expect(next!.getMinutes()).toBe(31);
  });

  it('finds next hour for "0 * * * *"', () => {
    const from = new Date(2024, 5, 15, 14, 30, 0);
    const next = getNextRunTime('0 * * * *', from);
    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(15);
    expect(next!.getMinutes()).toBe(0);
  });

  it('finds next day for daily cron', () => {
    const from = new Date(2024, 5, 15, 14, 30, 0); // After 9:00
    const next = getNextRunTime('0 9 * * *', from);
    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(16); // Next day
    expect(next!.getHours()).toBe(9);
  });

  it('returns null for invalid cron', () => {
    const next = getNextRunTime('invalid');
    expect(next).toBeNull();
  });

  it('finds correct time for specific cron', () => {
    const from = new Date(2024, 5, 15, 8, 0, 0); // Before 9:00
    const next = getNextRunTime('0 9 * * *', from);
    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(15); // Same day
    expect(next!.getHours()).toBe(9);
  });
});

describe('describeCron', () => {
  it('describes "* * * * *" as "Every minute"', () => {
    expect(describeCron('* * * * *')).toBe('Every minute');
  });

  it('describes "*/5 * * * *" as "Every 5 minutes"', () => {
    expect(describeCron('*/5 * * * *')).toBe('Every 5 minutes');
  });

  it('describes "*/1 * * * *" as "Every 1 minute"', () => {
    expect(describeCron('*/1 * * * *')).toBe('Every 1 minute');
  });

  it('describes "0 * * * *" as "Every hour"', () => {
    expect(describeCron('0 * * * *')).toBe('Every hour');
  });

  it('describes "0 0 * * *" as "Daily at midnight"', () => {
    expect(describeCron('0 0 * * *')).toBe('Daily at midnight');
  });

  it('describes "0 9 * * *" as "Daily at 09:00"', () => {
    expect(describeCron('0 9 * * *')).toBe('Daily at 09:00');
  });

  it('describes "30 14 * * *" as "Daily at 14:30"', () => {
    expect(describeCron('30 14 * * *')).toBe('Daily at 14:30');
  });

  it('describes weekday patterns', () => {
    expect(describeCron('0 9 * * 1-5')).toBe('Weekdays at 9:00');
    expect(describeCron('0 9 * * 1,2,3,4,5')).toBe('Weekdays at 9:00');
  });

  it('describes weekend patterns', () => {
    expect(describeCron('0 10 * * 0,6')).toBe('Weekends at 10:00');
    expect(describeCron('0 10 * * 6,0')).toBe('Weekends at 10:00');
  });

  it('returns raw expression for complex patterns', () => {
    expect(describeCron('0 9 1 * *')).toBe('0 9 1 * *'); // Complex pattern
  });

  it('returns "Invalid cron" for invalid expressions', () => {
    expect(describeCron('invalid')).toBe('Invalid cron');
    expect(describeCron('* * *')).toBe('Invalid cron');
  });
});

describe('isValidCron', () => {
  it('returns true for valid expressions', () => {
    expect(isValidCron('* * * * *')).toBe(true);
    expect(isValidCron('0 9 * * 1-5')).toBe(true);
    expect(isValidCron('*/15 * * * *')).toBe(true);
    expect(isValidCron('0,30 9,17 * * *')).toBe(true);
  });

  it('returns false for invalid expressions', () => {
    expect(isValidCron('invalid')).toBe(false);
    expect(isValidCron('* * *')).toBe(false);
    expect(isValidCron('')).toBe(false);
    expect(isValidCron('* * * * * *')).toBe(false);
  });
});
