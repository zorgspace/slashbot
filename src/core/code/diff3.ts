/**
 * Diff3 Merge Engine
 *
 * Three-way merge for file editing: given a base (snapshot at read time),
 * "ours" (current file on disk), and "theirs" (LLM output), produce a
 * merged result that incorporates both sets of changes.
 *
 * Pure functions, no side effects.
 */

// ── Types ──────────────────────────────────────────────────────────────

export type DiffChangeType = 'equal' | 'insert' | 'delete' | 'replace';

export interface DiffRegion {
  type: DiffChangeType;
  /** Lines from the "old" side (base/a). Empty for inserts. */
  oldLines: string[];
  /** Lines from the "new" side (b). Empty for deletes. */
  newLines: string[];
  /** Start index in old array */
  oldStart: number;
  /** Start index in new array */
  newStart: number;
}

export type MergeRegionType = 'ok' | 'conflict';

export interface MergeRegion {
  type: MergeRegionType;
  /** Merged lines (for 'ok') or ours lines (for 'conflict') */
  lines: string[];
  /** Theirs lines (only for 'conflict') */
  theirsLines?: string[];
}

export interface MergeResult {
  /** True if merge completed without conflicts */
  success: boolean;
  /** Merged file lines */
  merged: string[];
  /** Number of conflict regions */
  conflictCount: number;
  /** Conflict regions for reporting */
  conflicts: { oursLines: string[]; theirsLines: string[] }[];
}

// ── LCS ────────────────────────────────────────────────────────────────

/**
 * Longest Common Subsequence with common prefix/suffix optimization.
 * Returns indices of matching lines: [indicesInA[], indicesInB[]]
 */
