/**
 * Action Tag Utilities - Uses <action> XML syntax
 * Aligned with Claude Code tool schema
 */

const ACTION_TAG_PATTERNS = [
  // Thinking/reasoning (should never be shown to user)
  /<think>[\s\S]*?<\/think>/g,
  /<thinking>[\s\S]*?<\/thinking>/g,
  /<reasoning>[\s\S]*?<\/reasoning>/g,
  /<inner_monologue>[\s\S]*?<\/inner_monologue>/g,
  // Shell commands
  /<bash[^>]*>[\s\S]*?<\/bash>/g,
  /<exec\s*>[\s\S]*?<\/exec>/g,
  /<explore[^>]*\/>/g,
  /<grep[^>]*\/>/g,
  /<glob[^>]*\/>/g,
  /<ls[^>]*\/>/g,
  /<read[^>]*\/>/g,
  /<edit[^>]*\/>/g,
  /<write[^>]*\/>/g,
  /<multi-edit[^>]*>[\s\S]*?<\/multi-edit>/g,
  /<plan[^>]*\/>/g,
  /<git[^>]*\/>/g,
  /<format[^>]*\/>/g,
  /<typecheck[^>]*\/>/g,
  /<fetch[^>]*\/>/g,
  /<search[^>]*\/>/g,
  /<notify[^>]*\/>/g,
  /<schedule[^>]*\/>/g,
  /<task[^>]*\/>/g,
  /<skill[^>]*\/>/g,
  /<skill-install[^>]*\/>/g,
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
  /<notify[^>]*\/>/g,
  /<notify[^>]*>[\s\S]*?<\/notify>/g,
  // Skills
  /<skill[^>]*\/>/g,
  /<skill[^>]*>[\s\S]*?<\/skill>/g,
  /<skill-install[^>]*\/>/g,
  /<skill-install[^>]*>[\s\S]*?<\/skill-install>/g,
  // Plan management (silent - should never show)
  /<plan[^>]*\/>/g,
  /<plan[^>]*>[\s\S]*?<\/plan>/g,
  // Task spawning
  /<task[^>]*>[\s\S]*?<\/task>/g,
  // Process management
  /<ps[^>]*\/>/g,
  /<kill[^>]*\/>/g,
  // Connector config
  /<telegram-config[^>]*\/>/g,
  /<discord-config[^>]*\/>/g,
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
  result = result.replace(
    /<(bash|read|edit|multi-edit|write|create|exec|glob|grep|ls|git|fetch|search|format|typecheck|schedule|notify|skill|skill-install|plan|task|explore|ps|kill|telegram-config|discord-config|replace)[^>]*\/?>/gi,
    '',
  );
  result = result.replace(
    /<\/(bash|read|edit|multi-edit|write|create|exec|glob|grep|ls|git|fetch|search|format|typecheck|schedule|notify|skill|skill-install|plan|task|explore|ps|kill|telegram-config|discord-config|replace)>/gi,
    '',
  );
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
 */
export function cleanSelfDialogue(content: string): string {
  if (typeof content !== 'string') return '';

  // Split into lines and filter aggressively
  const lines = content.split('\n');
  const cleanLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;

    // Skip very short lines (single chars, just "I", etc.)
    if (trimmed.length <= 2) return false;

    // Skip short confirmation lines
    if (
      /^(Yes|No|Done|Good|Perfect|Correct|Right|OK|Okay|Indeed|Exactly|Then|So|But|Now|And|First|Next|I)\.?\s*$/i.test(
        trimmed,
      )
    ) {
      return false;
    }

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
