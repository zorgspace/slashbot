/**
 * Action Tag Utilities - Uses [[action]] syntax to avoid false positives
 */

const ACTION_TAG_PATTERNS = [
  /\[\[grep[^\]]*\]\][\s\S]*?\[\[\/grep\]\]/g,
  /\[\[read[^\]]*\s*\/?\]\]/g,
  /\[\[read[^\]]*\]\][\s\S]*?\[\[\/read\]\]/g,
  /\[\[edit[^\]]*\]\][\s\S]*?\[\[\/edit\]\]/g,
  /\[\[create[^\]]*\]\][\s\S]*?\[\[\/create\]\]/g,
  /\[\[exec\]\][\s\S]*?\[\[\/exec\]\]/g,
  /\[\[schedule[^\]]*\]\][\s\S]*?\[\[\/schedule\]\]/g,
  /\[\[notify[^\]]*\]\][\s\S]*?\[\[\/notify\]\]/g,
  /\[\[skill[^\]]*\s*\/?\]\]/g,
  /\[\[plan\]\][\s\S]*?\[\[\/plan\]\]/g,
  // Also clean inner tags
  /\[\[search\]\][\s\S]*?\[\[\/search\]\]/g,
  /\[\[replace\]\][\s\S]*?\[\[\/replace\]\]/g,
];

/**
 * Remove all action tags from content
 */
export function cleanXmlTags(content: string | unknown): string {
  if (typeof content !== 'string') {
    return typeof content === 'undefined' || content === null ? '' : String(content);
  }
  let result = content;
  for (const pattern of ACTION_TAG_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, 'g'), '');
  }
  // Catch any remaining [[...]] tags
  result = result.replace(/\[\[[^\]]+\]\]/g, '');
  return result.trim();
}

/**
 * Extract attribute value from a tag string (works with [[action attr="value"]])
 */
export function extractXmlAttribute(tag: string, attr: string): string | null {
  const regex = new RegExp(`${attr}=["']([^"']+)["']`);
  const match = tag.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract content between opening and closing tags ([[tag]]content[[/tag]])
 */
export function extractTagContent(tag: string, tagName: string): string | null {
  const regex = new RegExp(`\\[\\[${tagName}[^\\]]*\\]\\]([\\s\\S]*?)\\[\\[\\/${tagName}\\]\\]`, 'i');
  const match = tag.match(regex);
  return match ? match[1] : null;
}
