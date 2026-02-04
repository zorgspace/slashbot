/**
 * Heartbeat Service - Periodic AI Reflection System
 *
 * Exports for the heartbeat module.
 */

export { HeartbeatService, createHeartbeatService } from './HeartbeatService';
export type { HeartbeatLLMHandler } from './HeartbeatService';

export {
  type HeartbeatConfig,
  type FullHeartbeatConfig,
  type HeartbeatResult,
  type HeartbeatState,
  type HeartbeatTarget,
  type HeartbeatAction,
  type HeartbeatVisibility,
  type ActiveHours,
  DEFAULT_HEARTBEAT_PROMPT,
  parseDuration,
  formatDuration,
  isWithinActiveHours,
  parseHeartbeatResponse,
} from './types';
