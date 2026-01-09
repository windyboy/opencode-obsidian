/**
 * Context management configuration constants
 */
export const CONTEXT_CONFIG = {
  /** Threshold for considering context full (95%) */
  FULL_THRESHOLD: 0.95,
  /** Threshold for preemptive compaction (85%) */
  PREEMPTIVE_THRESHOLD: 0.85,
  /** Maximum context tokens allowed */
  MAX_TOKENS: 50000,
  /** Default maximum tokens per request */
  DEFAULT_MAX_TOKENS_PER_REQUEST: 4096,
} as const

/**
 * Session management configuration constants
 */
export const SESSION_CONFIG = {
  /** Auto-save interval in milliseconds (30 seconds) */
  AUTO_SAVE_INTERVAL: 30000,
  /** Minimum time since last save before forcing save (5 seconds) */
  MIN_SAVE_INTERVAL: 5000,
  /** Maximum number of sessions to store in memory (LRU cache limit) */
  MAX_SESSIONS: 50,
  /** Default TTL for sessions (7 days in milliseconds) */
  DEFAULT_TTL: 7 * 24 * 60 * 60 * 1000,
  /** Session cleanup interval in milliseconds (5 minutes) */
  CLEANUP_INTERVAL: 5 * 60 * 1000,
  /** Session idle timeout in milliseconds (30 minutes) */
  IDLE_TIMEOUT: 30 * 60 * 1000,
} as const

/**
 * Tool output truncator configuration constants
 */
export const TOOL_OUTPUT_CONFIG = {
  /** Default maximum lines to keep in tool output */
  DEFAULT_MAX_LINES: 500,
  /** Priority for tool output truncator hook */
  HOOK_PRIORITY: 50,
} as const

/**
 * UI configuration constants
 */
export const UI_CONFIG = {
  /** Debounce delay for UI updates (milliseconds) */
  DEBOUNCE_DELAY: 500,
  /** Threshold for using pagination in model selector */
  PAGINATION_THRESHOLD: 50,
  /** Maximum length for user notifications (characters) */
  MAX_NOTIFICATION_LENGTH: 200,
  /** Throttle delay for model list fetching (milliseconds) */
  MODEL_FETCH_THROTTLE_DELAY: 2000,
  /** Cache duration for model lists (milliseconds) */
  MODEL_FETCH_CACHE_DURATION: 30000,
} as const

/**
 * Provider configuration constants
 */
export const PROVIDER_CONFIG = {
  /** Default ZenMux base URL */
  ZENMUX_DEFAULT_BASE_URL: 'https://zenmux.ai/api/v1',
} as const
