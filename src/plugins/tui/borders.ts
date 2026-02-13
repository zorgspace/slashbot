/**
 * Shared border definitions for TUI panels
 *
 * SplitBorder: left/right dotted rails only (•), no top/bottom.
 * Used by header, input, footer for a clean side-rail look.
 */

import type { BorderCharacters, BorderSides } from '@opentui/core';

const EmptyBorderChars: BorderCharacters = {
  topLeft: ' ',
  topRight: ' ',
  bottomLeft: ' ',
  bottomRight: ' ',
  horizontal: ' ',
  vertical: ' ',
  topT: ' ',
  bottomT: ' ',
  leftT: ' ',
  rightT: ' ',
  cross: ' ',
};

export const SplitBorder = {
  border: ['left', 'right'] as BorderSides[],
  customBorderChars: { ...EmptyBorderChars, vertical: '•' },
};

export const LeftBorder = {
  border: ['left'] as BorderSides[],
  customBorderChars: { ...EmptyBorderChars, vertical: '•' },
};

export const TopBorder = {
  border: ['top'] as BorderSides[],
  customBorderChars: { ...EmptyBorderChars, horizontal: '─' },
};
