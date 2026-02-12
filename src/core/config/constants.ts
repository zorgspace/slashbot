/**
 * Centralized Configuration Constants
 * All hardcoded values should be defined here for maintainability
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// DIRECTORY PATHS
// ============================================================================

// Home directory: shared credentials + global defaults
export const HOME_SLASHBOT_DIR = path.join(os.homedir(), '.slashbot');
export const HOME_CREDENTIALS_FILE = path.join(HOME_SLASHBOT_DIR, 'credentials.json');
export const HOME_CONFIG_DIR = path.join(HOME_SLASHBOT_DIR, 'config');
export const HOME_CONFIG_FILE = path.join(HOME_CONFIG_DIR, 'config.json');

// Local directory: project-specific data (history, tasks)
export const getLocalSlashbotDir = (workDir?: string) =>
  path.join(workDir || process.cwd(), '.slashbot');
export const getLocalConfigDir = (workDir?: string) =>
  path.join(getLocalSlashbotDir(workDir), 'config');
export const getLocalConfigFile = (workDir?: string) =>
  path.join(getLocalConfigDir(workDir), 'config.json');
export const getLocalPromptsDir = (workDir?: string) =>
  path.join(getLocalSlashbotDir(workDir), 'prompts');
export const getLocalSkillsDir = (workDir?: string) =>
  path.join(getLocalSlashbotDir(workDir), 'skills');
export const getLocalLocksDir = (workDir?: string) =>
  path.join(getLocalSlashbotDir(workDir), 'locks');
export const getLocalHistoryFile = (workDir?: string) =>
  path.join(getLocalSlashbotDir(workDir), 'history');
export const getLocalTasksFile = (workDir?: string) =>
  path.join(getLocalSlashbotDir(workDir), 'tasks.json');
export const getLocalPermissionsFile = (workDir?: string) =>
  path.join(getLocalSlashbotDir(workDir), 'permissions.json');

// ============================================================================
// GROK API CONFIGURATION
// ============================================================================

export const GROK_CONFIG = {
  /** Default model for text-only conversations */
  MODEL: 'grok-code-fast-1',
  /** Model for conversations with images (vision-capable) */
  MODEL_VISION: 'grok-4-1-fast-non-reasoning',
  /** X.AI API base URL */
  API_BASE_URL: 'https://api.x.ai/v1',
  /** Maximum tokens for response generation (high value for unlimited feel) */
  MAX_TOKENS: 256000,
  /** Temperature for response randomness (0-1) */
  TEMPERATURE: 0.4,
  /** API request timeout in milliseconds */
  TIMEOUT_MS: 120000,
  /** Threshold for duplicate read detection */
  MAX_DUPLICATE_READS: 3,
} as const;

// ============================================================================
// MODEL CONFIGURATION
// ============================================================================

export const MODELS = {
  DEFAULT: 'grok-4-1-fast-reasoning',
  IMAGE: 'grok-4-1-fast-non-reasoning',
  SEARCH: 'grok-4-1-fast-non-reasoning',
} as const;

/** Default provider */
export const DEFAULT_PROVIDER = 'xai' as const;

/** Alias for backwards compatibility */
export const DEFAULT_PROVIDER_CONFIG = GROK_CONFIG;

// ============================================================================
// PROXY CONFIGURATION (slashbot-web)
// ============================================================================

const WALLET_CONFIG_PATH = path.join(getLocalSlashbotDir(), 'wallet-config.json');

interface WalletConfigFile {
  walletAddress: string;
  proxyUrl: string;
  configuredAt: string;
}

/** Load wallet config from file */
function loadWalletConfig(): WalletConfigFile | null {
  try {
    if (fs.existsSync(WALLET_CONFIG_PATH)) {
      const data = fs.readFileSync(WALLET_CONFIG_PATH, 'utf-8');
      return JSON.parse(data) as WalletConfigFile;
    }
  } catch {
    // Ignore errors
  }
  return null;
}

const walletConfig = loadWalletConfig();

export const PROXY_CONFIG = {
  /** Proxy server URL */
  BASE_URL: walletConfig?.proxyUrl || 'https://getslashbot.com',
  /** Grok proxy endpoint */
  GROK_ENDPOINT: '/api/grok',
  /** Credits endpoint */
  CREDITS_ENDPOINT: '/api/credits',
  /** Whether to use proxy mode (requires wallet) */
  ENABLED: !!walletConfig?.walletAddress,
  /** User's Solana wallet address for billing */
  WALLET_ADDRESS: walletConfig?.walletAddress || '',
  /** Treasury address for deposits */
  TREASURY_ADDRESS: 'DVGjCZVJ3jMw8gsHAQjuYFMj8xQJyVf17qKrciYCS9u7',
  /** SLASHBOT token mint */
  TOKEN_MINT: 'AtiFyHm6UMNLXCWJGLqhxSwvr3n3MgFKxppkKWUoBAGS',
  /** Path to wallet config file */
  CONFIG_PATH: WALLET_CONFIG_PATH,
} as const;

// ============================================================================
// AGENTIC LOOP LIMITS
// ============================================================================

export const AGENTIC = {
  MAX_ITERATIONS_CLI: 10000,
  MAX_ITERATIONS_CONNECTOR: 10000,
  MAX_CONSECUTIVE_ERRORS: 30,
} as const;

// ============================================================================
// CONTEXT MANAGEMENT
// ============================================================================

