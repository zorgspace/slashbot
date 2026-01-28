/**
 * XML Utilities for Action Tag Handling
 */

const ACTION_TAG_PATTERNS = [
  /<grep[^>]*>[\s\S]*?<\/grep>/g,
  /<read[^>]*\s*\/?>/g,
  /<read[^>]*>[\s\S]*?<\/read>/g,
  /<edit[^>]*>[\s\S]*?<\/edit>/g,
  /<create[^>]*>[\s\S]*?<\/create>/g,
  /<exec>[\s\S]*?<\/exec>/g,
  /<schedule[^>]*>[\s\S]*?<\/schedule>/g,
  /<notify[^>]*>[\s\S]*?<\/notify>/g,
  /<skill[^>]*\s*\/?>/g,
  /<plan>[\s\S]*?<\/plan>/g,
];

/**
 * Remove all action XML tags from content
 */
export function cleanXmlTags(content: string): string {
  let result = content;
  for (const pattern of ACTION_TAG_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, 'g'), '');
  }
  // Catch any remaining tags
  result = result.replace(/<[^>]+>/g, '');
  return result.trim();
}

/**
 * Extract attribute value from an XML tag string
 */
export function extractXmlAttribute(tag: string, attr: string): string | null {
  const regex = new RegExp(`${attr}="([^"]+)"`);
  const match = tag.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract content between opening and closing tags
 */
export function extractTagContent(tag: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = tag.match(regex);
  return match ? match[1] : null;
}
