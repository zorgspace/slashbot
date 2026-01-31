/**
 * Application-wide constants
 * Centralized to avoid magic numbers and strings throughout the codebase
 */

import * as path from 'path';
import * as os from 'os';

// === Directory Paths ===
// Home directory: credentials, skills, connector locks (shared across all projects)
export const HOME_SLASHBOT_DIR = path.join(os.homedir(), '.slashbot');
export const HOME_CONFIG_FILE = path.join(HOME_SLASHBOT_DIR, 'config.json');
export const HOME_SKILLS_DIR = path.join(HOME_SLASHBOT_DIR, 'skills');
export const HOME_LOCKS_DIR = path.join(HOME_SLASHBOT_DIR, 'locks');

// Local directory: project-specific data (history, tasks)
export const getLocalSlashbotDir = (workDir?: string) => path.join(workDir || process.cwd(), '.slashbot');
export const getLocalHistoryFile = (workDir?: string) => path.join(getLocalSlashbotDir(workDir), 'history');
export const getLocalTasksFile = (workDir?: string) => path.join(getLocalSlashbotDir(workDir), 'tasks.json');
export const getLocalPermissionsFile = (workDir?: string) => path.join(getLocalSlashbotDir(workDir), 'permissions.json');

// === Model Configuration ===
export const MODELS = {
  DEFAULT: 'grok-code-fast-1',
  IMAGE: 'grok-4-1-fast-non-reasoning',
  SEARCH: 'grok-4-1-fast-non-reasoning',
  SUMMARY: 'grok-3-mini-fast',
} as const;

// === API Configuration ===
export const API = {
  BASE_URL: 'https://api.x.ai/v1',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.7,
  STREAM_TIMEOUT: 60000,
  REQUEST_TIMEOUT: 120000,
} as const;

// === Agentic Loop Limits ===
export const AGENTIC = {
  MAX_ITERATIONS_CLI: 25,
  MAX_ITERATIONS_CONNECTOR: 15,
  MAX_CONSECUTIVE_ERRORS: 3,
} as const;

// === Context Management ===
export const CONTEXT = {
  MAX_IMAGES: 3,
  MAX_MESSAGES: 200,
  MAX_HISTORY: 500,
  COMPRESS_THRESHOLD: 0.8,
  MAX_TOKENS: 256000,
} as const;

// === File Operations Limits ===
export const FILE_LIMITS = {
  GLOB_MAX_FILES: 100,
  GREP_MAX_LINES: 100,
  READ_MAX_LINES: 2000,
  EDIT_MAX_DELETION_RATIO: 0.8,
} as const;

// === Command Execution ===
export const EXEC = {
  DEFAULT_TIMEOUT: 30000,
  MAX_BUFFER: 10 * 1024 * 1024, // 10MB
} as const;

// === Scheduler Configuration ===
export const SCHEDULER = {
  TICK_INTERVAL: 1000,
  MAX_HISTORY: 100,
  EXECUTION_TIMEOUT: 300000, // 5 minutes
} as const;

// === Security: Dangerous Patterns ===
export const DANGEROUS_COMMANDS = [
  'git push --force',
  'git reset --hard',
  'git clean -fd',
  'chmod -R 777',
  'dd if=',
  '> /dev/',
  'mkfs.',
  ':(){:|:&};:',
] as const;

// === Security: Allowed Git Commands ===
export const ALLOWED_GIT_COMMANDS = [
  'status',
  'diff',
  'log',
  'branch',
  'add',
  'commit',
  'checkout',
  'stash',
] as const;

// === Action Tag Names ===
export const ACTION_TAGS = [
  'bash',
  'read',
  'edit',
  'multi-edit',
  'write',
  'create',
  'exec',
  'glob',
  'grep',
  'ls',
  'git',
  'fetch',
  'search',
  'format',
  'typecheck',
  'schedule',
  'notify',
  'skill',
  'skill-install',
] as const;

// === MIME Types ===
export const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
} as const;

// === Type exports ===
export type ActionTag = typeof ACTION_TAGS[number];
export type GitCommand = typeof ALLOWED_GIT_COMMANDS[number];
