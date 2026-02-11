/**
 * Core UI - Public exports (display facade, theme, types)
 *
 * TUIApp and panels have moved to src/plugins/tui/
 */

export { theme } from './theme';
export { display, setTUISpinnerCallbacks, banner } from './display';
export type { TUISpinnerCallbacks, BannerOptions } from './display';
export type { UIOutput, SidebarData, SidebarStatusItem, TUIAppCallbacks } from './types';
export { formatToolAction, formatToolName } from './format';
export type { ToolActionResult } from './format';

/* TUIApp moved to plugins/tui but directory missing - temporarily disable */
// export { TUIApp } from '../../plugins/tui/TUIApp';
// export type { HeaderOptions } from '../../plugins/tui/panels/HeaderPanel';
