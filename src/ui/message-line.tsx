import React from 'react';
import { Box, Text } from 'ink';
import { type ChatLine, palette, badgeFor } from './palette.js';
import { MarkdownText } from './markdown-text.js';

function textColor(line: ChatLine): string {
  if (line.logLevel === 'error') return palette.error;
  if (line.logLevel === 'warn') return palette.warn;
  switch (line.role) {
    case 'user': return palette.text;
    case 'assistant': return '#ffffff';
    default: return palette.muted;
  }
}

function isDiffMessage(text: string): boolean {
  return text.startsWith('diff --git ') || text.includes('\n@@ ');
}

function diffLineColor(part: string, fallback: string): string {
  if (part.startsWith('+++ ') || part.startsWith('--- ')) return palette.accent;
  if (part.startsWith('diff --git ') || part.startsWith('index ')) return palette.muted;
  if (part.startsWith('@@')) return palette.warn;
  if (part.startsWith('+')) return palette.success;
  if (part.startsWith('-')) return palette.error;
  return fallback;
}

/** Tag each line as code-block or normal so MarkdownText can be skipped inside fences. */
function tagCodeBlocks(parts: string[]): Array<{ text: string; codeBlock: boolean }> {
  const result: Array<{ text: string; codeBlock: boolean }> = [];
  let inCode = false;
  for (const part of parts) {
    if (/^```/.test(part.trim())) {
      inCode = !inCode;
      // hide the fence delimiter line
      continue;
    }
    result.push({ text: part, codeBlock: inCode });
  }
  return result;
}

export const MessageLine = React.memo(function MessageLine({ line, cols, paddingLeft = 0 }: { line: ChatLine; cols: number; paddingLeft?: number }) {
  const badge = badgeFor(line);
  const label = line.label ?? badge.label;
  const fg = textColor(line);
  const bold = false;
  const dim = line.role === 'assistant';
  const diffMode = isDiffMessage(line.text);
  const rawParts = line.text.split('\n');
  const tagged = diffMode ? rawParts.map((t) => ({ text: t, codeBlock: false })) : tagCodeBlocks(rawParts);
  const first = tagged[0] ?? { text: '', codeBlock: false };
  const rest = tagged.slice(1);

  // Badge width: space + label + space, for continuation line indentation
  const badgeWidth = label.length + 2;

  return (
    <Box width={cols} flexDirection="column" marginBottom={1} paddingLeft={paddingLeft}>
      <Box width={cols}>
        <Text color={badge.color} backgroundColor={badge.bg} bold>{` ${label} `}</Text>
        {first.codeBlock ? (
          <Text color={palette.warn} dimColor={dim} wrap="wrap">
            {first.text.length > 0 ? ` ${first.text}` : ' '}
          </Text>
        ) : (
          <MarkdownText
            text={first.text.length > 0 ? ` ${first.text}` : ' '}
            color={diffMode ? diffLineColor(first.text, fg) : fg}
            bold={bold}
            markdown={!diffMode}
            dim={dim}
            wrap="wrap"
          />
        )}
      </Box>
      {rest.map((part, idx) => (
        <Box key={`${line.id}-cont-${idx}`} width={cols}>
          <Text>{' '.repeat(badgeWidth)}</Text>
          {part.codeBlock ? (
            <Text color={palette.warn} dimColor={dim} wrap="wrap">
              {part.text.length > 0 ? ` ${part.text}` : ' '}
            </Text>
          ) : (
            <MarkdownText
              text={part.text.length > 0 ? ` ${part.text}` : ' '}
              color={diffMode ? diffLineColor(part.text, fg) : fg}
              bold={bold}
              markdown={!diffMode}
              wrap="wrap"
            />
          )}
        </Box>
      ))}
    </Box>
  );
});
