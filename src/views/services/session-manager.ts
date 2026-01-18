import type { OpenCodeServerClient } from "../../client/client";
import type { SessionListItem, Message, Conversation } from "../../types";
import { ErrorHandler, ErrorSeverity } from "../../utils/error-handler";
import { getUserFriendlyErrorMessage, isRetryableError, getErrorStatusCode } from "../../utils/error-messages";

/**
 * Cache entry for session list with TTL
 */
interface SessionListCache {
	sessions: SessionListItem[];
	fetchedAt: number;
}

/**
 * Retry configuration for failed operations
 */
interface RetryConfig {
	maxAttempts: number;
	delayMs: number;
	backoffMultiplier: number;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxAttempts: 3,
	delayMs: 1000,
	backoffMultiplier: 2,
};

/**
 * SessionManager handles all session operations with the OpenCode Server
 * Provides CRUD operations for sessions and message history management
 */
export class SessionManager {
	private sessionListCache: SessionListCache | null = null;
	private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
	private localOnlyMode: boolean = false;
	private onSessionNotFoundCallback?: (sessionId: string) => void;

	constructor(
		private client: OpenCodeServerClient,
		private errorHandler: ErrorHandler,
	) {}

	/**
	 * Set callback to be called when a session is not found (404 error)
	 * This allows the UI to remove the session from local state
	 */
	setOnSessionNotFoundCallback(callback: (sessionId: string) => void): void {
		this.onSessionNotFoundCallback = callback;
	}

	/**
	 * Check if session management features are available
	 * Returns true if all core features are available, false otherwise
	 */
	async checkFeatureAvailability(): Promise<boolean> {
		try {
			const hasListFeature = await this.client.hasFeature("session.list");
			const hasCreateFeature = await this.client.hasFeature("session.create");
			const hasGetFeature = await this.client.hasFeature("session.get");
			const hasMessagesFeature = await this.client.hasFeature("session.messages");

			// Core features required for session management
			const coreAvailable = hasListFeature && hasCreateFeature && hasGetFeature && hasMessagesFeature;

			// If core features are not available, switch to local-only mode
			if (!coreAvailable) {
				this.localOnlyMode = true;
			}

			return coreAvailable;
		} catch (error) {
			// If feature detection fails, assume local-only mode
			this.localOnlyMode = true;
			this.errorHandler.handleError(
				error,
				{
					module: "SessionManager",
					function: "checkFeatureAvailability",
					operation: "Checking feature availability",
				},
				ErrorSeverity.Warning,
			);
			return false;
		}
	}

	/**
	 * Get missing core features for error messaging
	 * Returns array of missing feature names
	 */
	async getMissingCoreFeatures(): Promise<string[]> {
		const coreFeatures = [
			"session.list",
			"session.create",
			"session.get",
			"session.messages",
		];

		const missing: string[] = [];

		for (const feature of coreFeatures) {
			const hasFeature = await this.client.hasFeature(feature);
			if (!hasFeature) {
				missing.push(feature);
			}
		}

		return missing;
	}

	/**
	 * Get user-friendly error message for missing features
	 * Includes version requirements and missing feature list
	 */
	async getFeatureErrorMessage(): Promise<string> {
		const missingFeatures = await this.getMissingCoreFeatures();

		if (missingFeatures.length === 0) {
			return "";
		}

		const featureList = missingFeatures.join(", ");
		return `Session management is not available. Your OpenCode Server is missing required features: ${featureList}. Please upgrade to OpenCode Server version 1.0.0 or later.`;
	}

	/**
	 * Check if running in local-only mode (server features unavailable)
	 */
	isLocalOnlyMode(): boolean {
		return this.localOnlyMode;
	}

