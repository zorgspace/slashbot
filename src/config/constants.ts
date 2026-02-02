/**
 * Centralized Configuration Constants
 * All hardcoded values should be defined here for maintainability
 */

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
  /** Maximum tokens for response generation */
  MAX_TOKENS: 16384,
  /** Temperature for response randomness (0-1) */
  TEMPERATURE: 0.7,
  /** Maximum messages to keep in context before compression */
  MAX_CONTEXT_MESSAGES: 200,
  /** Maximum characters per action result (with 256k context) */
  MAX_RESULT_CHARS: 50000,
  /** API request timeout in milliseconds */
  TIMEOUT_MS: 120000,
  /** Threshold for duplicate read detection */
  MAX_DUPLICATE_READS: 3,
} as const;

// ============================================================================
// SECURITY PATTERNS
// ============================================================================

/** Dangerous patterns to block - NEVER allow these commands */
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
  // Git destructive operations
  /git\s+push\s+.*--force/,
  /git\s+push\s+-f/,
  /git\s+reset\s+--hard/,
  /git\s+clean\s+-fd/,
];

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
