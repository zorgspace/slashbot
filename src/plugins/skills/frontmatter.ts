import type { InvocationPolicy, SkillFrontmatter, SlashbotMetadata } from './types.js';

/**
 * Parse frontmatter from a skill file.
 *
 * Handles multi-line JSON metadata blocks like:
 * ```yaml
 * metadata:
 *   {
 *     "slashbot": { "emoji": "...", "requires": { ... } }
 *   }
 * ```
 * as well as single-line JSON: `metadata: { "slashbot": { ... } }`
 */
export function parseFrontmatter(content: string): SkillFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const raw: Record<string, unknown> = {};

  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    // Check if this value starts a JSON object/array
    if (rawValue.startsWith('{') || rawValue.startsWith('[')) {
      const accumulated = accumulateJson(rawValue, lines, i);
      i = accumulated.nextIndex;
      try {
        raw[key] = JSON.parse(accumulated.json);
      } catch {
        raw[key] = rawValue;
      }
      continue;
    }

    // Value is empty — next line(s) may contain a multi-line JSON block
    if (rawValue === '') {
      const nextNonEmpty = findNextNonEmpty(lines, i + 1);
      if (nextNonEmpty !== -1) {
        const nextTrimmed = lines[nextNonEmpty].trim();
        if (nextTrimmed.startsWith('{') || nextTrimmed.startsWith('[')) {
          const accumulated = accumulateJson(nextTrimmed, lines, nextNonEmpty);
          i = accumulated.nextIndex;
          try {
            raw[key] = JSON.parse(accumulated.json);
          } catch {
            raw[key] = '';
          }
          continue;
        }
      }
      raw[key] = '';
      i++;
      continue;
    }

    // Simple YAML array: [a, b, c]
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      raw[key] = rawValue
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    } else {
      raw[key] = rawValue;
    }
    i++;
  }

  // Build SkillFrontmatter
  const result: SkillFrontmatter = {};
  if (typeof raw.name === 'string') result.name = raw.name;
  if (typeof raw.description === 'string') result.description = raw.description;
  if (typeof raw.homepage === 'string') result.homepage = raw.homepage;
  if (raw.userInvocable !== undefined) result.userInvocable = raw.userInvocable === 'true' || raw.userInvocable === true;
  if (raw.disableModelInvocation !== undefined)
    result.disableModelInvocation = raw.disableModelInvocation === 'true' || raw.disableModelInvocation === true;

  // Extract slashbot metadata
  const metadata = raw.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const sb = (metadata as Record<string, unknown>).slashbot;
    if (sb && typeof sb === 'object' && !Array.isArray(sb)) {
      result.slashbot = sb as SlashbotMetadata;
    }
  }

  return result;
}

/** Strip the frontmatter block from content. */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n*/, '').trim();
}

/** Resolve invocation policy from frontmatter with defaults. */
export function resolveInvocationPolicy(fm: SkillFrontmatter): InvocationPolicy {
  return {
    userInvocable: fm.userInvocable !== false,
    disableModelInvocation: fm.disableModelInvocation === true,
  };
}

// ── Helpers ──

function findNextNonEmpty(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim().length > 0) return i;
  }
  return -1;
}

/**
 * Accumulate lines starting from a JSON opener until braces/brackets balance.
 * Returns the concatenated JSON string and the next line index to continue from.
 */
function accumulateJson(
  firstLine: string,
  lines: string[],
  startIndex: number,
): { json: string; nextIndex: number } {
  let depth = 0;
  let json = firstLine;

  for (let c = 0; c < firstLine.length; c++) {
    if (firstLine[c] === '{' || firstLine[c] === '[') depth++;
    else if (firstLine[c] === '}' || firstLine[c] === ']') depth--;
  }

  if (depth === 0) {
    return { json, nextIndex: startIndex + 1 };
  }

  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    json += ' ' + line.trim();
    for (let c = 0; c < line.length; c++) {
      if (line[c] === '{' || line[c] === '[') depth++;
      else if (line[c] === '}' || line[c] === ']') depth--;
    }
    if (depth <= 0) {
      return { json, nextIndex: i + 1 };
    }
  }

  return { json, nextIndex: lines.length };
}
