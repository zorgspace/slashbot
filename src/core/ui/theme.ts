import { RGBA } from '@opentui/core';
/**
 * OpenTUI Theme - Warm/cool balanced palette with visual depth
 */

export const theme = {
  transparent: new RGBA(new Float32Array([0, 0, 0, 0])),

  // Primary (warm amber - interactive elements, highlights)
  primary: '#fab283',

  // Secondary (cool blue - links, secondary info)
  secondary: '#5c9cf5',

  // Accent (violet - keeps slashbot identity, headings)
  accent: '#9d7cd8',
  accentMuted: '#7a5fb8',

  // Legacy aliases for backward compatibility
  violet: '#9d7cd8',
  violetLight: '#b4a0e0',
  violetDark: '#6a4fa0',

  // Semantic colors (softer tones)
  success: '#7fd88f',
  error: '#e06c75',
  warning: '#f5a742',
  info: '#56b6c2',

  // Neutral colors
  white: '#d4d4d4',
  muted: '#6e6e6e',

  // Backgrounds (3-level depth hierarchy)
  bg: '#0a0a0a',
  bgPanel: '#141414',
  bgElement: '#1e1e1e',

  // Borders (3-level)
  borderSubtle: '#3c3c3c',
  border: '#484848',
  borderActive: '#606060',

  // Status indicators
  green: '#7fd88f',
  red: '#e06c75',
  grey: '#6e6e6e',

  // Diff colors
  diffAddedFg: '#4fd6be',
  diffAddedBg: '#20303b',
  diffRemovedFg: '#c53b53',
  diffRemovedBg: '#37222c',
};
