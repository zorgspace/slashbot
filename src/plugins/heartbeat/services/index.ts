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
  type HeartbeatRunStatus,
  type HeartbeatSkipReason,
  type HeartbeatVisibility,
  type ActiveHours,
  type StripHeartbeatMode,
  HEARTBEAT_TOKEN,
  DEFAULT_HEARTBEAT_PROMPT,
  DEFAULT_HEARTBEAT_EVERY,
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  DEFAULT_HEARTBEAT_DEDUPE_WINDOW_MS,
  parseDuration,
  parseDurationOrNull,
  formatDuration,
  isWithinActiveHours,
  stripHeartbeatToken,
  isHeartbeatContentEffectivelyEmpty,
  parseHeartbeatResponse,
} from './types';
