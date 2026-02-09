/**
 * Planning Trigger Detection
 *
 * Detects user intent to plan substantial changes.
 * Strong triggers always activate; medium triggers require a longer message.
 */

// Strong triggers — always activate planning mode
const STRONG_PATTERNS: RegExp[] = [
  /\bplan\s+to\b/i,
  /\blet'?s\s+plan\b/i,
  /\bmake\s+a\s+plan\b/i,
  /\bplan\s+(?:the|an?|how|for)\b/i,
  /\bimplementation\s+plan\b/i,
  /\bplan\s+(?:the\s+)?implementation\b/i,
  /\brearchitect\b/i,
  /\boverhaul\b/i,
];

// Medium triggers — activate if message has substance (>40 chars)
const MEDIUM_PATTERNS: RegExp[] = [
  /\brefactor\b/i,
  /\brestructure\b/i,
  /\bredesign\b/i,
  /\bmigrat(?:e|ion)\b/i,
];

const MIN_MEDIUM_LENGTH = 40;

/**
 * Returns true if the user message should trigger planning mode.
 */
export function detectPlanningTrigger(input: string): boolean {
  const trimmed = input.trim();

  for (const pattern of STRONG_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  if (trimmed.length >= MIN_MEDIUM_LENGTH) {
    for (const pattern of MEDIUM_PATTERNS) {
      if (pattern.test(trimmed)) return true;
    }
  }

  return false;
}
