/**
 * Node-RED Lifecycle Management Types
 *
 * Type definitions for the Node-RED plugin, including:
 * - State machine (NodeRedState)
 * - Configuration (NodeRedConfig)
 * - Runtime state tracking (NodeRedRuntimeState)
 * - Status reporting (NodeRedStatus)
 *
 * @see /specs/001-nodered-lifecycle/data-model.md
 */

import type { RingBuffer } from './services/RingBuffer';

/**
 * Lifecycle state of the managed Node-RED instance.
 *
 * State Transitions:
 * - disabled -> stopped (if enabled=true and Node.js found)
 * - disabled -> unavailable (if enabled=true but no Node.js)
 * - unavailable -> stopped (when Node.js becomes available)
 * - stopped -> starting (on start command or auto-start)
 * - starting -> running (health probe succeeds)
 * - starting -> failed (spawn fails or max retries exhausted)
 * - running -> stopped (intentional stop)
 * - running -> starting (crash detected, auto-restart)
 * - running -> failed (crash with retries exhausted)
 * - failed -> starting (manual restart)
 */
export type NodeRedState =
  | 'disabled'      // Config enabled=false; no process management
  | 'unavailable'   // Enabled but Node.js not found (missing dependency)
  | 'stopped'       // Enabled and ready to start, but not running
  | 'starting'      // Process spawned, waiting for health probe success
  | 'running'       // Process healthy and responding
  | 'failed';       // All restart attempts exhausted or fatal error

/**
 * Persistent user configuration for Node-RED.
 * Stored at ~/.slashbot/nodered.json
 */
export interface NodeRedConfig {
  /** Whether Node-RED auto-starts with slashbot. Default: true */
  enabled: boolean;

  /** Port for Node-RED HTTP server (admin + editor + node endpoints). Default: 1880 */
  port: number;

  /** Path to Node-RED user directory. Default: ~/.slashbot/nodered */
  userDir: string;

  /** Health check interval in seconds. Default: 30 */
  healthCheckInterval: number;

  /** Graceful shutdown timeout in seconds. Default: 10 */
  shutdownTimeout: number;

  /** Maximum restart attempts after crash. Default: 3 */
  maxRestartAttempts: number;

  /** Whether to bind Node-RED to localhost only. Default: true */
  localhostOnly: boolean;
}

/**
 * In-memory runtime state tracked by NodeRedManager.
 * Not persisted to disk; reconstructed on startup.
 */
export interface NodeRedRuntimeState {
  /** Current lifecycle state */
  state: NodeRedState;

  /** PID of the Node-RED child process (null if not running) */
  pid: number | null;

  /** Bun Subprocess reference (null if not running) */
  process: ReturnType<typeof Bun.spawn> | null;

  /** Timestamp when Node-RED entered Running state */
  startedAt: Date | null;

  /** Number of restart attempts since last successful start */
  restartCount: number;

  /** Whether the current stop was intentional (suppresses auto-restart) */
  intentionalStop: boolean;

  /** In-memory ring buffer for recent log lines */
  logBuffer: RingBuffer | null;

  /** Handle for the health check interval timer */
  healthCheckTimer: ReturnType<typeof setTimeout> | null;

  /** Handle for the readiness poll timer (during starting state) */
  readinessPollTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Status snapshot for display in `/nodered status` command.
 * Captures current state and recent operational metrics.
 */
export interface NodeRedStatus {
  /** Current lifecycle state */
  state: NodeRedState;

  /** Process ID (null if not running) */
  pid: number | null;

  /** Port Node-RED is running on (null if not running) */
  port: number | null;

  /** Uptime in seconds (null if not running) */
  uptime: number | null;

  /** Number of restart attempts since last successful start */
  restartCount: number;

  /** Recent log lines (last N lines from ring buffer) */
  recentLogs: string[];
}
