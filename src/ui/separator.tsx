import React from 'react';
import { Box, Text } from 'ink';
import { palette } from './palette.js';

export function Separator({ cols }: { cols: number }) {
  return (
    <Box height={1} width={cols}>
      <Text color={palette.dim}>{'─'.repeat(cols)}</Text>
    </Box>
  );
}