function lcs(a: string[], b: string[]): [number[], number[]] {
  // Trim common prefix
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix++;
  }

  // Trim common suffix
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  // Work on the middle section
  const aa = a.slice(prefix, a.length - suffix);
  const bb = b.slice(prefix, b.length - suffix);

  // Classic DP LCS on the trimmed middle
  const m = aa.length;
  const n = bb.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aa[i - 1] === bb[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find the subsequence indices
  const midA: number[] = [];
  const midB: number[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (aa[i - 1] === bb[j - 1]) {
      midA.unshift(i - 1 + prefix);
      midB.unshift(j - 1 + prefix);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  // Combine: prefix indices + middle LCS indices + suffix indices
  const indicesA: number[] = [];
  const indicesB: number[] = [];

  for (let k = 0; k < prefix; k++) {
    indicesA.push(k);
    indicesB.push(k);
  }

  indicesA.push(...midA);
  indicesB.push(...midB);

  for (let k = 0; k < suffix; k++) {
    indicesA.push(a.length - suffix + k);
    indicesB.push(b.length - suffix + k);
  }

  return [indicesA, indicesB];
}

// ── Line diff ──────────────────────────────────────────────────────────

/**
 * Compute line-level diff regions between two arrays of lines.
 */
export function diffLines(a: string[], b: string[]): DiffRegion[] {
  const [lcsA, lcsB] = lcs(a, b);
  const regions: DiffRegion[] = [];

  let ai = 0;
  let bi = 0;

  for (let k = 0; k < lcsA.length; k++) {
    const matchA = lcsA[k];
    const matchB = lcsB[k];

    // Lines before this match point
    if (ai < matchA || bi < matchB) {
      const oldLines = a.slice(ai, matchA);
      const newLines = b.slice(bi, matchB);
      if (oldLines.length > 0 && newLines.length > 0) {
        regions.push({ type: 'replace', oldLines, newLines, oldStart: ai, newStart: bi });
      } else if (oldLines.length > 0) {
        regions.push({ type: 'delete', oldLines, newLines: [], oldStart: ai, newStart: bi });
      } else if (newLines.length > 0) {
        regions.push({ type: 'insert', oldLines: [], newLines, oldStart: ai, newStart: bi });
      }
    }

    // The matching line itself
    regions.push({
      type: 'equal',
      oldLines: [a[matchA]],
      newLines: [b[matchB]],
      oldStart: matchA,
      newStart: matchB,
    });

    ai = matchA + 1;
    bi = matchB + 1;
  }

  // Trailing lines after last match
  if (ai < a.length || bi < b.length) {
    const oldLines = a.slice(ai);
    const newLines = b.slice(bi);
    if (oldLines.length > 0 && newLines.length > 0) {
      regions.push({ type: 'replace', oldLines, newLines, oldStart: ai, newStart: bi });
    } else if (oldLines.length > 0) {
      regions.push({ type: 'delete', oldLines, newLines: [], oldStart: ai, newStart: bi });
    } else if (newLines.length > 0) {
      regions.push({ type: 'insert', oldLines: [], newLines, oldStart: ai, newStart: bi });
    }
  }

  return regions;
}

// ── Three-way merge ────────────────────────────────────────────────────

/**
 * Three-way merge: combine changes from "ours" and "theirs" relative to "base".
 *
 * - base: the file content at `<read>` time (snapshot)
 * - ours: the current file on disk (may have changed since read)
 * - theirs: the LLM's intended content
 *
 * If base === ours (fast path), returns theirs directly.
 */
export function merge3(base: string[], ours: string[], theirs: string[]): MergeResult {
  // Fast path: no concurrent changes
  if (linesEqual(base, ours)) {
    return { success: true, merged: [...theirs], conflictCount: 0, conflicts: [] };
  }

  // Compute diffs: base→ours and base→theirs
  const diffOurs = diffLines(base, ours);
  const diffTheirs = diffLines(base, theirs);

  // Walk through base, applying changes from both sides
  const merged: string[] = [];
  const conflicts: { oursLines: string[]; theirsLines: string[] }[] = [];

  // Build change maps: baseIndex → change info
  // For each base line, track what ours and theirs do to it
  const oursChanges = buildChangeMap(diffOurs, base.length);
  const theirsChanges = buildChangeMap(diffTheirs, base.length);

  let bi = 0;

  while (bi <= base.length) {
    const oc = oursChanges.get(bi);
    const tc = theirsChanges.get(bi);

    if (!oc && !tc) {
      // No changes at this position from either side
      if (bi < base.length) {
        merged.push(base[bi]);
      }
      bi++;
      continue;
    }

    // Both sides have changes at this position
    if (oc && tc) {
      // Both made the same change → no conflict
      if (
        linesEqual(oc.newLines, tc.newLines) &&
        oc.baseCount === tc.baseCount
      ) {
        merged.push(...oc.newLines);
        bi += oc.baseCount;
        continue;
      }

      // One side is unchanged (kept base lines), other side changed → take the change
      if (oc.isIdentity) {
        merged.push(...tc.newLines);
        bi += tc.baseCount;
        continue;
      }
      if (tc.isIdentity) {
        merged.push(...oc.newLines);
        bi += oc.baseCount;
        continue;
      }

      // True conflict: both sides changed differently
      conflicts.push({ oursLines: oc.newLines, theirsLines: tc.newLines });
      // Take theirs (LLM intent) for conflicts, but flag it
      merged.push(...tc.newLines);
      bi += Math.max(oc.baseCount, tc.baseCount);
      continue;
    }

    // Only one side has a change
    if (oc) {
      merged.push(...oc.newLines);
      bi += oc.baseCount;
      continue;
    }

    if (tc) {
      merged.push(...tc.newLines);
      bi += tc.baseCount;
      continue;
    }

    bi++;
  }

  return {
    success: conflicts.length === 0,
    merged,
    conflictCount: conflicts.length,
    conflicts,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

interface ChangeEntry {
  /** New lines to emit */
  newLines: string[];
  /** Number of base lines consumed */
  baseCount: number;
  /** Whether this "change" is actually identity (base lines unchanged) */
  isIdentity: boolean;
}

/**
 * Build a map from base-line-index → change entry from a diff.
 * Groups consecutive equal regions and change regions so the merge
 * walker can consume them in chunks.
 */
function buildChangeMap(regions: DiffRegion[], _baseLength: number): Map<number, ChangeEntry> {
  const map = new Map<number, ChangeEntry>();

  for (const region of regions) {
    if (region.type === 'equal') continue;

    const baseIdx = region.oldStart;
    const baseCount = region.oldLines.length;

    // For inserts (baseCount=0), key on the insertion point
    const key = baseIdx;

    const existing = map.get(key);
    if (existing) {
      // Merge with existing entry at same position
      existing.newLines.push(...region.newLines);
      existing.baseCount += baseCount;
      existing.isIdentity = false;
    } else {
      map.set(key, {
        newLines: [...region.newLines],
        baseCount,
        isIdentity: false,
      });
    }
  }

  return map;
}

function linesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
