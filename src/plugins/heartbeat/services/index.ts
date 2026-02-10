/**
 * Heartbeat service exports (plugin-local)
 */
export { HeartbeatService, createHeartbeatService } from './HeartbeatService';
export type { HeartbeatLLMHandler } from './HeartbeatService';

export {
  type HeartbeatConfig,
  type FullHeartbeatConfig,
  type HeartbeatResult,
  type HeartbeatState,
  type HeartbeatAction,
  type HeartbeatVisibility,
  type ActiveHours,
  DEFAULT_HEARTBEAT_PROMPT,
  parseDuration,
  formatDuration,
  isWithinActiveHours,
  parseHeartbeatResponse,
} from './types';
