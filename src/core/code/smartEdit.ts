/**
 * Smart Edit - Intelligent code editing for LLMs
 *
 * Features:
 * - Fuzzy matching with Levenshtein distance
 * - Line-by-line matching with context awareness
 * - Auto-indentation detection and correction
 * - Multiple matching strategies with fallback
 * - Detailed error reporting with suggestions
 */

import { distance as levenshtein } from 'fastest-levenshtein';
import DiffMatchPatch from 'diff-match-patch';

const dmp = new DiffMatchPatch();

export interface SmartEditResult {
  success: boolean;
  matchType?: 'exact' | 'normalized' | 'fuzzy' | 'line-context' | 'indent-corrected' | 'dmp-match';
  originalMatch?: string;
  confidence?: number;
  suggestions?: string[];
  error?: string;
}

export interface MatchResult {
  found: boolean;
  matchedText: string;
  matchType: string;
  confidence: number;
  startLine?: number;
  endLine?: number;
}

/**
 * Smart matching engine for finding code patterns
 */
export class SmartMatcher {
  private readonly FUZZY_THRESHOLD = 0.85; // 85% similarity required for fuzzy match
  private readonly MAX_CONTEXT_LINES = 5;

  /**
   * Find the best match for a search pattern in content
   * Tries multiple strategies in order of precision
   */
  findMatch(content: string, search: string): MatchResult {
    // Strategy 1: Exact match
    if (content.includes(search)) {
      return {
        found: true,
        matchedText: search,
        matchType: 'exact',
        confidence: 1.0,
      };
    }

    // Strategy 2: Normalized whitespace match
    const normalizedMatch = this.findNormalizedMatch(content, search);
    if (normalizedMatch) {
      return {
        found: true,
        matchedText: normalizedMatch.text,
        matchType: 'normalized',
        confidence: 0.95,
        startLine: normalizedMatch.startLine,
        endLine: normalizedMatch.endLine,
      };
    }

    // Strategy 3: Indentation-corrected match
    const indentMatch = this.findIndentCorrectedMatch(content, search);
    if (indentMatch) {
      return {
        found: true,
        matchedText: indentMatch.text,
        matchType: 'indent-corrected',
        confidence: 0.9,
        startLine: indentMatch.startLine,
        endLine: indentMatch.endLine,
      };
    }

    // Strategy 4: Line-by-line context match
    const contextMatch = this.findContextMatch(content, search);
    if (contextMatch) {
      return {
        found: true,
        matchedText: contextMatch.text,
        matchType: 'line-context',
        confidence: contextMatch.confidence,
        startLine: contextMatch.startLine,
        endLine: contextMatch.endLine,
      };
    }

    // Strategy 5: DMP match (diff-match-patch bitap algorithm)
    const dmpMatch = this.findDmpMatch(content, search);
    if (dmpMatch) {
      return {
        found: true,
        matchedText: dmpMatch.text,
        matchType: 'dmp-match',
        confidence: dmpMatch.confidence,
        startLine: dmpMatch.startLine,
        endLine: dmpMatch.endLine,
      };
    }

    // Strategy 6: Fuzzy match (for small edits using Levenshtein)
    const fuzzyMatch = this.findFuzzyMatch(content, search);
    if (fuzzyMatch) {
      return {
        found: true,
        matchedText: fuzzyMatch.text,
        matchType: 'fuzzy',
        confidence: fuzzyMatch.confidence,
        startLine: fuzzyMatch.startLine,
        endLine: fuzzyMatch.endLine,
      };
    }

    return {
      found: false,
      matchedText: '',
      matchType: 'none',
      confidence: 0,
    };
  }

