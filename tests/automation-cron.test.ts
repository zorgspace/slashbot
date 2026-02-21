import { describe, expect, test } from 'vitest';
import { parseCronExpression, parseField, computeNextCronRun } from '../src/plugins/automation/cron.js';

describe('parseField', () => {
  test('wildcard expands to full range', () => {
    const result = parseField('*', 0, 59);
    expect(result.size).toBe(60);
    expect(result.has(0)).toBe(true);
    expect(result.has(59)).toBe(true);
  });

  test('single value', () => {
    const result = parseField('5', 0, 59);
    expect(result.size).toBe(1);
    expect(result.has(5)).toBe(true);
  });

  test('range', () => {
    const result = parseField('1-5', 0, 59);
    expect(result.size).toBe(5);
    for (let i = 1; i <= 5; i++) {
      expect(result.has(i)).toBe(true);
    }
  });

  test('step', () => {
    const result = parseField('*/15', 0, 59);
    expect(result.has(0)).toBe(true);
    expect(result.has(15)).toBe(true);
    expect(result.has(30)).toBe(true);
    expect(result.has(45)).toBe(true);
    expect(result.has(10)).toBe(false);
  });

  test('comma-separated', () => {
    const result = parseField('1,3,5', 0, 59);
    expect(result.size).toBe(3);
    expect(result.has(1)).toBe(true);
    expect(result.has(3)).toBe(true);
    expect(result.has(5)).toBe(true);
  });
});

describe('parseCronExpression', () => {
  test('standard 5-field expression', () => {
    const sched = parseCronExpression('30 2 * * 1');
    expect(sched.minute.has(30)).toBe(true);
    expect(sched.hour.has(2)).toBe(true);
    expect(sched.dayOfMonth.size).toBe(31);
    expect(sched.month.size).toBe(12);
    expect(sched.dayOfWeek.has(1)).toBe(true);
  });

  test('@hourly alias', () => {
    const sched = parseCronExpression('@hourly');
    expect(sched.minute.has(0)).toBe(true);
    expect(sched.minute.size).toBe(1);
    expect(sched.hour.size).toBe(24);
  });

  test('@daily alias', () => {
    const sched = parseCronExpression('@daily');
    expect(sched.minute.has(0)).toBe(true);
    expect(sched.minute.size).toBe(1);
    expect(sched.hour.has(0)).toBe(true);
    expect(sched.hour.size).toBe(1);
  });

  test('invalid expression throws', () => {
    expect(() => parseCronExpression('invalid')).toThrow('Invalid cron');
    expect(() => parseCronExpression('1 2 3')).toThrow('Invalid cron');
  });
});

describe('computeNextCronRun', () => {
  test('finds next matching minute', () => {
    const sched = parseCronExpression('30 * * * *');
    const from = new Date('2024-01-01T10:00:00Z');
    const next = computeNextCronRun(sched, from);
    expect(next.getMinutes()).toBe(30);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  test('finds next matching hour and minute', () => {
    const sched = parseCronExpression('0 12 * * *');
    const from = new Date('2024-01-01T13:00:00Z');
    const next = computeNextCronRun(sched, from);
    expect(next.getHours()).toBe(12);
    expect(next.getMinutes()).toBe(0);
    // Should be the next day since we're past 12:00
    expect(next.getDate()).toBe(from.getDate() + 1);
  });

  test('@hourly runs at next :00', () => {
    const sched = parseCronExpression('@hourly');
    const from = new Date('2024-06-15T14:30:00Z');
    const next = computeNextCronRun(sched, from);
    expect(next.getMinutes()).toBe(0);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });
});

describe('parseField (additional)', () => {
  test('range with step: 0-30/10', () => {
    const result = parseField('0-30/10', 0, 59);
    expect(result).toEqual(new Set([0, 10, 20, 30]));
  });

  test('boundary values 0 and 59', () => {
    expect(parseField('0', 0, 59).has(0)).toBe(true);
    expect(parseField('59', 0, 59).has(59)).toBe(true);
  });

  test('comma with ranges: 1-3,7,10-12', () => {
    const result = parseField('1-3,7,10-12', 0, 59);
    expect(result).toEqual(new Set([1, 2, 3, 7, 10, 11, 12]));
  });

  test('step from all: */1 produces every value', () => {
    const result = parseField('*/1', 0, 23);
    expect(result.size).toBe(24);
  });

  test('invalid values throw', () => {
    expect(() => parseField('a', 0, 59)).toThrow('Invalid cron');
    expect(() => parseField('60', 0, 59)).toThrow('out of range');
    expect(() => parseField('*/0', 0, 59)).toThrow('Invalid cron step');
  });
});

describe('parseCronExpression (additional)', () => {
  test('@weekly alias', () => {
    const sched = parseCronExpression('@weekly');
    expect(sched.minute.has(0)).toBe(true);
    expect(sched.hour.has(0)).toBe(true);
    expect(sched.dayOfWeek.has(0)).toBe(true);
  });

  test('@monthly alias', () => {
    const sched = parseCronExpression('@monthly');
    expect(sched.minute.has(0)).toBe(true);
    expect(sched.hour.has(0)).toBe(true);
    expect(sched.dayOfMonth.has(1)).toBe(true);
  });

  test('extra whitespace is tolerated', () => {
    const sched = parseCronExpression('  30  2  *  *  1  ');
    expect(sched.minute.has(30)).toBe(true);
    expect(sched.hour.has(2)).toBe(true);
  });

  test('6-field expression throws', () => {
    expect(() => parseCronExpression('0 0 1 1 1 2024')).toThrow('Invalid cron');
  });
});

describe('computeNextCronRun (additional)', () => {
  test('specific day of week: Monday at 9am', () => {
    const sched = parseCronExpression('0 9 * * 1');
    const from = new Date('2024-01-03T10:00:00');
    const next = computeNextCronRun(sched, from);
    expect(next.getDay()).toBe(1);
    expect(next.getHours()).toBe(9);
  });

  test('next month rollover from Jan 31', () => {
    const sched = parseCronExpression('0 0 1 * *');
    const from = new Date('2024-01-31T12:00:00');
    const next = computeNextCronRun(sched, from);
    expect(next.getDate()).toBe(1);
    expect(next.getMonth()).toBe(1);
  });

  test('advances past current minute', () => {
    const sched = parseCronExpression('* * * * *');
    const from = new Date('2024-06-15T12:30:00');
    const next = computeNextCronRun(sched, from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });
});