	/**
	 * List all sessions from the server
	 * Uses in-memory cache with 5-minute TTL
	 * Returns empty array if in local-only mode
	 */
	async listSessions(forceRefresh: boolean = false): Promise<SessionListItem[]> {
		// Return empty array if in local-only mode
		if (this.localOnlyMode) {
			return [];
		}

		// Check cache validity
		if (!forceRefresh && this.sessionListCache) {
			const now = Date.now();
			const cacheAge = now - this.sessionListCache.fetchedAt;
			if (cacheAge < this.CACHE_TTL_MS) {
				return this.sessionListCache.sessions;
			}
		}

		try {
			// Fetch from server
			const sessions = await this.client.listSessions();

			// Update cache
			this.sessionListCache = {
				sessions,
				fetchedAt: Date.now(),
			};

			return sessions;
		} catch (error) {
			// If listing fails, switch to local-only mode
			this.localOnlyMode = true;
			
			// Create user-friendly error
			const statusCode = getErrorStatusCode(error);
			const friendlyMessage = getUserFriendlyErrorMessage(error, statusCode, {
				operation: "listing sessions",
				serverUrl: this.client.getConfig().url,
			});
			
			const enhancedError = new Error(friendlyMessage);
			this.errorHandler.handleError(
				enhancedError,
				{
					module: "SessionManager",
					function: "listSessions",
					operation: "Listing sessions",
				},
				ErrorSeverity.Warning,
			);
			return [];
		}
	}

	/**
	 * Create a new session on the server
	 * Invalidates session list cache
	 * Throws error if in local-only mode
	 */
	async createSession(title?: string): Promise<string> {
		if (this.localOnlyMode) {
			throw new Error("Session creation is not available. Server does not support session management.");
		}

		try {
			const sessionId = await this.client.createSession(title);

			// Invalidate cache after creation
			this.invalidateCache();

			return sessionId;
		} catch (error) {
			// Create user-friendly error
			const statusCode = getErrorStatusCode(error);
			const friendlyMessage = getUserFriendlyErrorMessage(error, statusCode, {
				operation: "creating session",
				serverUrl: this.client.getConfig().url,
			});
			
			const enhancedError = new Error(friendlyMessage);
			this.errorHandler.handleError(
				enhancedError,
				{
					module: "SessionManager",
					function: "createSession",
					operation: "Creating session",
					metadata: { title },
				},
				ErrorSeverity.Error,
			);
			throw enhancedError;
		}
	}

	/**
	 * Load message history for a session from the server
	 * Returns empty array if in local-only mode
	 */
	async loadSessionMessages(sessionId: string): Promise<Message[]> {
		if (this.localOnlyMode) {
			return [];
		}

		try {
			const messages = await this.client.getSessionMessages(sessionId);
			return messages;
		} catch (error) {
			const statusCode = getErrorStatusCode(error);
			
			// Handle 404 errors by notifying callback to remove session from local cache
			if (statusCode === 404) {
				console.debug(`[SessionManager] Session ${sessionId} not found (404), removing from local cache`);
				this.onSessionNotFoundCallback?.(sessionId);
			}
			
			// Create user-friendly error
			const friendlyMessage = getUserFriendlyErrorMessage(error, statusCode, {
				operation: "loading session messages",
				sessionId,
			});
			
			const enhancedError = new Error(friendlyMessage);
			this.errorHandler.handleError(
				enhancedError,
				{
					module: "SessionManager",
					function: "loadSessionMessages",
					operation: "Loading session messages",
					metadata: { sessionId, statusCode },
				},
				ErrorSeverity.Warning,
			);
			return [];
		}
	}

	/**
	 * Update session title on the server
	 * No-op if in local-only mode
	 */
	async updateSessionTitle(sessionId: string, title: string): Promise<void> {
		if (this.localOnlyMode) {
			// Silently ignore in local-only mode
			return;
		}

		try {
			await this.client.updateSessionTitle(sessionId, title);

			// Invalidate cache after update
			this.invalidateCache();
		} catch (error) {
			const statusCode = getErrorStatusCode(error);
			
			// Handle 404 errors by notifying callback to remove session from local cache
			if (statusCode === 404) {
				console.debug(`[SessionManager] Session ${sessionId} not found (404), removing from local cache`);
				this.onSessionNotFoundCallback?.(sessionId);
			}
			
			// Create user-friendly error
			const friendlyMessage = getUserFriendlyErrorMessage(error, statusCode, {
				operation: "updating session title",
				sessionId,
			});
			
			const enhancedError = new Error(friendlyMessage);
			this.errorHandler.handleError(
				enhancedError,
				{
					module: "SessionManager",
					function: "updateSessionTitle",
					operation: "Updating session title",
					metadata: { sessionId, title, statusCode },
				},
				ErrorSeverity.Warning,
			);
		}
	}

