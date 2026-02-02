/**
 * ANSI Color System - Core colors and helpers
 * Theme: Violet dominant (#8A2BE2)
 */

// ANSI escape codes
const ESC = '\x1b[';
const RESET = `${ESC}0m`;

// Violet theme colors (using 256-color mode for better violet support)
export const colors = {
  // Primary violet shades
  violet: `${ESC}38;5;135m`, // Main violet
  violetLight: `${ESC}38;5;177m`, // Light violet (for thinking)
  violetDark: `${ESC}38;5;93m`, // Dark violet

  // Semantic colors
  success: `${ESC}38;5;34m`, // Green
  green: `${ESC}38;5;34m`, // Green
  error: `${ESC}38;5;124m`, // Darker red
  red: `${ESC}38;5;124m`, // Darker red
  warning: `${ESC}38;5;214m`, // Orange
  info: `${ESC}38;5;39m`, // Cyan
  muted: `${ESC}38;5;244m`, // Gray
  white: `${ESC}38;5;255m`, // White

  // Background colors
  bgViolet: `${ESC}48;5;135m`,
  bgVioletDark: `${ESC}48;5;53m`,
  bgGreen: `${ESC}48;5;22m`, // Dark green background for added lines
  bgRed: `${ESC}48;5;52m`, // Dark red background for removed lines
  bgGreenLight: `${ESC}48;5;28m`, // Lighter green for highlights
  bgRedLight: `${ESC}48;5;88m`, // Lighter red for highlights

  // Styles
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  italic: `${ESC}3m`,
  underline: `${ESC}4m`,

  // Reset
  reset: RESET,
};

// Color helper functions
export const c = {
  violet: (text: string) => `${colors.violet}${text}${RESET}`,
  violetLight: (text: string) => `${colors.violetLight}${text}${RESET}`,
  violetDark: (text: string) => `${colors.violetDark}${text}${RESET}`,
  success: (text: string) => `${colors.success}${text}${RESET}`,
  green: (text: string) => `${colors.green}${text}${RESET}`,
  error: (text: string) => `${colors.error}${text}${RESET}`,
  warning: (text: string) => `${colors.warning}${text}${RESET}`,
  info: (text: string) => `${colors.info}${text}${RESET}`,
  muted: (text: string) => `${colors.muted}${text}${RESET}`,
  white: (text: string) => `${colors.white}${text}${RESET}`,
  bold: (text: string) => `${colors.bold}${text}${RESET}`,
  dim: (text: string) => `${colors.dim}${text}${RESET}`,
  italic: (text: string) => `${colors.italic}${text}${RESET}`,
};