export const CONTEXT = {
  MAX_IMAGES: 3,
  MAX_MESSAGES: 150,
  MAX_HISTORY: 500,
  COMPRESS_THRESHOLD: 0.7,
  MAX_TOKENS: 256000,
} as const;

export const COMPACTION = {
  /** Compact when token usage exceeds this ratio of model limit */
  TOKEN_THRESHOLD_RATIO: 0.7,
  /** Soft warning threshold for context pressure */
  WARN_RATIO: 0.6,
  /** Start pruning older tool outputs above this ratio */
  PRUNE_RATIO: 0.7,
  /** Start summary compaction above this ratio */
  SUMMARY_RATIO: 0.8,
  /** Hard trim when context remains near saturation */
  HARD_RESET_RATIO: 0.9,
  /** Keep last N tool outputs intact during pruning */
  PRUNE_PROTECT_RECENT: 10,
  /** Keep last N messages during hard reset */
  HARD_RESET_KEEP_RECENT_MESSAGES: 8,
  /** Max tokens for the summary message */
  SUMMARY_MAX_TOKENS: 4000,
} as const;

// ============================================================================
// FILE OPERATIONS LIMITS
// ============================================================================

export const FILE_LIMITS = {
  GLOB_MAX_FILES: 100,
  GREP_MAX_LINES: 100,
  READ_MAX_LINES: 2000,
  EDIT_MAX_DELETION_RATIO: 0.8,
} as const;

// ============================================================================
// COMMAND EXECUTION
// ============================================================================

export const EXEC = {
  DEFAULT_TIMEOUT: 30000,
  MAX_BUFFER: 10 * 1024 * 1024, // 10MB
} as const;

// ============================================================================
// SCHEDULER CONFIGURATION
// ============================================================================

export const SCHEDULER = {
  TICK_INTERVAL: 1000,
  MAX_HISTORY: 100,
  EXECUTION_TIMEOUT: 300000, // 5 minutes
} as const;

// ============================================================================
// SECURITY PATTERNS
// ============================================================================

/** Simple string patterns for quick matching */
export const DANGEROUS_COMMANDS = [
  'chmod -R 777',
  'dd if=',
  '> /dev/',
  'mkfs.',
  ':(){:|:&};:',
] as const;

/** Regex patterns for thorough security checking */
export const DANGEROUS_PATTERNS: readonly RegExp[] = [
  // rm on root directory itself or wildcards on root
  /rm\s+(-[a-zA-Z]+\s+)*\/\s*$/,
  /rm\s+(-[a-zA-Z]+\s+)*\/\*/,
  // rm on system directories
  /rm\s+.*\/etc\b/,
  /rm\s+.*\/boot\b/,
  /rm\s+.*\/usr\b/,
  /rm\s+.*\/var\b/,
  /rm\s+.*\/bin\b/,
  /rm\s+.*\/sbin\b/,
  /rm\s+.*\/lib\b/,
  // System destruction
  />\s*\/dev\/sd[a-z]/,
  /dd\s+.*of=\/dev\/sd[a-z]/,
  /mkfs/,
  /:(){ :|:& };:/,
  /chmod\s+(-R\s+)?777\s+\//,
  /chown\s+.*\s+\//,
  />\s*\/etc\//,
  /shutdown/,
  /reboot/,
  /init\s+0/,
  /halt/,
  /poweroff/,
];

/** Allowed git commands (safe to auto-approve) */
export const ALLOWED_GIT_COMMANDS = [
  'status',
  'diff',
  'log',
  'branch',
  'add',
  'commit',
  'checkout',
  'stash',
  'worktree',
] as const;

// ============================================================================
// EDITOR / CODE SEARCH CONFIGURATION
// ============================================================================

/** Directories to always exclude from code searches */
export const EXCLUDED_DIRS: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'coverage',
  '.coverage',
  '.nyc_output',
  'vendor',
  'target',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.venv',
  'venv',
  'env',
  '.env',
  '.idea',
  '.vscode',
  '.DS_Store',
];

/** File patterns to exclude from code searches */
export const EXCLUDED_FILES: readonly string[] = [
  '*.lock',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.chunk.js',
  '*.bundle.js',
  '*.d.ts',
  '*.tsbuildinfo',
];

// ============================================================================
// UI CONFIGURATION
// ============================================================================

export const UI_CONFIG = {
  /** Timeout for double Ctrl+C to exit (ms) */
  DOUBLE_CTRLC_TIMEOUT: 500,
  /** Delay before saving history (ms) */
  HISTORY_SAVE_DELAY: 2000,
  /** Maximum items in image buffer */
  MAX_IMAGE_BUFFER: 10,
} as const;

// ============================================================================
// CONNECTOR CONFIGURATION
// ============================================================================

export const CONNECTOR_CONFIG = {
  /** Maximum message length for Telegram */
  TELEGRAM_MAX_LENGTH: 4096,
  /** Maximum message length for Discord */
  DISCORD_MAX_LENGTH: 2000,
  /** Typing indicator duration (ms) */
  TYPING_DURATION: 5000,
} as const;

// ============================================================================
// DEFAULT SKILLS
// ============================================================================

export const DEFAULT_SKILLS: Array<{ readonly name: string; readonly url: string }> = [] as const;

// ============================================================================
// MIME TYPES
// ============================================================================

export const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
} as const;

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type GitCommand = (typeof ALLOWED_GIT_COMMANDS)[number];
