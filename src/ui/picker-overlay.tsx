import React from 'react';
import { Box, Text } from 'ink';
import { palette } from './palette.js';

const MAX_VISIBLE = 8;

export interface PickerItem {
  id: string;
  label: string;
  description: string;
  active?: boolean;
}

interface PickerOverlayProps {
  title: string;
  items: PickerItem[];
  selectedIndex: number;
  cols: number;
}

export function PickerOverlay({ title, items, selectedIndex, cols }: PickerOverlayProps): React.ReactElement {
  const total = items.length;

  // Scrolling window (same logic as CommandPalette)
  let start: number;
  let end: number;
  let showAbove = false;
  let showBelow = false;

  if (total <= MAX_VISIBLE) {
    start = 0;
    end = total;
  } else if (selectedIndex <= MAX_VISIBLE - 2) {
    start = 0;
    end = MAX_VISIBLE - 1;
    showBelow = true;
  } else {
    const slotsWithoutBelow = MAX_VISIBLE - 1;
    const tentativeEnd = selectedIndex - slotsWithoutBelow + 1 + slotsWithoutBelow;

    if (tentativeEnd >= total) {
      start = total - slotsWithoutBelow;
      end = total;
      showAbove = true;
    } else {
      const middleSlots = MAX_VISIBLE - 2;
      start = selectedIndex - middleSlots + 1;
      end = start + middleSlots;
      showAbove = true;
      showBelow = true;
    }
  }

  const visible = items.slice(start, end);
  const aboveCount = start;
  const belowCount = total - end;

  // Compute column widths from all items (not just visible) for stable alignment
  const maxLabel = Math.max(...items.map(it => it.label.length), 5);
  const maxDesc = Math.max(...items.map(it => it.description.length), 5);

  return (
    <Box
      flexDirection="column"
      width={cols}
      borderStyle="round"
      borderColor={palette.dim}
    >
      {/* Title row */}
      <Text color={palette.accent} bold>{` ${title}`}</Text>

      {showAbove && (
        <Text color={palette.muted}>  +{aboveCount} above</Text>
      )}
      {visible.map((item, i) => {
        const isSelected = (start + i) === selectedIndex;
        const marker = item.active ? '\u25cf' : ' ';
        const label = item.label.padEnd(maxLabel);
        const desc = item.description.padEnd(maxDesc);
        const bg = isSelected ? palette.accent : undefined;
        const fg = isSelected ? '#1a1b26' : palette.text;
        const dimFg = isSelected ? '#1a1b26' : palette.muted;

        return (
          <Box key={item.id}>
            <Text backgroundColor={bg} color={item.active ? palette.success : dimFg}>
              {` ${marker} `}
            </Text>
            <Text backgroundColor={bg} color={fg}>
              {label}
            </Text>
            <Text backgroundColor={bg} color={dimFg}>
              {'  '}{desc}
            </Text>
          </Box>
        );
      })}
      {showBelow && (
        <Text color={palette.muted}>  +{belowCount} below</Text>
      )}
      {/* Footer hint */}
      <Text color={palette.muted}>{' Enter select \u00b7 Esc cancel'}</Text>
    </Box>
  );
}
