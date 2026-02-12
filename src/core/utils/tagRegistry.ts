/**
 * Dynamic Action Tag Registry
 *
 * Plugins register their action tags here. Core utilities (xml.ts, client.ts)
 * use getRegisteredTags() instead of hardcoded tag lists.
 */

const BUILTIN_TAGS = ['think', 'thinking', 'reasoning', 'inner_monologue'];

const registeredTags = new Set<string>(BUILTIN_TAGS);

function expandTagAliases(tags: string[]): string[] {
  const expanded = new Set<string>();

  for (const rawTag of tags) {
    const tag = rawTag.trim().toLowerCase();
    if (!tag) continue;
    expanded.add(tag);
    if (tag.includes('-')) {
      expanded.add(tag.replace(/-/g, '_'));
    }
    if (tag.includes('_')) {
      expanded.add(tag.replace(/_/g, '-'));
    }
  }

  return Array.from(expanded);
}

/**
 * Register action tags (called automatically from registerActionParser)
 */
export function registerActionTags(tags: string[]): void {
  for (const tag of expandTagAliases(tags)) {
    registeredTags.add(tag);
  }
}

/**
 * Unregister action tags (never removes builtins)
 */
export function unregisterActionTags(tags: string[]): void {
  for (const tag of expandTagAliases(tags)) {
    if (!BUILTIN_TAGS.includes(tag)) {
      registeredTags.delete(tag);
    }
  }
}

/**
 * Get all registered action tags (builtin + plugin-registered)
 */
export function getRegisteredTags(): string[] {
  return Array.from(registeredTags);
}
