/**
 * Line-level diff engine (LCS-based).
 * Used by DiffPanel for rendering unified diffs.
 */

export type DiffChangeType = 'equal' | 'insert' | 'delete' | 'replace';

export interface DiffRegion {
  type: DiffChangeType;
  oldLines: string[];
  newLines: string[];
  oldStart: number;
  newStart: number;
}

/**
 * LCS with common prefix/suffix optimization.
 * Returns indices of matching lines: [indicesInA[], indicesInB[]]
 */
function lcs(a: string[], b: string[]): [number[], number[]] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const aa = a.slice(prefix, a.length - suffix);
  const bb = b.slice(prefix, b.length - suffix);

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
