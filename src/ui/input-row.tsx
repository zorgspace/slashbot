import React, { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { palette } from './palette.js';

function decodeModifierEnterInput(raw: string): { shiftEnterCount: number; enterCount: number } {
  if (!raw) return { shiftEnterCount: 0, enterCount: 0 };
  const normalized = raw.replace(/\u001b/g, '');
  const shiftPattern = /\[27;2;13~|\[13;2u/g;
  const enterPattern = /\[27;1;13~|\[13;1u/g;

  const shiftEnterCount = (normalized.match(shiftPattern) ?? []).length;
  const enterCount = (normalized.match(enterPattern) ?? []).length;
  if (shiftEnterCount === 0 && enterCount === 0) {
    return { shiftEnterCount: 0, enterCount: 0 };
  }

  const stripped = normalized.replace(shiftPattern, '').replace(enterPattern, '').trim();
  if (stripped.length > 0) {
    return { shiftEnterCount: 0, enterCount: 0 };
  }

  return { shiftEnterCount, enterCount };
}

function cursorToLineCol(text: string, cursor: number): { line: number; col: number } {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  let line = 0;
  let col = 0;
  for (let i = 0; i < safeCursor; i += 1) {
    if (text[i] === '\n') {
      line += 1;
      col = 0;
    } else {
      col += 1;
    }
  }
  return { line, col };
}

function maskSensitivePrompt(input: string): string {
  const match = input.match(/^(\s*\/?solana\s+unlock\s+)([\s\S]*)$/i);
  if (!match) return input;
  const prefix = match[1] ?? '';
  const secret = match[2] ?? '';
  const maskedSecret = secret.replace(/[^\s]/g, '*');
  return `${prefix}${maskedSecret}`;
}

export function InputRow({
  busy,
  prompt,
  setPrompt,
  onSubmit,
  onPasteImage,
  onPasteText,
  cols,
  sidePadding = 1,
  onUpArrow,
  onDownArrow,
  onEscape,
  onTab,
}: {
  busy: boolean;
  prompt: string;
  setPrompt: (v: string) => void;
  onSubmit: (v: string) => void;
  onPasteImage: () => void;
  onPasteText: () => Promise<string | null>;
  cols: number;
  sidePadding?: number;
  onUpArrow: () => void;
  onDownArrow: () => void;
  onEscape: () => void;
  onTab: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const promptRef = useRef(prompt);
  const cursorRef = useRef(cursor);

  const commitCursor = (nextCursor: number) => {
    cursorRef.current = nextCursor;
    setCursor(nextCursor);
  };

  const commitPrompt = (nextPrompt: string, nextCursor: number) => {
    promptRef.current = nextPrompt;
    cursorRef.current = nextCursor;
    setPrompt(nextPrompt);
    setCursor(nextCursor);
  };

  useInput((input, key) => {
    const p = promptRef.current;
    const c = cursorRef.current;

    if (key.escape) {
      onEscape();
      commitCursor(0);
      return;
    }

    if (key.upArrow) {
      onUpArrow();
      return;
    }

    if (key.downArrow) {
      onDownArrow();
      return;
    }

    if (key.return) {
      if (key.shift) {
        const nextPrompt = p.slice(0, c) + '\n' + p.slice(c);
        commitPrompt(nextPrompt, c + 1);
        return;
      }
      onSubmit(p);
      commitCursor(0);
      return;
    }

    const decoded = decodeModifierEnterInput(input);
    if (decoded.shiftEnterCount > 0) {
      const newlines = '\n'.repeat(decoded.shiftEnterCount);
      const nextPrompt = p.slice(0, c) + newlines + p.slice(c);
      commitPrompt(nextPrompt, c + newlines.length);
      return;
    }
    if (decoded.enterCount > 0 || input === '\r' || input === '\n') {
      onSubmit(p);
      commitCursor(0);
      return;
    }

    if (key.backspace || key.delete) {
      if (c > 0) {
        const nextPrompt = p.slice(0, c - 1) + p.slice(c);
        commitPrompt(nextPrompt, c - 1);
      }
      return;
    }

    if (key.leftArrow) {
      if (key.ctrl || key.meta) {
        // Word jump left: skip whitespace, then skip word chars
        let i = c - 1;
        while (i > 0 && p[i - 1] === ' ') i--;
        while (i > 0 && p[i - 1] !== ' ') i--;
        commitCursor(Math.max(0, i));
      } else {
        commitCursor(Math.max(0, c - 1));
      }
      return;
    }

    if (key.rightArrow) {
      if (key.ctrl || key.meta) {
        // Word jump right: skip word chars, then skip whitespace
        let i = c;
        while (i < p.length && p[i] !== ' ') i++;
        while (i < p.length && p[i] === ' ') i++;
        commitCursor(Math.min(p.length, i));
      } else {
        commitCursor(Math.min(p.length, c + 1));
      }
      return;
    }

    if (key.tab) { onTab(); return; }

    if ((key.ctrl || key.meta) && (input === 'v' || input === 'V')) {
      if (key.shift) {
        void (async () => {
          try {
            const text = await onPasteText();
            if (text) {
              const latest = promptRef.current;
              const cur = cursorRef.current;
              commitPrompt(latest.slice(0, cur) + text + latest.slice(cur), cur + text.length);
            }
          } catch { /* handled by parent */ }
        })();
      } else {
        onPasteImage();
      }
      return;
    }

    // xterm-ghostty / some terminals send pasted text as a single input
    // chunk with ESC-prefixed control sequences. If it contains printable
    // text, treat it as a paste into the prompt instead of ignoring it.
    if (input && /[\u0020-\u007e\u00a0-\uffff]/.test(input) && input.includes('\u001b')) {
      const stripped = input.replace(/\u001b\[[0-9;]*[A-Za-z~]/g, '');
      if (stripped.trim().length > 0) {
        const nextPrompt = p.slice(0, c) + stripped + p.slice(c);
        commitPrompt(nextPrompt, c + stripped.length);
        return;
      }
    }

    // Ignore control/meta sequences
    if (key.ctrl || key.meta) return;
    if (input.includes('\u001b')) return;
    if (/[\u0000-\u001f\u007f]/.test(input)) return;

    // Regular text input
    if (input) {
      const nextPrompt = p.slice(0, c) + input + p.slice(c);
      commitPrompt(nextPrompt, c + input.length);
    }
  });

  // Sync refs and cursor when prompt changes externally (history navigation, parent reset)
  React.useEffect(() => {
    if (prompt === promptRef.current) return;
    promptRef.current = prompt;
    const nextCursor = prompt.length;
    cursorRef.current = nextCursor;
    setCursor(nextCursor);
  }, [prompt]);

  // Render the text with a cursor
  const displayedPrompt = maskSensitivePrompt(prompt).replace(/\r/g, '');
  const rawLines = displayedPrompt.length > 0 ? displayedPrompt.split('\n') : [''];
  const { line: cursorLine, col: cursorCol } = cursorToLineCol(displayedPrompt, cursor);
  const maxVisibleLines = 5;
  const startLine = Math.max(0, rawLines.length - maxVisibleLines);
  const visibleLines = rawLines.slice(startLine, startLine + maxVisibleLines);
  const localCursorLine = cursorLine - startLine;
  const hasLeadingHiddenLines = startLine > 0;
  const fill = (len: number) => ' '.repeat(Math.max(0, len));
  const innerWidth = cols - sidePadding * 2;
  const sideFill = fill(sidePadding);
  const textWidth = Math.max(0, innerWidth - 3);

  const contentRows = prompt.length === 0
    ? (
      <Box height={1} width={cols} flexDirection="row">
        <Text backgroundColor={palette.inputBg}>{sideFill}</Text>
        <Text backgroundColor={palette.inputBg} color={palette.inputFg}>{'❯ '}</Text>
        <Text backgroundColor={palette.inputFg} color={palette.inputBg}>{' '}</Text>
        <Text backgroundColor={palette.inputBg} color={palette.muted}> Type a prompt and press Enter</Text>
        <Text backgroundColor={palette.inputBg}>{fill(Math.max(0, textWidth - 30))}</Text>
      </Box>
    )
    : (
      <>
        {hasLeadingHiddenLines && (
          <Box height={1} width={cols}>
            <Text backgroundColor={palette.inputBg}>{sideFill}</Text>
            <Text backgroundColor={palette.inputBg} color={palette.muted}>{' ↥ more lines above'}</Text>
            <Text backgroundColor={palette.inputBg}>{fill(Math.max(0, cols - 19 - sidePadding))}</Text>
          </Box>
        )}
        {visibleLines.map((lineText, idx) => {
          const isCursorLine = idx === localCursorLine;
          const safeLine = lineText.slice(0, textWidth);
          const safeCursorCol = Math.max(0, Math.min(cursorCol, safeLine.length));
          const before = isCursorLine ? safeLine.slice(0, safeCursorCol) : safeLine;
          const cursorChar = isCursorLine ? (safeLine[safeCursorCol] ?? ' ') : '';
          const after = isCursorLine ? safeLine.slice(safeCursorCol + 1) : '';
          const prefix = idx === 0 ? '❯ ' : '  ';
          const consumed = isCursorLine
            ? before.length + 1 + after.length
            : safeLine.length;

          return (
            <Box key={`prompt-line-${startLine + idx}`} height={1} width={cols} flexDirection="row">
              <Text backgroundColor={palette.inputBg}>{sideFill}</Text>
              <Text backgroundColor={palette.inputBg} color={palette.inputFg}>{prefix}</Text>
              {isCursorLine ? (
                <>
                  <Text backgroundColor={palette.inputBg} color={palette.inputFg}>{before}</Text>
                  <Text backgroundColor={palette.inputFg} color={palette.inputBg}>{cursorChar}</Text>
                  <Text backgroundColor={palette.inputBg} color={palette.inputFg}>{after}</Text>
                </>
              ) : (
                <Text backgroundColor={palette.inputBg} color={palette.inputFg}>{safeLine}</Text>
              )}
              <Text backgroundColor={palette.inputBg}>{fill(Math.max(0, textWidth - consumed))}</Text>
            </Box>
          );
        })}
      </>
    );

  return (
    <Box width={cols} flexDirection="column">
      <Text backgroundColor={palette.inputBg}>{fill(cols)}</Text>
      {contentRows}
      <Text backgroundColor={palette.inputBg}>{fill(cols)}</Text>
    </Box>
  );
}