	/**
	 * Delete a session from the server
	 * Invalidates session list cache
	 * No-op if in local-only mode
	 */
	async deleteSession(sessionId: string): Promise<void> {
		if (this.localOnlyMode) {
			// Silently ignore in local-only mode
			return;
		}

		try {
			await this.client.deleteSession(sessionId);

			// Invalidate cache after deletion
			this.invalidateCache();
		} catch (error) {
			// Create user-friendly error
			const statusCode = getErrorStatusCode(error);
			const friendlyMessage = getUserFriendlyErrorMessage(error, statusCode, {
				operation: "deleting session",
				sessionId,
			});
			
			const enhancedError = new Error(friendlyMessage);
			this.errorHandler.handleError(
				enhancedError,
				{
					module: "SessionManager",
					function: "deleteSession",
					operation: "Deleting session",
					metadata: { sessionId },
				},
				ErrorSeverity.Warning,
			);
		}
	}

	/**
	 * Revert a session to a specific message
	 * Messages after the specified message will be hidden
	 * No-op if in local-only mode
	 */
	async revertSession(sessionId: string, messageId: string): Promise<void> {
		if (this.localOnlyMode) {
			// Silently ignore in local-only mode
			return;
		}

		try {
			await this.client.revertSession(sessionId, messageId);
		} catch (error) {
			const statusCode = getErrorStatusCode(error);
			
			// Handle 404 errors by notifying callback to remove session from local cache
			if (statusCode === 404) {
				console.debug(`[SessionManager] Session ${sessionId} not found (404), removing from local cache`);
				this.onSessionNotFoundCallback?.(sessionId);
			}
			
			// Create user-friendly error
			const friendlyMessage = getUserFriendlyErrorMessage(error, statusCode, {
				operation: "reverting session",
				sessionId,
			});
			
			const enhancedError = new Error(friendlyMessage);
			this.errorHandler.handleError(
				enhancedError,
				{
					module: "SessionManager",
					function: "revertSession",
					operation: "Reverting session",
					metadata: { sessionId, messageId, statusCode },
				},
				ErrorSeverity.Warning,
			);
			throw enhancedError;
		}
	}

	/**
	 * Unrevert a session to restore all reverted messages
	 * No-op if in local-only mode
	 */
	async unrevertSession(sessionId: string): Promise<void> {
		if (this.localOnlyMode) {
			// Silently ignore in local-only mode
			return;
		}

		try {
			await this.client.unrevertSession(sessionId);
		} catch (error) {
			const statusCode = getErrorStatusCode(error);
			
			// Handle 404 errors by notifying callback to remove session from local cache
			if (statusCode === 404) {
				console.debug(`[SessionManager] Session ${sessionId} not found (404), removing from local cache`);
				this.onSessionNotFoundCallback?.(sessionId);
			}
			
			// Create user-friendly error
			const friendlyMessage = getUserFriendlyErrorMessage(error, statusCode, {
				operation: "unreverting session",
				sessionId,
			});
			
			const enhancedError = new Error(friendlyMessage);
			this.errorHandler.handleError(
				enhancedError,
				{
					module: "SessionManager",
					function: "unrevertSession",
					operation: "Unreverting session",
					metadata: { sessionId, statusCode },
				},
				ErrorSeverity.Warning,
			);
			throw enhancedError;
		}
	}

