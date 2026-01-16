/**
 * User-friendly error messages for common error scenarios
 */

export interface ErrorMessageOptions {
	operation?: string;
	sessionId?: string;
	serverUrl?: string;
	retryable?: boolean;
}

/**
 * Get user-friendly error message for network errors
 */
export function getNetworkErrorMessage(options: ErrorMessageOptions = {}): string {
	const { serverUrl, operation } = options;
	
	if (serverUrl) {
		return `Unable to connect to OpenCode Server at ${serverUrl}. Please ensure the server is running and accessible.`;
	}
	
	if (operation) {
		return `Network error during ${operation}. Please check your connection and try again.`;
	}
	
	return "Network error. Please check your connection and try again.";
}

/**
 * Get user-friendly error message for 404 errors
 */
export function get404ErrorMessage(options: ErrorMessageOptions = {}): string {
	const { operation, sessionId } = options;
	
	if (sessionId) {
		return `Session not found. It may have been deleted.`;
	}
	
	if (operation) {
		return `Resource not found during ${operation}.`;
	}
	
	return "Resource not found.";
}

/**
 * Get user-friendly error message for 500 errors
 */
export function get500ErrorMessage(options: ErrorMessageOptions = {}): string {
	const { operation } = options;
	
	if (operation) {
		return `Server error during ${operation}. Please try again later.`;
	}
	
	return "Server error. Please try again later.";
}

/**
 * Get user-friendly error message for timeout errors
 */
export function getTimeoutErrorMessage(options: ErrorMessageOptions = {}): string {
	const { operation, serverUrl } = options;
	
	if (serverUrl) {
		return `Request timed out connecting to ${serverUrl}. The server may be slow or unresponsive.`;
	}
	
	if (operation) {
		return `Request timed out during ${operation}. Please try again.`;
	}
	
	return "Request timed out. Please try again.";
}

/**
 * Get user-friendly error message based on error type and status code
 */
export function getUserFriendlyErrorMessage(
	error: Error | unknown,
	statusCode: number | null,
	options: ErrorMessageOptions = {},
): string {
	const errorMessage = error instanceof Error ? error.message : String(error);
	
	// Check if error is already user-friendly (enhanced)
	if (
		errorMessage.includes("Unable to connect") ||
		errorMessage.includes("Please ensure") ||
		errorMessage.startsWith("Failed to") ||
		errorMessage.includes("not found") ||
		errorMessage.includes("Server error")
	) {
		return errorMessage;
	}
	
	// Handle by status code
	if (statusCode === 404) {
		return get404ErrorMessage(options);
	}
	
	if (statusCode === 500) {
		return get500ErrorMessage(options);
	}
	
	// Handle timeout errors
	if (errorMessage.includes("timed out") || errorMessage.includes("timeout")) {
		return getTimeoutErrorMessage(options);
	}
	
	// Handle network errors
	if (
		errorMessage.includes("network") ||
		errorMessage.includes("ECONNREFUSED") ||
		errorMessage.includes("ENOTFOUND") ||
		errorMessage.includes("ETIMEDOUT")
	) {
		return getNetworkErrorMessage(options);
	}
	
	// Default: use original message with operation context if available
	if (options.operation) {
		return `Error during ${options.operation}: ${errorMessage}`;
	}
	
	return errorMessage;
}

/**
 * Extract HTTP status code from error if available
 */
export function getErrorStatusCode(error: any): number | null {
	// Check various possible locations for status code
	if (typeof error?.status === "number") {
		return error.status;
	}
	if (typeof error?.statusCode === "number") {
		return error.statusCode;
	}
	if (typeof error?.response?.status === "number") {
		return error.response.status;
	}
	// Try to parse from error message
	const match = error?.message?.match(/\b(404|500|502|503|504)\b/);
	if (match) {
		return parseInt(match[1], 10);
	}
	return null;
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: Error | unknown, statusCode: number | null): boolean {
	const errorMessage = error instanceof Error ? error.message : String(error);
	
	// Network errors are retryable
	if (
		errorMessage.includes("network") ||
		errorMessage.includes("ECONNREFUSED") ||
		errorMessage.includes("ENOTFOUND") ||
		errorMessage.includes("ETIMEDOUT") ||
		errorMessage.includes("timed out") ||
		errorMessage.includes("timeout")
	) {
		return true;
	}
	
	// 500 errors are retryable
	if (statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504) {
		return true;
	}
	
	// 404 errors are not retryable (resource doesn't exist)
	if (statusCode === 404) {
		return false;
	}
	
	// Default: not retryable
	return false;
}
