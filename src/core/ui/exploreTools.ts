/**
 * Explore tool classification helpers.
 *
 * We treat codebase discovery/read tools as "explore" tools so UI can
 * aggregate and animate their updates consistently.
 */

function tokenizeToolName(raw: string): string[] {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function isExploreToolName(raw: string): boolean {
  const tokens = tokenizeToolName(raw);
  if (tokens.length === 0) {
    return false;
  }

  const first = tokens[0];
  const compact = tokens.join('');

  if (
    first === 'read' ||
    first === 'ls' ||
    first === 'glob' ||
    first === 'grep' ||
    first === 'explore' ||
    first === 'cat' ||
    first === 'tree'
  ) {
    return true;
  }

  if (first === 'list') {
    return (
      tokens.length === 1 ||
      tokens.includes('file') ||
      tokens.includes('files') ||
      tokens.includes('dir') ||
      tokens.includes('dirs') ||
      tokens.includes('directory') ||
      tokens.includes('directories')
    );
  }

  if (first === 'find' || first === 'search' || first === 'scan') {
    return (
      tokens.length === 1 ||
      tokens.includes('file') ||
      tokens.includes('files') ||
      tokens.includes('code') ||
      tokens.includes('path') ||
      tokens.includes('paths')
    );
  }

  return (
    compact === 'readfile' ||
    compact === 'readfiles' ||
    compact === 'ls' ||
    compact === 'glob' ||
    compact === 'grep' ||
    compact === 'listfiles' ||
    compact === 'listdir' ||
    compact === 'listdirs' ||
    compact === 'listdirectory' ||
    compact === 'listdirectories' ||
    compact === 'findfiles' ||
    compact === 'searchfiles' ||
    compact === 'searchcode'
  );
}
