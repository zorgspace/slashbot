/**
 * Cascading replacer system for search/replace edits.
 * Ported from OpenCode's battle-tested 9-strategy approach.
 *
 * Each replacer is a generator that yields candidate replacements
 * from strictest (exact match) to most lenient (context-aware fuzzy).
 * The first successful match wins.
 */

// ── Result types ────────────────────────────────────────────────

export interface ReplaceResult {
  ok: true;
  content: string;
  strategy: string;
}

export interface ReplaceFailure {
  ok: false;
  message: string;
}

// ── Levenshtein distance ────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ── Replacer type ───────────────────────────────────────────────

type Replacer = (content: string, search: string, replace: string) => Generator<string, void, undefined>;

// ── 1. SimpleReplacer – exact string match ──────────────────────

function* SimpleReplacer(content: string, search: string, replace: string): Generator<string> {
  const idx = content.indexOf(search);
  if (idx !== -1) {
    // Ensure unique match
    if (content.indexOf(search, idx + 1) !== -1) return;
    yield content.slice(0, idx) + replace + content.slice(idx + search.length);
  }
}

// ── 2. LineTrimmedReplacer – trim each line before compare ──────

function* LineTrimmedReplacer(content: string, search: string, replace: string): Generator<string> {
  const contentLines = content.split('\n');
  const searchLines = search.split('\n');

  // Strip leading/trailing empty lines from search
  while (searchLines.length > 0 && searchLines[0].trim() === '') searchLines.shift();
  while (searchLines.length > 0 && searchLines[searchLines.length - 1].trim() === '') searchLines.pop();
  if (searchLines.length === 0) return;

  const matches: number[] = [];

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let ok = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (contentLines[i + j].trim() !== searchLines[j].trim()) {
        ok = false;
        break;
      }
    }
    if (ok) matches.push(i);
  }

  if (matches.length !== 1) return;

  const i = matches[0];
  const replaceLines = replace.split('\n');
  const result = [...contentLines.slice(0, i), ...replaceLines, ...contentLines.slice(i + searchLines.length)];
  yield result.join('\n');
}

// ── 3. BlockAnchorReplacer – first/last line anchor + Levenshtein middle ─

function* BlockAnchorReplacer(content: string, search: string, replace: string): Generator<string> {
  const contentLines = content.split('\n');
  const searchLines = search.split('\n');

  while (searchLines.length > 0 && searchLines[0].trim() === '') searchLines.shift();
  while (searchLines.length > 0 && searchLines[searchLines.length - 1].trim() === '') searchLines.pop();
  if (searchLines.length < 3) return;

  const firstLine = searchLines[0].trim();
  const lastLine = searchLines[searchLines.length - 1].trim();
  const middleSearch = searchLines.slice(1, -1);

  const candidates: number[] = [];

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue;
    const endIdx = i + searchLines.length - 1;
    if (endIdx >= contentLines.length) continue;
    if (contentLines[endIdx].trim() !== lastLine) continue;

    // Verify middle lines via Levenshtein similarity (>= 60%)
    let middleOk = true;
    for (let j = 0; j < middleSearch.length; j++) {
      if (similarity(contentLines[i + 1 + j].trim(), middleSearch[j].trim()) < 0.6) {
        middleOk = false;
        break;
      }
    }
    if (middleOk) candidates.push(i);
  }

  if (candidates.length !== 1) return;

  const i = candidates[0];
  const replaceLines = replace.split('\n');
  const result = [...contentLines.slice(0, i), ...replaceLines, ...contentLines.slice(i + searchLines.length)];
  yield result.join('\n');
}

// ── 4. WhitespaceNormalizedReplacer – collapse \s+ → single space ─

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function* WhitespaceNormalizedReplacer(content: string, search: string, replace: string): Generator<string> {
  const contentLines = content.split('\n');
  const searchLines = search.split('\n');

  while (searchLines.length > 0 && searchLines[0].trim() === '') searchLines.shift();
  while (searchLines.length > 0 && searchLines[searchLines.length - 1].trim() === '') searchLines.pop();
  if (searchLines.length === 0) return;

  const normalizedSearch = searchLines.map(normalizeWhitespace);
  const matches: number[] = [];

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let ok = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (normalizeWhitespace(contentLines[i + j]) !== normalizedSearch[j]) {
        ok = false;
        break;
      }
    }
    if (ok) matches.push(i);
  }

  if (matches.length !== 1) return;

  const i = matches[0];
  const replaceLines = replace.split('\n');
  const result = [...contentLines.slice(0, i), ...replaceLines, ...contentLines.slice(i + searchLines.length)];
  yield result.join('\n');
}

// ── 5. IndentationFlexibleReplacer – strip common indent ────────

function stripCommonIndent(lines: string[]): string[] {
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length === 0) return lines;

  let minIndent = Infinity;
  for (const line of nonEmpty) {
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent < minIndent) minIndent = indent;
  }

  return lines.map(l => l.slice(minIndent));
}