  /**
   * Normalized whitespace matching
   */
  private findNormalizedMatch(
    content: string,
    search: string,
  ): { text: string; startLine: number; endLine: number } | null {
    // Normalize line endings and trailing whitespace only
    const normalize = (s: string) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');

    const normalizedContent = normalize(content);
    const normalizedSearch = normalize(search);

    if (normalizedContent.includes(normalizedSearch)) {
      const idx = normalizedContent.indexOf(normalizedSearch);
      const beforeMatch = normalizedContent.substring(0, idx);
      const startLine = beforeMatch.split('\n').length;
      const endLine = startLine + normalizedSearch.split('\n').length - 1;

      // Extract the actual text from original content
      const lines = content.split('\n');
      const matchedText = lines.slice(startLine - 1, endLine).join('\n');

      return { text: matchedText, startLine, endLine };
    }

    return null;
  }

  /**
   * Find match with corrected indentation
   * Handles cases where LLM uses wrong indent (tabs vs spaces, wrong depth)
   */
  private findIndentCorrectedMatch(
    content: string,
    search: string,
  ): { text: string; startLine: number; endLine: number } | null {
    const contentLines = content.split('\n');
    const searchLines = search.split('\n').filter(l => l.trim().length > 0);

    if (searchLines.length === 0) return null;

    // Get trimmed search lines for comparison
    const searchTrimmed = searchLines.map(l => l.trim());
    const firstSearchLine = searchTrimmed[0];

    // Find potential starting points
    for (let i = 0; i < contentLines.length; i++) {
      if (contentLines[i].trim() !== firstSearchLine) continue;

      // Try to match all search lines from this position
      let allMatch = true;
      let searchIdx = 0;
      let contentIdx = i;
      const matchedIndices: number[] = [];

      while (searchIdx < searchTrimmed.length && contentIdx < contentLines.length) {
        const contentTrimmed = contentLines[contentIdx].trim();

        // Skip empty lines in content
        if (contentTrimmed === '' && searchTrimmed[searchIdx] !== '') {
          contentIdx++;
          continue;
        }

        if (contentTrimmed === searchTrimmed[searchIdx]) {
          matchedIndices.push(contentIdx);
          searchIdx++;
        } else if (contentTrimmed !== '' && searchTrimmed[searchIdx] !== '') {
          allMatch = false;
          break;
        }
        contentIdx++;
      }

      if (allMatch && searchIdx === searchTrimmed.length && matchedIndices.length > 0) {
        const startLine = matchedIndices[0] + 1;
        const endLine = matchedIndices[matchedIndices.length - 1] + 1;
        const matchedText = contentLines
          .slice(matchedIndices[0], matchedIndices[matchedIndices.length - 1] + 1)
          .join('\n');
        return { text: matchedText, startLine, endLine };
      }
    }

    return null;
  }

  /**
   * Context-based matching - uses surrounding lines to find location
   */
  private findContextMatch(
    content: string,
    search: string,
  ): { text: string; startLine: number; endLine: number; confidence: number } | null {
    const contentLines = content.split('\n');
    const searchLines = search.split('\n');

    if (searchLines.length < 2) return null;

    // Find unique "anchor" lines that appear only once in content
    const anchors: { line: string; searchIdx: number; contentIdx: number }[] = [];

    for (let si = 0; si < searchLines.length; si++) {
      const searchLine = searchLines[si].trim();
      if (searchLine.length < 10) continue; // Skip short lines

      const contentMatches = contentLines
        .map((l, i) => ({ line: l.trim(), idx: i }))
        .filter(c => c.line === searchLine);

      if (contentMatches.length === 1) {
        anchors.push({
          line: searchLine,
          searchIdx: si,
          contentIdx: contentMatches[0].idx,
        });
      }
    }

    if (anchors.length === 0) return null;

    // Use anchors to determine the match region
    const anchor = anchors[0];
    const expectedStart = anchor.contentIdx - anchor.searchIdx;
    const expectedEnd = expectedStart + searchLines.length - 1;

    if (expectedStart < 0 || expectedEnd >= contentLines.length) return null;

    // Verify the match region
    let matchCount = 0;
    for (let i = 0; i < searchLines.length; i++) {
      const searchTrimmed = searchLines[i].trim();
      const contentTrimmed = contentLines[expectedStart + i]?.trim() || '';

      if (searchTrimmed === contentTrimmed || searchTrimmed === '' || contentTrimmed === '') {
        matchCount++;
      }
    }

    const confidence = matchCount / searchLines.length;
    if (confidence < 0.7) return null;

    const matchedText = contentLines.slice(expectedStart, expectedEnd + 1).join('\n');
    return {
      text: matchedText,
      startLine: expectedStart + 1,
      endLine: expectedEnd + 1,
      confidence,
    };
  }

