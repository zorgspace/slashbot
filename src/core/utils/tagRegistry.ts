/**
 * Dynamic Action Tag Registry
 *
 * Plugins register their action tags here. Core utilities (xml.ts, client.ts)
 * use getRegisteredTags() instead of hardcoded tag lists.
 */

const BUILTIN_TAGS = ['think', 'thinking', 'reasoning', 'inner_monologue'];

const registeredTags = new Set<string>(BUILTIN_TAGS);

/**
 * Register action tags (called automatically from registerActionParser)
 */
export function registerActionTags(tags: string[]): void {
  for (const tag of tags) {
    registeredTags.add(tag);
  }
}

/**
 * Get all registered action tags (builtin + plugin-registered)
 */
export function getRegisteredTags(): string[] {
  return Array.from(registeredTags);
}
