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

export const MessageLine = React.memo(function MessageLine({ line, cols, paddingLeft = 0 }: { line: ChatLine; cols: number; paddingLeft?: number }) {
  const badge = badgeFor(line);
  const label = line.label ?? badge.label;
  const fg = textColor(line);
  const bold = false;
  const dim = line.role === 'assistant';
  const diffMode = isDiffMessage(line.text);
  const parts = line.text.split('\n');
  const first = parts[0] ?? '';
  const rest = parts.slice(1);

  // Badge width: space + label + space, for continuation line indentation
  const badgeWidth = label.length + 2;

  return (
    <Box width={cols} flexDirection="column" marginBottom={1} paddingLeft={paddingLeft}>
      <Box width={cols}>
        <Text color={badge.color} backgroundColor={badge.bg} bold>{` ${label} `}</Text>
        <MarkdownText
          text={first.length > 0 ? ` ${first}` : ' '}
          color={diffMode ? diffLineColor(first, fg) : fg}
          bold={bold}
          markdown={!diffMode}
          dim={dim}
          wrap="wrap"
        />
      </Box>
      {rest.map((part, idx) => (
        <Box key={`${line.id}-cont-${idx}`} width={cols}>
          <Text>{' '.repeat(badgeWidth)}</Text>
          <MarkdownText
            text={part.length > 0 ? ` ${part}` : ' '}
            color={diffMode ? diffLineColor(part, fg) : fg}
            bold={bold}
            markdown={!diffMode}
            wrap="wrap"
          />
        </Box>
      ))}
    </Box>
  );
});
