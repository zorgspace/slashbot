/**
 * @module ui/markdown-text
 *
 * Lightweight inline Markdown renderer for the Slashbot TUI.
 * Parses and renders inline tokens (bold, italic, strikethrough,
 * code spans, and links) as styled Ink Text elements. Also handles
 * block-level markers: headings, quotes, and list items.
 *
 * @see {@link MarkdownText} -- Main component
 */
import React from 'react';
import { Text } from 'ink';
import { palette } from './palette.js';

const INLINE_TOKEN = /(`[^`\n]+`|\[[^\]\n]+\]\([^)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_)/g;

function normalizeBlockMarkdown(line: string): { text: string; heading: boolean; quote: boolean } {
  const heading = /^#{1,6}\s+/.test(line);
  if (heading) {
    return {
      text: line.replace(/^#{1,6}\s+/, ''),
      heading: true,
      quote: false,
    };
  }

  const quote = /^>\s+/.test(line);
  if (quote) {
    return {
      text: line.replace(/^>\s+/, ''),
      heading: false,
      quote: true,
    };
  }

  if (/^[-*+]\s+/.test(line)) {
    return {
      text: line.replace(/^[-*+]\s+/, '• '),
      heading: false,
      quote: false,
    };
  }

  return { text: line, heading: false, quote: false };
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_TOKEN.exec(text)) !== null) {
    const token = match[0];
    const index = match.index;

    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }

    if (token.startsWith('`')) {
      const content = token.slice(1, -1);
      nodes.push(
        <Text key={`md-${key}`} color={palette.warn} backgroundColor={palette.dim}>
          {content}
        </Text>,
      );
      key += 1;
      cursor = index + token.length;
      continue;
    }

    if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const label = linkMatch[1] ?? '';
        const href = linkMatch[2] ?? '';
        nodes.push(
          <Text key={`md-${key}`} color={palette.accent} underline>
            {label}
          </Text>,
        );
        key += 1;
        nodes.push(
          <Text key={`md-${key}`} color={palette.muted}>
            {` (${href})`}
          </Text>,
        );
        key += 1;
        cursor = index + token.length;
        continue;
      }
    }

    if (token.startsWith('**') || token.startsWith('__')) {
      const content = token.slice(2, -2);
      nodes.push(
        <Text key={`md-${key}`} bold>
          {content}
        </Text>,
      );
      key += 1;
      cursor = index + token.length;
      continue;
    }

    if (token.startsWith('~~')) {
      const content = token.slice(2, -2);
      nodes.push(
        <Text key={`md-${key}`} strikethrough>
          {content}
        </Text>,
      );
      key += 1;
      cursor = index + token.length;
      continue;
    }

    if (token.startsWith('*') || token.startsWith('_')) {
      const content = token.slice(1, -1);
      nodes.push(
        <Text key={`md-${key}`} italic>
          {content}
        </Text>,
      );
      key += 1;
      cursor = index + token.length;
      continue;
    }

    nodes.push(token);
    cursor = index + token.length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes.length > 0 ? nodes : [text];
}

interface MarkdownTextProps {
  text: string;
  color: string;
  bold?: boolean;
  wrap?: 'wrap' | 'truncate' | 'truncate-start' | 'truncate-middle' | 'truncate-end';
  dim?: boolean;
  markdown?: boolean;
}

/**
 * Renders text with lightweight Markdown formatting support.
 * Supports inline bold, italic, strikethrough, code, and links,
 * as well as block-level headings, quotes, and list items.
 *
 * @param props.text - The raw Markdown text to render.
 * @param props.color - Base text color.
 * @param props.bold - Whether to render all text as bold.
 * @param props.wrap - Ink wrap mode for text overflow.
 * @param props.markdown - When false, renders plain text without parsing.
 * @param props.dim - Whether to render text dimmed.
 */
export function MarkdownText({
  text,
  color,
  bold = false,
  wrap = 'wrap',
  markdown = true,
  dim = false,
}: MarkdownTextProps): React.ReactElement {
  if (!markdown || text.length === 0) {
    return (
      <Text color={color} bold={bold} dimColor={dim} wrap={wrap}>
        {text.length > 0 ? text : ' '}
      </Text>
    );
  }

  const block = normalizeBlockMarkdown(text);
  const lineColor = block.quote ? palette.muted : color;
  const lineBold = bold || block.heading;
  const nodes = renderInlineMarkdown(block.text);

  return (
    <Text color={lineColor} bold={lineBold} dimColor={dim} wrap={wrap}>
      {nodes}
    </Text>
  );
}
