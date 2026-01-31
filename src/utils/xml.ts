/**
 * Action Tag Utilities - Uses <action> XML syntax
 * Aligned with Claude Code tool schema
 */

const ACTION_TAG_PATTERNS = [
  // Shell commands
  /<bash[^>]*>[\s\S]*?<\/bash>/g,
  /<exec\s*>[\s\S]*?<\/exec>/g,
  // File operations
  /<read[^>]*\/>/g,
  /<read[^>]*>[\s\S]*?<\/read>/g,
  /<edit[^>]*>[\s\S]*?<\/edit>/g,
  /<multi-edit[^>]*>[\s\S]*?<\/multi-edit>/g,
  /<write[^>]*>[\s\S]*?<\/write>/g,
  /<create[^>]*>[\s\S]*?<\/create>/g,
  // Search & navigation
  /<glob[^>]*\/>/g,
  /<glob[^>]*>[\s\S]*?<\/glob>/g,
  /<grep[^>]*>[\s\S]*?<\/grep>/g,
  /<grep[^>]*\/>/g,
  /<ls[^>]*\/>/g,
  /<ls[^>]*>[\s\S]*?<\/ls>/g,
  // Git operations
  /<git[^>]*\/>/g,
  /<git[^>]*>[\s\S]*?<\/git>/g,
  // Web operations
  /<fetch[^>]*\/>/g,
  /<fetch[^>]*>[\s\S]*?<\/fetch>/g,
  /<search[^>]*\/>/g,
  /<search[^>]*>[\s\S]*?<\/search>/g,
  // Code quality
  /<format[^>]*\/>/g,
  /<format[^>]*>[\s\S]*?<\/format>/g,
  /<typecheck[^>]*\/>/g,
  /<typecheck[^>]*>[\s\S]*?<\/typecheck>/g,
  // Scheduling & notifications
  /<schedule[^>]*>[\s\S]*?<\/schedule>/g,
  /<notify[^>]*>[\s\S]*?<\/notify>/g,
  // Skills
  /<skill[^>]*\/>/g,
  /<skill[^>]*>[\s\S]*?<\/skill>/g,
  /<skill-install[^>]*\/>/g,
  /<skill-install[^>]*>[\s\S]*?<\/skill-install>/g,
  // Inner tags (used inside edit/multi-edit)
  /<search>[\s\S]*?<\/search>/g,
  /<replace>[\s\S]*?<\/replace>/g,
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
  // Catch any remaining action-like XML tags (opening and closing)
  result = result.replace(/<(bash|read|edit|multi-edit|write|create|exec|glob|grep|ls|git|fetch|search|format|typecheck|schedule|notify|skill|skill-install|replace)[^>]*\/?>/gi, '');
  result = result.replace(/<\/(bash|read|edit|multi-edit|write|create|exec|glob|grep|ls|git|fetch|search|format|typecheck|schedule|notify|skill|skill-install|replace)>/gi, '');
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
  const regex = new RegExp(
    `<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    'i',
  );
  const match = tag.match(regex);
  return match ? match[1] : null;
}

/**
 * Remove self-dialogue and verbose explanations from LLM output
 */
export function cleanSelfDialogue(content: string): string {
  if (typeof content !== 'string') return '';

  let result = content;

  // Remove verbose explanation patterns
  result = result.replace(/^(Let me|Let's|I need to|I should|I will|I'll|Now I|Next,?\s|First,?\s|Reading|Checking|Looking|Trying|Installing|Running|Executing|Building|The build|This suggests|This might|This is|After this|If it|Perhaps|Maybe|Alternative|Since|Because|However|Therefore|Let's check|Let's try|Let's see|Let's do|Action:|### Action).*/gim, '');

  // Remove repeated "Yes.", "Done.", "Good.", etc. patterns
  result = result.replace(/\b(Yes|Done|Good|Perfect|Correct|Right|OK|Okay|Indeed|Exactly|Acknowledged?)\.\s*/gi, '');

  // Remove self-questioning patterns
  result = result.replace(/^(So,?\s|But\s|I think\s|To be\s|The\s(answer|response|output|result)\s(is|would be)\s).*/gim, '');

  // Remove lines that are just confirmations
  result = result.replace(/^\s*(Yes|No|Done|Good|Perfect|Correct|OK|Okay|End|Final|Acknowledged?)\.?\s*$/gim, '');

  // Remove "... successfully" standalone lines
  result = result.replace(/^.*successfully[.;]?\s*$/gim, '');

  // Remove excessive newlines left behind
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}
