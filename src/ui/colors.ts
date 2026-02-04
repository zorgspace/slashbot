/**
 * ANSI Color System for Slashbot
 * Re-exports all UI components from modular files
 */

// Core colors and helpers
export { colors, c } from './core';

// Box components
export {
  box,
  divider,
  thinBorder,
  drawBox,
  spinner,
  thinkingBlock,
  actionBlock,
  responseBlock,
  errorBlock,
  successBlock,
} from './components/box';

// Banner and logo
export { getLogo, banner } from './components/banner';
export type { BannerOptions } from './components/banner';

// Prompt components
export {
  prompt,
  inputPrompt,
  connectorStatus,
  connectorMessage,
  connectorResponse,
  connectorAction,
  inputClose,
  responseStart,
  hintLine,
} from './components/prompt';

// Thinking animation
export { ThinkingAnimation } from './animations/thinking';

// Step display
export { step, stepAction, stepMacro, statusLine, buildStatus } from './display/step';

// File viewer
export { FileViewer, fileViewer } from './display/file-viewer';
export type { DiffLine } from './display/file-viewer';

// Thinking display
export { thinkingDisplay } from './display/thinking';