  /**
   * Fuzzy matching using diff-match-patch's Bitap algorithm
   * Better for finding text with small variations
   */
  private findDmpMatch(
    content: string,
    search: string,
  ): { text: string; startLine: number; endLine: number; confidence: number } | null {
    // DMP match_main works best with shorter patterns
    // For longer patterns, we'll match first lines and expand
    const searchLines = search.split('\n');
    const contentLines = content.split('\n');

    if (searchLines.length === 0) return null;

    // Skip DMP matching for very long content to avoid "Pattern too long" errors
    if (content.length > 50000 || search.length > 5000) return null;

    // Get first non-empty line as anchor
    const firstNonEmpty = searchLines.find(l => l.trim().length > 0);
    if (!firstNonEmpty || firstNonEmpty.length < 10) return null;

    // DMP match threshold (0.0 = exact, 1.0 = very loose)
    dmp.Match_Threshold = 0.3;
    dmp.Match_Distance = 1000;

    // Try to find the first line in content
    const contentJoined = contentLines.join('\n');
    const matchIdx = dmp.match_main(contentJoined, firstNonEmpty.trim(), 0);

    if (matchIdx === -1) return null;

    // Found a match - determine which line this is
    const beforeMatch = contentJoined.substring(0, matchIdx);
    const startLine = beforeMatch.split('\n').length;

    // Now try to match the full pattern from this line
    const endLine = Math.min(startLine + searchLines.length - 1, contentLines.length);
    const candidateText = contentLines.slice(startLine - 1, endLine).join('\n');

    // Compute similarity using diffs
    const diffs = dmp.diff_main(search, candidateText);
    dmp.diff_cleanupSemantic(diffs);

    // Calculate similarity from diffs
    let commonLength = 0;
    let totalLength = 0;
    for (const [op, text] of diffs) {
      if (op === 0) {
        // DIFF_EQUAL
        commonLength += text.length;
      }
      totalLength += text.length;
    }

    const similarity =
      totalLength > 0 ? (commonLength * 2) / (search.length + candidateText.length) : 0;

    if (similarity >= 0.8) {
      return {
        text: candidateText,
        startLine,
        endLine,
        confidence: similarity,
      };
    }

    return null;
  }

  /**
   * Fuzzy matching using Levenshtein distance
   * Only for short patterns to avoid false positives
   */
  private findFuzzyMatch(
    content: string,
    search: string,
  ): { text: string; startLine: number; endLine: number; confidence: number } | null {
    // Only use fuzzy matching for short patterns (< 500 chars)
    if (search.length > 500) return null;

    const contentLines = content.split('\n');
    const searchLines = search.split('\n');
    const searchLength = search.length;

    let bestMatch: { text: string; startLine: number; endLine: number; similarity: number } | null =
      null;

    // Slide a window over content lines
    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      const windowText = contentLines.slice(i, i + searchLines.length).join('\n');
      const windowLength = windowText.length;

      // Quick length check - must be within 20% of search length
      if (Math.abs(windowLength - searchLength) > searchLength * 0.2) continue;

      const dist = levenshtein(search, windowText);
      const maxLen = Math.max(searchLength, windowLength);
      const similarity = 1 - dist / maxLen;

      if (similarity >= this.FUZZY_THRESHOLD && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = {
          text: windowText,
          startLine: i + 1,
          endLine: i + searchLines.length,
          similarity,
        };
      }
    }

    if (bestMatch) {
      return {
        text: bestMatch.text,
        startLine: bestMatch.startLine,
        endLine: bestMatch.endLine,
        confidence: bestMatch.similarity,
      };
    }

