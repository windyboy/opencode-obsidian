/**
 * Retry helper utility for operations with exponential backoff
 */

import { isRetryableError, getErrorStatusCode } from "./error-messages";

/**
 * Retry configuration
 */
export interface RetryConfig {
	/** Maximum number of retry attempts */
	maxAttempts: number;
	/** Initial delay between retries in milliseconds */
	delayMs: number;
	/** Multiplier for exponential backoff */
	backoffMultiplier: number;
	/** Optional custom function to determine if an error is retryable */
	retryableErrors?: (error: Error, statusCode: number | null) => boolean;
	/** Optional operation name for logging */
	operationName?: string;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxAttempts: 3,
	delayMs: 1000,
	backoffMultiplier: 2,
};

/**
 * Helper class for retrying operations with exponential backoff
 */
export class RetryHelper {
	/**
	 * Execute an operation with automatic retry on failure
	 * @param operation The async operation to execute
	 * @param config Retry configuration (partial, merged with defaults)
	 * @returns The result of the operation
	 * @throws The last error if all retries fail
	 */
	static async withRetry<T>(
		operation: () => Promise<T>,
		config: Partial<RetryConfig> = {},
	): Promise<T> {
		const finalConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
		let lastError: Error | null = null;
		let delay = finalConfig.delayMs;

		for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				const statusCode = getErrorStatusCode(error);

				// Check if error is retryable
				const isRetryable = finalConfig.retryableErrors
					? finalConfig.retryableErrors(lastError, statusCode)
					: isRetryableError(lastError, statusCode);

				if (!isRetryable) {
					// Not retryable, throw immediately
					throw lastError;
				}

				// If this was the last attempt, throw
				if (attempt === finalConfig.maxAttempts) {
					throw lastError;
				}

				// Log retry attempt if operation name is provided
				if (finalConfig.operationName) {
					console.debug(
						`[RetryHelper] Retrying ${finalConfig.operationName} (attempt ${attempt}/${finalConfig.maxAttempts}) after ${delay}ms`,
					);
				}

				// Wait before retrying
				await RetryHelper.sleep(delay);

				// Increase delay for next attempt (exponential backoff)
				delay *= finalConfig.backoffMultiplier;
			}
		}

		// Should never reach here, but throw last error just in case
		throw lastError || new Error(
			`Failed to ${finalConfig.operationName || "execute operation"} after ${finalConfig.maxAttempts} attempts`,
		);
	}

	/**
	 * Sleep for specified milliseconds
	 */
	private static sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
