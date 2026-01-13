
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

