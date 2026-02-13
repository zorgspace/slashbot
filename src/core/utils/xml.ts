/**
 * Action Tag Utilities - Uses <action> XML syntax
 * Aligned with Claude Code tool schema
 *
 * Uses dynamic tag registry instead of hardcoded tag lists.
 */

import { getRegisteredTags } from './tagRegistry';

/**
 * Build regex patterns for all registered action tags
 */
function buildActionTagPatterns(): RegExp[] {
  const tags = getRegisteredTags();
  const patterns: RegExp[] = [];

  for (const tag of tags) {
    // Full tags with content: <tag ...>...</tag>
    patterns.push(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'g'));
    // Self-closing tags: <tag .../>
    patterns.push(new RegExp(`<${tag}[^>]*\\/>`, 'g'));
  }

  return patterns;
}

/**
 * Remove all action tags from content
 * Only removes KNOWN action tags - preserves arbitrary XML-like formatting tags
 */
export function cleanXmlTags(content: string | unknown): string {
  if (typeof content !== 'string') {
    return typeof content === 'undefined' || content === null ? '' : String(content);
  }
  let result = content;

  for (const pattern of buildActionTagPatterns()) {
    result = result.replace(new RegExp(pattern.source, 'g'), '');
  }

  const tags = getRegisteredTags();
  const tagAlt = tags.join('|');

  // Catch remaining action tags that have attributes (path=, query=, pattern=, etc.)
  // These are clearly action invocations, not formatting tags
  result = result.replace(new RegExp(`<(${tagAlt})\\s+[^>]*\\/?>`, 'gi'), '');
  // Catch orphan <say> opening tags (content already extracted above)
  result = result.replace(/<say\s*>/gi, '');
  // Catch closing tags for action types (unambiguous)
  result = result.replace(new RegExp(`<\\/(${tagAlt}|say)>`, 'gi'), '');
  // Clean up conflict markers that shouldn't appear in output
  result = result.replace(
    /<<<<<<< SEARCH(?:@\d+(?:-\d+)?)?\n[\s\S]*?\n=======\n[\s\S]*?\n>>>>>>> REPLACE/g,
    '',
  );
  // Clean partial/broken tags at start or end
  result = result.replace(/^[a-z]*">\s*/i, ''); // Partial tag at start like `h">`
  result = result.replace(/<\/[a-z-]*$/i, ''); // Incomplete closing tag at end like `</`
  result = result.replace(/<[a-z-]*">\s*/gi, ''); // Malformed opening with stray quote

  // Strip xAI tool call XML and literal placeholders to prevent display in chat
  result = result.replace(/<xai:function_call\b[^>]*>[\s\S]*?<\/xai:function_call>/gi, '');
  result = result.replace(/\[tool calls?\]/gi, '');
  // Prompt policy allows an optional <markdown> wrapper; unwrap it for rendering.
  result = unwrapMarkdownTags(result);

  return result.trim();
}

/**
 * Extract attribute value from a tag string (works with <action attr="value">)
 */
export function extractXmlAttribute(tag: string, attr: string): string | null {
  const regex = new RegExp(`${attr}=["']([^"']+)["']`);
  const match = tag.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract content between opening and closing tags (<tag>content</tag>)
 */
export function extractTagContent(tag: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = tag.match(regex);
  return match ? match[1] : null;
}

/**
 * Remove self-dialogue and verbose explanations from LLM output
 * Less aggressive when content is short to preserve meaningful responses
 */
export function cleanSelfDialogue(content: string): string {
  if (typeof content !== 'string') return '';

  // Split into lines
  const lines = content.split('\n');
  const nonEmptyLines = lines.filter(l => l.trim().length > 0);

  // If content is short (1-3 non-empty lines), be more permissive
  // This preserves short user-facing responses like "Let me check that file."
  const isShortContent = nonEmptyLines.length <= 3;

  const cleanLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;

    // Skip very short lines (single chars, just "I", etc.)
    if (trimmed.length <= 2) return false;

    // Skip short confirmation lines (always filter these)
    if (
      /^(Yes|No|Done|Good|Perfect|Correct|Right|OK|Okay|Indeed|Exactly|Then|So|But|Now|And|First|Next|I)\.?\s*$/i.test(
        trimmed,
      )
    ) {
      return false;
    }

    // For short content, be more permissive - only filter clearly internal patterns
    if (isShortContent) {
      // Only filter very obvious internal monologue
      if (
        /^(The (response|answer|result|output|final|summary) (is|will|should)|So the output|The boxed is|But in the response)/i.test(
          trimmed,
        )
      ) {
        return false;
      }
      return true;
    }

    // For longer content, apply more aggressive filtering
    // Skip internal monologue patterns
    if (
      /^(Then,?|But\s|So,?|Now,?|And\s|First,?|Next,?|Since\s|Because\s|However,?|Therefore,?|Perhaps\s|Maybe\s|Let me|Let's|I think|I will|I can|I need|I should|To (do|see|check|follow|complete|implement|wrap|end|fix)|The (response|answer|result|output|idea|plan|task|final|summary|conversation)|This (will|is|might|shows|suggests)|If (it|the|we)|For example)/i.test(
        trimmed,
      )
    ) {
      return false;
    }

    // Skip lines about grep/sed/actions
    if (
      /\b(grep|sed|awk|the sed|the grep|output the|do the|will show|the current|in the next|didn't match|didn't change|with hyphen|with colon|with space)\b/i.test(
        trimmed,
      )
    ) {
      return false;
    }

    // Skip LaTeX boxed answers
    if (/\\boxed\{|^\*\*Final Answer\*\*$/i.test(trimmed)) {
      return false;
    }

    // Skip lines that are just about the format/response
    if (
      /^(The format is|Just the summary|So the output|The boxed is|But in the response)/i.test(
        trimmed,
      )
    ) {
      return false;
    }

    return true;
  });

  // Join and clean up
  let result = cleanLines.join('\n');

  // Remove any remaining inline "Yes." patterns
  result = result.replace(/\bYes\.\s*/gi, '');

  // Remove excessive newlines
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

export function unwrapMarkdownTags(content: string): string {
  return content.replace(/<markdown>([\s\S]*?)<\/markdown>/gi, '$1');
}
