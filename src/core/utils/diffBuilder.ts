/**
 * Utility for building unified diffs from edit events
 */

import { diffLines, type DiffRegion } from '../../plugins/code-editor/services/diff';
import { basename } from 'path';

export interface EditAppliedEvent {
  filePath: string;
  beforeContent: string;
  afterContent: string;
}

export function buildUnifiedDiff(event: EditAppliedEvent): string | null {
  const beforeLines = event.beforeContent.split('\n');
  const afterLines = event.afterContent.split('\n');
  const regions = diffLines(beforeLines, afterLines);

  // Check if there are actual changes
  const hasChanges = regions.some(r => r.type !== 'equal');
  if (!hasChanges) return null;

  // Build unified diff hunks
  const rawLines: {
    text: string;
    type: 'ctx' | 'add' | 'del';
    oldLineNo: number;
    newLineNo: number;
  }[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const region of regions) {
    if (region.type === 'equal') {
      for (const line of region.oldLines) {
        rawLines.push({ text: ' ' + line, type: 'ctx', oldLineNo: oldLine, newLineNo: newLine });
        oldLine++;
        newLine++;
      }
    } else if (region.type === 'delete') {
      for (const line of region.oldLines) {
        rawLines.push({ text: '-' + line, type: 'del', oldLineNo: oldLine, newLineNo: newLine });
        oldLine++;
      }
    } else if (region.type === 'insert') {
      for (const line of region.newLines) {
        rawLines.push({ text: '+' + line, type: 'add', oldLineNo: oldLine, newLineNo: newLine });
        newLine++;
      }
    } else if (region.type === 'replace') {
      for (const line of region.oldLines) {
        rawLines.push({ text: '-' + line, type: 'del', oldLineNo: oldLine, newLineNo: newLine });
        oldLine++;
      }
      for (const line of region.newLines) {
        rawLines.push({ text: '+' + line, type: 'add', oldLineNo: oldLine, newLineNo: newLine });
        newLine++;
      }
    }
  }

  // Mark which lines to keep (within 3 context lines of a change)
  const contextRadius = 3;
  const keep = new Array(rawLines.length).fill(false);
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i].type === 'add' || rawLines[i].type === 'del') {
      for (
        let j = Math.max(0, i - contextRadius);
        j <= Math.min(rawLines.length - 1, i + contextRadius);
        j++
      ) {
        keep[j] = true;
      }
    }
  }

  // Group kept lines into hunks separated by gaps
  const hunkGroups: number[][] = [];
  let currentGroup: number[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (keep[i]) {
      if (currentGroup.length > 0 && i - currentGroup[currentGroup.length - 1] > 1) {
        hunkGroups.push(currentGroup);
        currentGroup = [];
      }
      currentGroup.push(i);
    }
  }
  if (currentGroup.length > 0) hunkGroups.push(currentGroup);

  // Build hunk output, respecting MAX_DIFF_LINES
  const MAX_DIFF_LINES = 300;
  const output: string[] = [];
  let totalLines = 0;

  for (const group of hunkGroups) {
    if (totalLines >= MAX_DIFF_LINES) {
      break;
    }

    // Compute hunk header from line numbers
    const firstIdx = group[0];

    const hunkOldStart = rawLines[firstIdx].oldLineNo;
    const hunkNewStart = rawLines[firstIdx].newLineNo;
    let hunkOldCount = 0;
    let hunkNewCount = 0;

    const hunkLines: string[] = [];
    for (const idx of group) {
      const rl = rawLines[idx];
      hunkLines.push(rl.text);
      if (rl.type === 'ctx') {
        hunkOldCount++;
        hunkNewCount++;
      } else if (rl.type === 'del') {
        hunkOldCount++;
      } else if (rl.type === 'add') {
        hunkNewCount++;
      }
    }

    output.push(`@@ -${hunkOldStart},${hunkOldCount} +${hunkNewStart},${hunkNewCount} @@`);
    output.push(...hunkLines);
    totalLines += hunkLines.length + 1;
  }

  if (output.length === 0) return null;

  const lines: string[] = [
    `--- a/${basename(event.filePath)}`,
    `+++ b/${basename(event.filePath)}`,
    ...output,
  ];
  return lines.join('\n');
}
