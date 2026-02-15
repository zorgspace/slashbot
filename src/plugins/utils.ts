/**
 * Plugin utility functions — shared argument parsing, text processing, and formatting helpers.
 *
 * Used across all plugins for consistent input validation and output formatting.
 *
 * Argument parsing:
 *  - `asObject(value)` — Assert value is a plain object (throws on arrays/primitives).
 *  - `asString(value, name)` — Assert value is a string.
 *  - `asNonEmptyString(value, name)` — Assert value is a non-empty string.
 *  - `asStringArray(value, name)` — Assert value is a string[] (defaults to []).
 *  - `asOptionalStringArray(value, maxItems?)` — Parse optional string[] with max cap.
 *
 * Text processing:
 *  - `splitMessage(text, maxLen)` — Split text into chunks respecting newline boundaries.
 *  - `stripHtml(html)` — Strip HTML tags, scripts, styles, and decode entities.
 *  - `slugify(text)` — Convert text to URL-safe slug.
 */
import type { JsonValue } from '../core/kernel/contracts.js';

export function asObject(value: JsonValue): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected object arguments');
  }
  return value as Record<string, JsonValue>;
}

export function asString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Expected string for ${name}`);
  return value;
}

export function asNonEmptyString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected string field: ${name}`);
  }
  return value;
}

export function asStringArray(value: JsonValue | undefined, name: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Expected string[] field: ${name}`);
  }
  return value as string[];
}

export function asOptionalStringArray(value: JsonValue | undefined, maxItems = 5): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
    .slice(0, maxItems);
  return normalized.length > 0 ? normalized : undefined;
}

export function splitMessage(text: string, maxLen: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLen) return [trimmed];
  const parts: string[] = [];
  let remaining = trimmed;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      parts.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return parts.filter((p) => p.length > 0);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