    return null;
  }

  /**
   * Find similar patterns for suggestions
   */
  findSuggestions(content: string, search: string, maxSuggestions = 3): string[] {
    const suggestions: string[] = [];
    const contentLines = content.split('\n');
    const searchLines = search.split('\n');
    const firstSearchLine = searchLines[0]?.trim() || '';

    if (firstSearchLine.length < 5) return suggestions;

    // Extract keywords from first line
    const keywords = firstSearchLine.split(/\s+/).filter(w => w.length > 3);

    for (let i = 0; i < contentLines.length && suggestions.length < maxSuggestions; i++) {
      const line = contentLines[i];
      const matchedKeywords = keywords.filter(kw => line.includes(kw));

      // If line matches enough keywords
      if (matchedKeywords.length >= Math.ceil(keywords.length * 0.5)) {
        const contextStart = i;
        const contextEnd = Math.min(i + searchLines.length, contentLines.length);
        const context = contentLines.slice(contextStart, contextEnd).join('\n');

        if (!suggestions.some(s => s === context)) {
          suggestions.push(context);
        }
      }
    }

    return suggestions;
  }
}

/**
 * Apply an edit with automatic indentation correction
 */
export function applySmartReplace(
  content: string,
  matchedText: string,
  replacement: string,
  matchStartLine?: number,
): string {
  // Detect the indentation of the matched text
  const matchedLines = matchedText.split('\n');
  const firstNonEmptyLine = matchedLines.find(l => l.trim().length > 0) || '';
  const matchIndent = firstNonEmptyLine.match(/^(\s*)/)?.[1] || '';

  // Detect the indentation of the replacement
  const replaceLines = replacement.split('\n');
  const firstReplaceNonEmpty = replaceLines.find(l => l.trim().length > 0) || '';
  const replaceIndent = firstReplaceNonEmpty.match(/^(\s*)/)?.[1] || '';

  // If indentation differs, adjust the replacement
  let adjustedReplacement = replacement;
  if (matchIndent !== replaceIndent) {
    // Calculate indent difference
    const matchIndentLen = matchIndent.length;
    const replaceIndentLen = replaceIndent.length;
    const indentDiff = matchIndentLen - replaceIndentLen;

    if (indentDiff > 0) {
      // Need to add indentation
      const addIndent = matchIndent.slice(0, indentDiff);
      adjustedReplacement = replaceLines.map(l => (l.trim() ? addIndent + l : l)).join('\n');
    } else if (indentDiff < 0) {
      // Need to preserve original indent style
      adjustedReplacement = replaceLines
        .map(l => {
          const lineIndent = l.match(/^(\s*)/)?.[1] || '';
          const trimmed = l.trimStart();
          if (!trimmed) return l;
          // Adjust relative indentation
          const relativeIndent = lineIndent.slice(Math.abs(indentDiff));
          return matchIndent + relativeIndent + trimmed;
        })
        .join('\n');
    }
  }

  return content.replace(matchedText, adjustedReplacement);
}

// Singleton instance
export const smartMatcher = new SmartMatcher();

/**
 * Compute semantic diff between two strings using diff-match-patch
 * Returns an array of [operation, text] tuples where:
 * - operation: -1 = delete, 0 = equal, 1 = insert
 */
export function computeDiff(oldText: string, newText: string): Array<[number, string]> {
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);
  return diffs;
}

/**
 * Compute line-based diff for display purposes
 * Returns arrays of removed and added lines
 */
export function computeLineDiff(
  oldText: string,
  newText: string,
): {
  removed: string[];
  added: string[];
  common: number;
} {
  const diffs = computeDiff(oldText, newText);
  const removed: string[] = [];
  const added: string[] = [];
  let common = 0;

  for (const [op, text] of diffs) {
    const lines = text.split('\n').filter(l => l.length > 0);
    if (op === -1) {
      removed.push(...lines);
    } else if (op === 1) {
      added.push(...lines);
    } else {
      common += lines.length;
    }
  }

  return { removed, added, common };
}

/**
 * Export dmp instance for direct use
 */
export { dmp };
