
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

/**
 * Security and file validation constants
 */
export const SECURITY_CONFIG = {
  /** Maximum file size for config files (1MB) */
  MAX_CONFIG_FILE_SIZE: 1 * 1024 * 1024,
  /** Maximum file size for agent files (5MB) */
  MAX_AGENT_FILE_SIZE: 5 * 1024 * 1024,
  /** Maximum file size for skill files (5MB) */
  MAX_SKILL_FILE_SIZE: 5 * 1024 * 1024,
  /** Maximum file size for instruction files (10MB) */
  MAX_INSTRUCTION_FILE_SIZE: 10 * 1024 * 1024,
  /** Maximum length for file paths (4096 characters) */
  MAX_FILE_PATH_LENGTH: 4096,
  /** Maximum depth for nested JSON structures (10 levels) */
  MAX_JSON_DEPTH: 10,
  /** Maximum number of properties in a JSON object (10000) */
  MAX_JSON_PROPERTIES: 10000,
  /** Maximum length for a single JSON string value (1MB) */
  MAX_JSON_STRING_LENGTH: 1 * 1024 * 1024,
} as const
