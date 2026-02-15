import type { InkPlugin } from '../core/contracts.js';
import { helpPlugin } from './help-plugin.js';

export function getPlugins(): InkPlugin[] {
  return [helpPlugin];
}
