/**
 * UI Value Formatter
 *
 * Normalizes unknown runtime values for safe chat rendering.
 * Prevents accidental "[object Object]" output in command blocks.
 */

const WRAPPER_KEYS = new Set([
  'value',
  'source',
  'scope',
  'origin',
  'default',
  'resolved',
  'raw',
  'meta',
  'provider',
  'path',
  'label',
  'type',
  'kind',
  'status',
]);

type NormalizeOptions = {
  maxDepth?: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function shouldUnwrapValueObject(obj: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(obj, 'value')) {
    return false;
  }
  const keys = Object.keys(obj);
  if (keys.length === 1) return true;
  return keys.every(key => WRAPPER_KEYS.has(key));
}

function normalizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth <= 0) {
    if (Array.isArray(value)) return '[Array]';
    if (value && typeof value === 'object') return '[Object]';
    return value;
  }

  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol' || typeof value === 'function') return String(value);

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map(item => normalizeValue(item, depth - 1, seen));
    }

    if (isPlainObject(value)) {
      if (shouldUnwrapValueObject(value)) {
        return normalizeValue(value.value, depth - 1, seen);
      }
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort()) {
        out[key] = normalizeValue(value[key], depth - 1, seen);
      }
      return out;
    }

    return String(value);
  }

  return value;
}

export function unwrapDisplayValue(value: unknown, options: NormalizeOptions = {}): unknown {
  const maxDepth = Math.max(1, options.maxDepth ?? 8);
  return normalizeValue(value, maxDepth, new WeakSet<object>());
}

export function stringifyDisplayValue(
  value: unknown,
  options: NormalizeOptions & { compact?: boolean } = {},
): string {
  if (typeof value === 'string') {
    return value;
  }
  const normalized = unwrapDisplayValue(value, options);
  if (normalized === undefined) return 'undefined';
  if (normalized === null) return 'null';
  if (
    typeof normalized === 'string' ||
    typeof normalized === 'number' ||
    typeof normalized === 'boolean'
  ) {
    return String(normalized);
  }
  try {
    return JSON.stringify(normalized, null, options.compact ? 0 : 2) ?? String(normalized);
  } catch {
    return String(normalized);
  }
}

export function formatInlineDisplayValue(value: unknown, options: NormalizeOptions = {}): string {
  const compact = stringifyDisplayValue(value, { ...options, compact: true });
  return compact.replace(/\s+/g, ' ').trim();
}
