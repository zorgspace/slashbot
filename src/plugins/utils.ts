/**
 * @module plugins/utils
 *
 * Shared argument parsing, text processing, and formatting helpers used across all plugins.
 *
 * Provides consistent input validation (type assertion functions) and output formatting
 * utilities (message splitting, HTML stripping, slug generation).
 *
 * @see {@link asObject} -- Assert value is a plain object
 * @see {@link asString} -- Assert value is a string
 * @see {@link asNonEmptyString} -- Assert value is a non-empty string
 * @see {@link splitMessage} -- Split text into chunks respecting newline boundaries
 * @see {@link stripHtml} -- Strip HTML tags, scripts, styles, and decode entities
 * @see {@link slugify} -- Convert text to URL-safe slug
 */
import type { JsonValue } from '../core/kernel/contracts.js';

/**
 * Assert that a JSON value is a plain object (not an array or primitive).
 *
 * @param value - The JSON value to validate.
 * @returns The value cast to a Record of string keys to JsonValue.
 * @throws {Error} If the value is null, not an object, or is an array.
 */
export function asObject(value: JsonValue): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected object arguments');
  }
  return value as Record<string, JsonValue>;
}

/**
 * Assert that a value is a string.
 *
 * @param value - The value to validate.
 * @param name - Parameter name used in the error message.
 * @returns The value as a string.
 * @throws {Error} If the value is not a string.
 */
export function asString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Expected string for ${name}`);
  return value;
}

/**
 * Assert that a value is a non-empty string.
 *
 * @param value - The JSON value to validate.
 * @param name - Parameter name used in the error message.
 * @returns The value as a non-empty string.
 * @throws {Error} If the value is not a string or is empty.
 */
export function asNonEmptyString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected string field: ${name}`);
  }
  return value;
}

/**
 * Assert that a value is an array of strings, defaulting to an empty array if undefined.
 *
 * @param value - The JSON value to validate.
 * @param name - Parameter name used in the error message.
 * @returns The value as a string array, or an empty array if undefined.
 * @throws {Error} If the value is defined but is not an array of strings.
 */
export function asStringArray(value: JsonValue | undefined, name: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Expected string[] field: ${name}`);
  }
  return value as string[];
}

/**
 * Parse an optional string array, trimming entries and capping at a maximum count.
 *
 * @param value - The JSON value to parse. Non-array values return undefined.
 * @param maxItems - Maximum number of items to return (default 5).
 * @returns A trimmed, non-empty string array capped at maxItems, or undefined if empty/invalid.
 */
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

/**
 * Split text into chunks no longer than maxLen, preferring newline boundaries.
 *
 * Used to break long messages into connector-friendly segments (e.g., Telegram 4096-char limit).
 *
 * @param text - The text to split.
 * @param maxLen - Maximum length of each chunk.
 * @returns Array of non-empty text chunks.
 */
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

/**
 * Strip HTML tags, script/style blocks, and decode common HTML entities.
 *
 * @param html - Raw HTML string to sanitize.
 * @returns Plain text with tags removed, entities decoded, and whitespace normalized.
 */
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

/**
 * Convert text to a URL-safe slug (lowercase, alphanumeric with hyphens, max 40 chars).
 *
 * @param text - The text to slugify.
 * @returns A URL-safe slug string.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
