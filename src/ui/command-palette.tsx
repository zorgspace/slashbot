import React from 'react';
import { Box, Text } from 'ink';
import { palette } from './palette.js';

const MAX_VISIBLE = 8;

interface CommandPaletteProps {
  commands: Array<{ id: string; description: string }>;
  selectedIndex: number;
  cols: number;
  prefix?: string;
}

export function CommandPalette({ commands, selectedIndex, cols, prefix = '/' }: CommandPaletteProps): React.ReactElement {
  const total = commands.length;

  // Compute a scrolling window where hints eat into the MAX_VISIBLE budget,
  // so total inner rows (commands + hints) never exceed min(total, MAX_VISIBLE).
  let start: number;
  let end: number;
  let showAbove = false;
  let showBelow = false;

  if (total <= MAX_VISIBLE) {
    start = 0;
    end = total;
  } else if (selectedIndex <= MAX_VISIBLE - 2) {
    // Top region: no above hint, 1 below hint, MAX_VISIBLE-1 commands
    start = 0;
    end = MAX_VISIBLE - 1;
    showBelow = true;
  } else {
    // Past top: always need above hint
    const slotsWithoutBelow = MAX_VISIBLE - 1;
    const tentativeStart = selectedIndex - slotsWithoutBelow + 1;
    const tentativeEnd = tentativeStart + slotsWithoutBelow;

    if (tentativeEnd >= total) {
      // Bottom region: above hint only, MAX_VISIBLE-1 commands
      start = total - slotsWithoutBelow;
      end = total;
      showAbove = true;
    } else {
      // Middle: both hints, MAX_VISIBLE-2 commands
      const middleSlots = MAX_VISIBLE - 2;
      start = selectedIndex - middleSlots + 1;
      end = start + middleSlots;
      showAbove = true;
      showBelow = true;
    }
  }

  const visible = commands.slice(start, end);
  const aboveCount = start;
  const belowCount = total - end;

  return (
    <Box
      flexDirection="column"
      width={cols}
      borderStyle="round"
      borderColor={palette.dim}
    >
      {showAbove && (
        <Text color={palette.muted}>  +{aboveCount} above</Text>
      )}
      {visible.map((cmd, i) => {
        const isSelected = (start + i) === selectedIndex;
        const label = `${prefix}${cmd.id}`;
        const desc = cmd.description;
        const gap = Math.max(1, cols - label.length - desc.length - 6);

        return (
          <Box key={cmd.id}>
            <Text
              backgroundColor={isSelected ? palette.accent : undefined}
              color={isSelected ? '#1a1b26' : palette.accent}
            >
              {label}
            </Text>
            <Text
              backgroundColor={isSelected ? palette.accent : undefined}
              color={isSelected ? '#1a1b26' : palette.muted}
            >
              {' '.repeat(gap)}{desc}
            </Text>
          </Box>
        );
      })}
      {showBelow && (
        <Text color={palette.muted}>  +{belowCount} below</Text>
      )}
    </Box>
  );
}
