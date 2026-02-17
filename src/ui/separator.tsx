/**
 * @module ui/separator
 *
 * Horizontal rule component for the Slashbot TUI.
 * Renders a full-width dashed line to visually divide sections.
 *
 * @see {@link Separator} -- Main component
 */
import React from 'react';
import { Box, Text } from 'ink';
import { palette } from './palette.js';

/**
 * Renders a horizontal separator line spanning the given column width.
 *
 * @param props.cols - The width in terminal columns.
 */
export function Separator({ cols }: { cols: number }) {
  return (
    <Box height={1} width={cols}>
      <Text color={palette.dim}>{'─'.repeat(cols)}</Text>
    </Box>
  );
}
