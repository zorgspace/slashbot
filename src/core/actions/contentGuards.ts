/**
 * Guards for malformed/generated content in edit/write payloads.
 */

/**
 * Remove quoted/commented segments so structural checks do not flag legitimate
 * escaped newlines inside string literals or comments.
 */
function stripLiteralsAndComments(input: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'single' | 'double' | 'template' | 'line_comment' | 'block_comment' = 'code';

  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];

    if (state === 'code') {
      if (ch === "'" && next !== undefined) {
        state = 'single';
        out += ' ';
        i++;
        continue;
      }
      if (ch === '"') {
        state = 'double';
        out += ' ';
        i++;
        continue;
      }
      if (ch === '`') {
        state = 'template';
        out += ' ';
        i++;
        continue;
      }
      if (ch === '/' && next === '/') {
        state = 'line_comment';
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block_comment';
        out += '  ';
        i += 2;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    if (state === 'single') {
      if (ch === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === "'") {
        state = 'code';
        out += ' ';
        i++;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    if (state === 'double') {
      if (ch === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '"') {
        state = 'code';
        out += ' ';
        i++;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    if (state === 'template') {
      if (ch === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '`') {
        state = 'code';
        out += ' ';
        i++;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    if (state === 'line_comment') {
      if (ch === '\n') {
        state = 'code';
        out += '\n';
      } else {
        out += ' ';
      }
      i++;
      continue;
    }

    // block_comment
    if (ch === '*' && next === '/') {
      state = 'code';
      out += '  ';
      i += 2;
      continue;
    }
    out += ch === '\n' ? '\n' : ' ';
    i++;
  }

  return out;
}

export function detectEscapedNewlineCorruption(content: string): string | null {
  if (!content.includes('\\n')) {
    return null;
  }

  const structural = stripLiteralsAndComments(content);
  const escapedNewlineWithIndent = (structural.match(/\\n[ \t]{2,}[^\s]/g) || []).length;
  const chainedEscapedNewlines = (structural.match(/(?:\\n[ \t]*){3,}/g) || []).length;
  const newlineBeforeSyntaxToken = (
    structural.match(
      /\\n[ \t]*(?:const|let|var|if|for|while|return|function|class|import|export)\b/g,
    ) || []
  ).length;

  if (escapedNewlineWithIndent >= 2) {
    return 'literal "\\n" used for structural line breaks/indentation';
  }

  if (chainedEscapedNewlines > 0) {
    return 'multiple chained literal "\\n" sequences detected';
  }

  if (newlineBeforeSyntaxToken >= 2) {
    return 'literal "\\n" used between code statements';
  }

  return null;
}

/**
 * Convert escaped newlines/tabs that appear in structural code positions
 * (outside string literals/comments) into real characters.
 *
 * This is a recovery helper for malformed tool payloads where the model emits
 * literal "\\n" for layout. Escapes inside strings/comments are preserved.
 */
export function repairStructuralEscapedNewlines(content: string): {
  content: string;
  changed: boolean;
} {
  let out = '';
  let i = 0;
  let changed = false;
  let state: 'code' | 'single' | 'double' | 'template' | 'line_comment' | 'block_comment' = 'code';

  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];

    if (state === 'code') {
      if (ch === "'" && next !== undefined) {
        state = 'single';
        out += ch;
        i++;
        continue;
      }
      if (ch === '"') {
        state = 'double';
        out += ch;
        i++;
        continue;
      }
      if (ch === '`') {
        state = 'template';
        out += ch;
        i++;
        continue;
      }
      if (ch === '/' && next === '/') {
        state = 'line_comment';
        out += '//';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block_comment';
        out += '/*';
        i += 2;
        continue;
      }

      if (ch === '\\' && next === 'r' && content[i + 2] === '\\' && content[i + 3] === 'n') {
        out += '\n';
        i += 4;
        changed = true;
        continue;
      }
      if (ch === '\\' && next === 'n') {
        out += '\n';
        i += 2;
        changed = true;
        continue;
      }
      if (ch === '\\' && next === 't') {
        out += '\t';
        i += 2;
        changed = true;
        continue;
      }

      out += ch;
      i++;
      continue;
    }

    if (state === 'single') {
      if (ch === '\\' && next !== undefined) {
        out += ch + next;
        i += 2;
        continue;
      }
      if (ch === "'") {
        state = 'code';
      }
      out += ch;
      i++;
      continue;
    }

    if (state === 'double') {
      if (ch === '\\' && next !== undefined) {
        out += ch + next;
        i += 2;
        continue;
      }
      if (ch === '"') {
        state = 'code';
      }
      out += ch;
      i++;
      continue;
    }

    if (state === 'template') {
      if (ch === '\\' && next !== undefined) {
        out += ch + next;
        i += 2;
        continue;
      }
      if (ch === '`') {
        state = 'code';
      }
      out += ch;
      i++;
      continue;
    }

    if (state === 'line_comment') {
      out += ch;
      if (ch === '\n') {
        state = 'code';
      }
      i++;
      continue;
    }

    // block_comment
    out += ch;
    if (ch === '*' && next === '/') {
      out += '/';
      i += 2;
      state = 'code';
      continue;
    }
    i++;
  }

  return { content: out, changed };
}