	/**
	 * Fork a session from a specific message point
	 * Creates a new session that branches from the parent session
	 * @param sessionId - ID of the session to fork
	 * @param messageId - Optional message ID to fork from
	 * @param title - Optional title for the forked session
	 * @returns Promise<string> - ID of the newly created forked session
	 */
	async forkSession(
		sessionId: string,
		messageId?: string,
		title?: string,
	): Promise<string> {
		if (this.localOnlyMode) {
			throw new Error(
				"Session forking is not available. Server does not support session management.",
			);
		}

		try {
			const forkedSessionId = await this.client.forkSession(
				sessionId,
				messageId,
				title,
			);

			// Invalidate cache to force refresh on next list
			this.invalidateCache();

			return forkedSessionId;
		} catch (error) {
			const statusCode = getErrorStatusCode(error);

			// Handle 404 errors by notifying callback to remove session from local cache
			if (statusCode === 404) {
				console.debug(
					`[SessionManager] Session ${sessionId} not found (404), removing from local cache`,
				);
				this.onSessionNotFoundCallback?.(sessionId);
			}

			// Create user-friendly error
			const friendlyMessage = getUserFriendlyErrorMessage(
				error,
				statusCode,
				{
					operation: "forking session",
					sessionId,
				},
			);

			const enhancedError = new Error(friendlyMessage);
			this.errorHandler.handleError(
				enhancedError,
				{
					module: "SessionManager",
					function: "forkSession",
					operation: "Forking session",
					metadata: { sessionId, messageId, title, statusCode },
				},
				ErrorSeverity.Error,
			);
			throw enhancedError;
		}
	}

	/**
	 * Invalidate the session list cache
	 * Called after create, update, or delete operations
	 */
	private invalidateCache(): void {
		this.sessionListCache = null;
	}

	/**
	 * Clear the session list cache manually
	 * Useful for forcing a refresh on next listSessions call
	 */
	clearCache(): void {
		this.invalidateCache();
	}

	// Using imported getErrorStatusCode from utils/error-messages.ts

	/**
	 * Sleep for specified milliseconds
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Retry an operation with exponential backoff
	 * Only retries if the error is retryable (network errors, 500 errors)
	 */
	private async retryOperation<T>(
		operation: () => Promise<T>,
		operationName: string,
		config: RetryConfig = DEFAULT_RETRY_CONFIG,
	): Promise<T> {
		let lastError: Error | null = null;
		let delay = config.delayMs;

		for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				const statusCode = getErrorStatusCode(error);

				// Check if error is retryable
				if (!isRetryableError(error, statusCode)) {
					// Not retryable, throw immediately
					throw lastError;
				}

				// If this was the last attempt, throw
				if (attempt === config.maxAttempts) {
					throw lastError;
				}

				// Log retry attempt
				console.debug(
					`[SessionManager] Retrying ${operationName} (attempt ${attempt}/${config.maxAttempts}) after ${delay}ms`,
				);

				// Wait before retrying
				await this.sleep(delay);

				// Increase delay for next attempt (exponential backoff)
				delay *= config.backoffMultiplier;
			}
		}

		// Should never reach here, but throw last error just in case
		throw lastError || new Error(`Failed to ${operationName} after ${config.maxAttempts} attempts`);
	}

	/**
	 * List sessions with automatic retry on failure
	 */
	async listSessionsWithRetry(forceRefresh: boolean = false): Promise<SessionListItem[]> {
		return this.retryOperation(
			() => this.listSessions(forceRefresh),
			"list sessions",
		);
	}

	/**
	 * Create session with automatic retry on failure
	 */
	async createSessionWithRetry(title?: string): Promise<string> {
		return this.retryOperation(
			() => this.createSession(title),
			"create session",
		);
	}

	/**
	 * Load session messages with automatic retry on failure
	 */
	async loadSessionMessagesWithRetry(sessionId: string): Promise<Message[]> {
		return this.retryOperation(
			() => this.loadSessionMessages(sessionId),
			"load session messages",
		);
	}

	/**
	 * Update session title with automatic retry on failure
	 */
	async updateSessionTitleWithRetry(sessionId: string, title: string): Promise<void> {
		return this.retryOperation(
			() => this.updateSessionTitle(sessionId, title),
			"update session title",
		);
	}

	/**
	 * Delete session with automatic retry on failure
	 */
	async deleteSessionWithRetry(sessionId: string): Promise<void> {
		return this.retryOperation(
			() => this.deleteSession(sessionId),
			"delete session",
		);
	}

	/**
	 * Fork session with automatic retry on failure
	 */
	async forkSessionWithRetry(
		sessionId: string,
		messageId?: string,
		title?: string,
	): Promise<string> {
		return this.retryOperation(
			() => this.forkSession(sessionId, messageId, title),
			"fork session",
		);
	}
}