function* IndentationFlexibleReplacer(content: string, search: string, replace: string): Generator<string> {
  const contentLines = content.split('\n');
  const searchLines = search.split('\n');

  while (searchLines.length > 0 && searchLines[0].trim() === '') searchLines.shift();
  while (searchLines.length > 0 && searchLines[searchLines.length - 1].trim() === '') searchLines.pop();
  if (searchLines.length === 0) return;

  const strippedSearch = stripCommonIndent(searchLines);
  const matches: number[] = [];

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const slice = contentLines.slice(i, i + searchLines.length);
    const strippedSlice = stripCommonIndent(slice);

    let ok = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (strippedSlice[j] !== strippedSearch[j]) {
        ok = false;
        break;
      }
    }
    if (ok) matches.push(i);
  }

  if (matches.length !== 1) return;

  const i = matches[0];
  const replaceLines = replace.split('\n');
  const result = [...contentLines.slice(0, i), ...replaceLines, ...contentLines.slice(i + searchLines.length)];
  yield result.join('\n');
}

// ── 6. EscapeNormalizedReplacer – handle \n, \t, etc. ───────────

function normalizeEscapes(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\\\/g, '\\');
}

function* EscapeNormalizedReplacer(content: string, search: string, replace: string): Generator<string> {
  const normalizedSearch = normalizeEscapes(search);
  if (normalizedSearch === search) return; // No escapes to normalize

  const idx = content.indexOf(normalizedSearch);
  if (idx === -1) return;
  if (content.indexOf(normalizedSearch, idx + 1) !== -1) return; // Not unique

  const normalizedReplace = normalizeEscapes(replace);
  yield content.slice(0, idx) + normalizedReplace + content.slice(idx + normalizedSearch.length);
}

// ── 7. TrimmedBoundaryReplacer – trim entire block boundaries ───

function* TrimmedBoundaryReplacer(content: string, search: string, replace: string): Generator<string> {
  const trimmedSearch = search.trim();
  if (trimmedSearch === search) return; // Nothing to trim
  if (trimmedSearch.length === 0) return;

  const idx = content.indexOf(trimmedSearch);
  if (idx === -1) return;
  if (content.indexOf(trimmedSearch, idx + 1) !== -1) return; // Not unique

  yield content.slice(0, idx) + replace + content.slice(idx + trimmedSearch.length);
}

// ── 8. ContextAwareReplacer – anchor lines + 50% middle threshold ─

function* ContextAwareReplacer(content: string, search: string, replace: string): Generator<string> {
  const contentLines = content.split('\n');
  const searchLines = search.split('\n');

  while (searchLines.length > 0 && searchLines[0].trim() === '') searchLines.shift();
  while (searchLines.length > 0 && searchLines[searchLines.length - 1].trim() === '') searchLines.pop();
  if (searchLines.length < 2) return;

  const firstLine = searchLines[0].trim();
  const lastLine = searchLines[searchLines.length - 1].trim();

  const candidates: number[] = [];

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue;
    const endIdx = i + searchLines.length - 1;
    if (endIdx >= contentLines.length) continue;
    if (contentLines[endIdx].trim() !== lastLine) continue;

    // Count middle lines that match (50% threshold)
    const middleCount = searchLines.length - 2;
    if (middleCount > 0) {
      let matchCount = 0;
      for (let j = 1; j < searchLines.length - 1; j++) {
        if (similarity(contentLines[i + j].trim(), searchLines[j].trim()) >= 0.5) {
          matchCount++;
        }
      }
      if (matchCount / middleCount < 0.5) continue;
    }

    candidates.push(i);
  }

  if (candidates.length !== 1) return;

  const i = candidates[0];
  const replaceLines = replace.split('\n');
  const result = [...contentLines.slice(0, i), ...replaceLines, ...contentLines.slice(i + searchLines.length)];
  yield result.join('\n');
}

// ── 9. MultiOccurrenceReplacer – replace all exact matches (for replaceAll) ─

function* MultiOccurrenceReplacer(content: string, search: string, replace: string): Generator<string> {
  if (!content.includes(search)) return;

  // Only yield if there are multiple occurrences (single occurrence is handled by SimpleReplacer)
  const firstIdx = content.indexOf(search);
  if (content.indexOf(search, firstIdx + 1) === -1) return;

  yield content.split(search).join(replace);
}

// ── Ordered replacer list ───────────────────────────────────────

const REPLACERS: { name: string; fn: Replacer }[] = [
  { name: 'exact', fn: SimpleReplacer },
  { name: 'line-trimmed', fn: LineTrimmedReplacer },
  { name: 'block-anchor', fn: BlockAnchorReplacer },
  { name: 'whitespace-normalized', fn: WhitespaceNormalizedReplacer },
  { name: 'indentation-flexible', fn: IndentationFlexibleReplacer },
  { name: 'escape-normalized', fn: EscapeNormalizedReplacer },
  { name: 'trimmed-boundary', fn: TrimmedBoundaryReplacer },
  { name: 'context-aware', fn: ContextAwareReplacer },
  { name: 'multi-occurrence', fn: MultiOccurrenceReplacer },
];

// ── Main entry point ────────────────────────────────────────────

export function replace(content: string, search: string, replaceStr: string): ReplaceResult | ReplaceFailure {
  for (const { name, fn } of REPLACERS) {
    const gen = fn(content, search, replaceStr);
    const result = gen.next();
    if (!result.done && result.value !== undefined) {
      return { ok: true, content: result.value, strategy: name };
    }
  }

  // Build a helpful failure message
  const searchPreview = search.split('\n').slice(0, 5).join('\n');
  return {
    ok: false,
    message: [
      'Search block not found after trying all 9 matching strategies.',
      'Searched for:',
      searchPreview,
      '',
      'Ensure the search block exactly matches existing file content.',
      'Re-read the file and try again with the correct content.',
    ].join('\n'),
  };
}
