import type { Session } from "@opencode-ai/sdk/client";
import { ErrorHandler, ErrorSeverity } from "../utils/error-handler";
import { formatISOTimestamp } from "../utils/data-helpers";
import { getErrorStatusCode } from "../utils/error-messages";
import type { SessionContext } from "./types";
import type { SessionListItem, Message, SessionDiff, SearchQuery, SearchResult, FileResult, SymbolResult } from "../types";
import type { OpenCodeClient } from "./client";

/**
 * Session operations handler
 * Manages session CRUD operations and session-related API calls
 */
export class SessionOperations {
	private sdkClient: OpenCodeClient;
	private errorHandler: ErrorHandler;
	private serverUrl: string;

	// Session state
	private currentSessionId: string | null = null;
	private sessions: Map<string, Session> = new Map();
	private promptInFlightSessionId: string | null = null;

	constructor(
		sdkClient: OpenCodeClient,
		errorHandler: ErrorHandler,
		serverUrl: string,
	) {
		this.sdkClient = sdkClient;
		this.errorHandler = errorHandler;
		this.serverUrl = serverUrl;
	}

	/**
	 * Get current session ID
	 */
	getCurrentSessionId(): string | null {
		return this.currentSessionId;
	}

	/**
	 * Set current session ID
	 */
	setCurrentSessionId(sessionId: string | null): void {
		this.currentSessionId = sessionId;
	}

	/**
	 * Get prompt in flight session ID
	 */
	getPromptInFlightSessionId(): string | null {
		return this.promptInFlightSessionId;
	}

	/**
	 * Set prompt in flight session ID
	 */
	setPromptInFlightSessionId(sessionId: string | null): void {
		this.promptInFlightSessionId = sessionId;
	}

	/**
	 * Get sessions map
	 */
	getSessions(): Map<string, Session> {
		return this.sessions;
	}

	/**
	 * Clear all session state
	 */
	clearSessionState(): void {
		this.currentSessionId = null;
		this.promptInFlightSessionId = null;
		this.sessions.clear();
	}

	/**
	 * Extract session ID from SDK session object
	 * SDK returns may have id in different locations (session.info.id, session.id, etc.)
	 */
	private extractSessionId(session: Session | any): string | null {
		const sessionInfo = (session as { info?: Session }).info ?? session;
		return (
			(sessionInfo as { id?: string; sessionID?: string; sessionId?: string })
				.id ||
			(sessionInfo as { sessionID?: string; sessionId?: string }).sessionID ||
			(sessionInfo as { sessionId?: string }).sessionId ||
			null
		);
	}

	/**
	 * Check if error is already enhanced with connection details
	 */
	private isEnhancedError(error: Error): boolean {
		const errorMessage = error.message || "";
		return errorMessage.includes("Unable to connect to OpenCode Server");
	}

	/**
	 * Create appropriate error for HTTP status codes
	 */
	private createHttpError(statusCode: number, operation: string, sessionId?: string): Error {
		switch (statusCode) {
			case 404:
				return new Error(
					sessionId
						? `Session ${sessionId} not found`
						: `Resource not found during ${operation}`,
				);
			case 500:
				return new Error(`Server error during ${operation}. Please try again later.`);
			default:
				return new Error(`HTTP ${statusCode} error during ${operation}`);
		}
	}

	/**
	 * Handle operation error with consistent error handling
	 */
	private handleOperationError(
		error: unknown,
		functionName: string,
		operation: string,
		metadata: Record<string, any>,
		severity: ErrorSeverity = ErrorSeverity.Error,
	): never {
		const err = error instanceof Error ? error : new Error(String(error));
		const finalSeverity = this.isEnhancedError(err) ? ErrorSeverity.Warning : severity;
		
		this.errorHandler.handleError(
			err,
			{
				module: "SessionOperations",
				function: functionName,
				operation,
				metadata,
			},
			finalSeverity,
		);
		throw err;
	}

	/**
	 * Handle SDK response error with status code handling
	 */
	private handleSdkError(
		error: unknown,
		functionName: string,
		operation: string,
		sessionId?: string,
	): never {
		const statusCode = getErrorStatusCode(error);
		let err: Error;

		if (statusCode === 404 || statusCode === 500) {
			err = this.createHttpError(statusCode, operation, sessionId);
		} else {
			err = error instanceof Error ? error : new Error(String(error));
		}

		const severity = this.isEnhancedError(err) ? ErrorSeverity.Warning : ErrorSeverity.Error;
		this.errorHandler.handleError(
			err,
			{
				module: "SessionOperations",
				function: functionName,
				operation,
				metadata: { sessionId, statusCode },
			},
			severity,
		);
		throw err;
	}

	/**
	 * Ensure session exists locally or on server.
	 */
	async ensureSession(sessionId: string): Promise<boolean> {
		if (this.sessions.has(sessionId)) {
			return true;
		}

		try {
			const response = await this.sdkClient.session.get({
				path: { id: sessionId },
			});
			if (response.error || !response.data) {
				return false;
			}
			this.sessions.set(sessionId, response.data);
			return true;
		} catch (error) {
			this.errorHandler.handleError(
				error,
				{
					module: "SessionOperations",
					function: "ensureSession",
					operation: "Ensuring session",
					metadata: { sessionId },
				},
				ErrorSeverity.Warning,
			);
			return false;
		}
	}

	/**
	 * Create a new session
	 */
	async createSession(title?: string): Promise<string> {
		if (this.promptInFlightSessionId) {
			throw new Error(
				"Another session operation is already in progress. Only one session can run at a time.",
			);
		}
		try {
			const response = await this.sdkClient.session.create({
				body: {
					title: title || `Session ${formatISOTimestamp(Date.now())}`,
				},
			});

			if (response.error) {
				throw new Error(`Failed to create session: ${response.error}`);
			}

			if (!response.data) {
				throw new Error(
					"OpenCode Server session.create returned no data.",
				);
			}

			const session = response.data;
			const sessionInfo = (session as { info?: Session }).info ?? session;
			const sessionId = this.extractSessionId(sessionInfo);
			if (!sessionId) {
				throw new Error(
					"OpenCode Server session response did not include an id.",
				);
			}
			this.sessions.set(sessionId, sessionInfo);
			this.currentSessionId = sessionId;

			return sessionId;
		} catch (error) {
			this.handleOperationError(
				error,
				"createSession",
				"Creating session",
				{ title, serverUrl: this.serverUrl },
			);
		}
	}

	/**
	 * Start a session with context (legacy compatibility method)
	 */
	async startSession(
		context?: SessionContext,
		agent?: string,
		instructions?: string[],
	): Promise<string> {
		if (this.promptInFlightSessionId) {
			throw new Error(
				"A session is already active. Only one session can run at a time.",
			);
		}
		try {
			// Create session with context information in title
			const contextInfo = context
				? ` (${context.currentNote || "Unknown note"})`
				: "";
			const title = `Session${contextInfo}`;

			const sessionId = await this.createSession(title);

			// If we have context or instructions, send them as initial system message
			if (context || instructions?.length || agent) {
				const systemMessage = this.buildSystemMessage(
					context,
					agent,
					instructions,
				);
				if (systemMessage) {
					await this.sendMessage(sessionId, systemMessage);
				}
			}

			return sessionId;
		} catch (error) {
			this.handleOperationError(
				error,
				"startSession",
				"Starting session with context",
				{ context, agent, instructions },
			);
		}
	}

	/**
	 * Send a message to a session
	 */
	async sendMessage(sessionId: string, content: string): Promise<void> {
		if (
			this.promptInFlightSessionId &&
			this.promptInFlightSessionId !== sessionId
		) {
			throw new Error(
				"A different session is already running. Only one session can run at a time.",
			);
		}
		if (this.promptInFlightSessionId === sessionId) {
			throw new Error(
				"A message is already in progress for this session. Please wait for it to finish.",
			);
		}
		try {
			let session = this.sessions.get(sessionId);
			if (!session) {
				const response = await this.sdkClient.session.get({
					path: { id: sessionId },
				});
				if (response.error || !response.data) {
					throw new Error(`Session ${sessionId} not found`);
				}
				session = response.data;
				this.sessions.set(sessionId, session);
			}

			this.promptInFlightSessionId = sessionId;

			// Streaming operation - use timeout to avoid blocking
			const promptPromise = this.sdkClient.session.prompt({
				path: { id: sessionId },
				body: {
					parts: [{ type: "text", text: content }],
				},
			});
			
			const timeoutPromise = new Promise<{ error?: string; data?: any }>((resolve) => {
				setTimeout(() => resolve({ data: {} }), 5000);
			});
			
			const response = await Promise.race([promptPromise, timeoutPromise]);
			
			// Log background errors without blocking
			promptPromise.catch((error) => {
				this.errorHandler.handleError(
					error instanceof Error ? error : new Error(String(error)),
					{
						module: "SessionOperations",
						function: "sendMessage",
						operation: "Background prompt error",
						metadata: { sessionId },
					},
					ErrorSeverity.Warning,
				);
			});
			if (response.error) {
				throw new Error(`Failed to send message: ${response.error}`);
			}
		} catch (error) {
			if (this.promptInFlightSessionId === sessionId) {
				this.promptInFlightSessionId = null;
			}
			this.handleOperationError(
				error,
				"sendMessage",
				"Sending message",
				{ sessionId, contentLength: content.length },
			);
		}
	}

	/**
	 * Send a session message (legacy compatibility method)
	 */
	async sendSessionMessage(
		sessionId: string,
		content: string,
		images?: any[],
	): Promise<void> {
		try {
			// For now, ignore images as SDK client may handle them differently
			if (images?.length) {
				this.errorHandler.handleError(
					new Error("Image attachments not yet supported in SDK client"),
					{
						module: "SessionOperations",
						function: "sendSessionMessage",
						operation: "Sending session message with images",
						metadata: { imageCount: images.length },
					},
					ErrorSeverity.Warning,
				);
			}

			await this.sendMessage(sessionId, content);
		} catch (error) {
			this.handleOperationError(
				error,
				"sendSessionMessage",
				"Sending session message",
				{ sessionId, contentLength: content.length, imageCount: images?.length },
			);
		}
	}

	/**
	 * Send a command to a session.
	 */
	async sendSessionCommand(
		sessionId: string,
		command: string,
		argumentsText: string,
		agent?: string,
	): Promise<string | null> {
		if (
			this.promptInFlightSessionId &&
			this.promptInFlightSessionId !== sessionId
		) {
			throw new Error(
				"A different session is already running. Only one session can run at a time.",
			);
		}
		if (this.promptInFlightSessionId === sessionId) {
			throw new Error(
				"A command is already in progress for this session. Please wait for it to finish.",
			);
		}
		try {
			this.promptInFlightSessionId = sessionId;
			const response = await this.sdkClient.session.command({
				path: { id: sessionId },
				body: {
					command,
					arguments: argumentsText,
					...(agent ? { agent } : {}),
				},
			});

			if (response.error) {
				throw new Error(`Failed to send command: ${response.error}`);
			}

			const parts = (response.data as { parts?: Array<{ type?: string; text?: string }> })
				?.parts;
			if (!parts || parts.length === 0) {
				return null;
			}

			const text = parts
				.filter((part) => part.type === "text" && part.text)
				.map((part) => part.text)
				.join("");
			return text || null;
		} catch (error) {
			this.handleOperationError(
				error,
				"sendSessionCommand",
				"Sending session command",
				{ sessionId, command },
			);
			// handleOperationError always throws, but TypeScript needs explicit return
			return null;
		} finally {
			if (this.promptInFlightSessionId === sessionId) {
				this.promptInFlightSessionId = null;
			}
		}
	}

	/**
	 * Abort a session
	 */
	async abortSession(sessionId: string): Promise<void> {
		try {
			const session = this.sessions.get(sessionId);
			if (!session) {
				this.errorHandler.handleError(
					new Error(`Session ${sessionId} not found for abort`),
					{
						module: "SessionOperations",
						function: "abortSession",
						operation: "Aborting session",
						metadata: { sessionId },
					},
					ErrorSeverity.Warning,
				);
				return;
			}

			// Abort the session
			const response = await this.sdkClient.session.abort({
				path: { id: sessionId },
			});

			if (response.error) {
				this.errorHandler.handleError(
					new Error(`Failed to abort session: ${response.error}`),
					{
						module: "SessionOperations",
						function: "abortSession",
						operation: "Aborting session",
						metadata: { sessionId, error: response.error },
					},
					ErrorSeverity.Warning,
				);
			}

			// Clean up local state
			this.sessions.delete(sessionId);
			if (this.currentSessionId === sessionId) {
				this.currentSessionId = null;
			}
			if (this.promptInFlightSessionId === sessionId) {
				this.promptInFlightSessionId = null;
			}
		} catch (error) {
			this.handleOperationError(
				error,
				"abortSession",
				"Aborting session",
				{ sessionId },
			);
		}
	}

	/**
	 * Responds to a server permission request with retry logic.
	 * Implements automatic retry: initial attempt + 1 retry after 500ms delay.
	 */
	async respondToPermission(
		sessionId: string,
		requestId: string,
		approved: boolean,
		reason?: string,
	): Promise<void> {
		const maxAttempts = 2;
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const response = await (this.sdkClient as any).session.permission.respond({
					path: { id: sessionId },
					body: { requestId, approved, reason },
				});

				if (response.error) {
					throw new Error(`Permission response failed: ${response.error}`);
				}

				return;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (attempt < maxAttempts) {
					this.errorHandler.handleError(
						lastError,
						{
							module: "SessionOperations",
							function: "respondToPermission",
							operation: `Retry attempt ${attempt}`,
							metadata: { sessionId, requestId, approved },
						},
						ErrorSeverity.Warning,
					);
					await new Promise((resolve) => setTimeout(resolve, 500));
				}
			}
		}

		this.handleOperationError(
			lastError!,
			"respondToPermission",
			"All retry attempts failed",
			{ sessionId, requestId, approved, attempts: maxAttempts },
		);
	}

	/**
	 * List all sessions from the server
	 */
	async listSessions(): Promise<SessionListItem[]> {
		try {
			const response = await this.sdkClient.session.list();

			if (response.error) {
				throw new Error(`Failed to list sessions: ${response.error}`);
			}

			if (!response.data) {
				throw new Error("OpenCode Server session.list returned no data.");
			}

			// Transform SDK Session objects to SessionListItem format
			return response.data.map((session) => ({
				id: session.id,
				title: session.title || `Session ${session.id}`,
				lastUpdated: session.time.updated,
				messageCount: 0, // Will be populated by getSessionMessages if needed
				isActive: session.id === this.currentSessionId,
			}));
		} catch (error) {
			this.handleSdkError(error, "listSessions", "listing sessions");
		}
	}

	/**
	 * Get messages for a specific session
	 */
	async getSessionMessages(sessionId: string): Promise<Message[]> {
		try {
			const response = await this.sdkClient.session.messages({
				path: { id: sessionId },
			});

			if (response.error) {
				throw new Error(`Failed to get session messages: ${response.error}`);
			}

			if (!response.data) {
				throw new Error("OpenCode Server session.messages returned no data.");
			}

			// Transform SDK message format to our Message format
			return response.data.map((msg) => {
				// Extract text content from parts
				const textParts = msg.parts
					.filter((part: any) => part.type === "text" && part.text)
					.map((part: any) => part.text);
				const content = textParts.join("\n");

				return {
					id: msg.info.id,
					role: msg.info.role as "user" | "assistant",
					content,
					timestamp: msg.info.time.created,
				};
			});
		} catch (error) {
			this.handleSdkError(error, "getSessionMessages", "getting session messages", sessionId);
		}
	}

	/**
	 * Update session title
	 */
	async updateSessionTitle(sessionId: string, title: string): Promise<void> {
		try {
			const response = await this.sdkClient.session.update({
				path: { id: sessionId },
				body: { title },
			});

			if (response.error) {
				throw new Error(`Failed to update session title: ${response.error}`);
			}

			// Update local session cache if it exists
			const session = this.sessions.get(sessionId);
			if (session) {
				(session as any).title = title;
			}
		} catch (error) {
			this.handleSdkError(error, "updateSessionTitle", "updating session title", sessionId);
		}
	}

	/**
	 * Delete a session from the server
	 */
	async deleteSession(sessionId: string): Promise<void> {
		try {
			const response = await this.sdkClient.session.delete({
				path: { id: sessionId },
			});

			if (response.error) {
				throw new Error(`Failed to delete session: ${response.error}`);
			}

			// Clean up local state
			this.sessions.delete(sessionId);
			if (this.currentSessionId === sessionId) {
				this.currentSessionId = null;
			}
			if (this.promptInFlightSessionId === sessionId) {
				this.promptInFlightSessionId = null;
			}
		} catch (error) {
			const statusCode = getErrorStatusCode(error);
			// For 404 errors during delete, clean up local state anyway
			if (statusCode === 404) {
				this.sessions.delete(sessionId);
				if (this.currentSessionId === sessionId) {
					this.currentSessionId = null;
				}
				if (this.promptInFlightSessionId === sessionId) {
					this.promptInFlightSessionId = null;
				}
			}
			this.handleSdkError(error, "deleteSession", "deleting session", sessionId);
		}
	}

	/**
	 * Revert a session to a specific message
	 */
	async revertSession(sessionId: string, messageId: string): Promise<void> {
		try {
			const response = await this.sdkClient.session.revert({
				path: { id: sessionId },
				body: { messageID: messageId },
			});

			if (response.error) {
				throw new Error(`Failed to revert session: ${response.error}`);
			}
		} catch (error) {
			this.handleSdkError(error, "revertSession", "reverting session", sessionId);
		}
	}

	/**
	 * Unrevert a session
	 */
	async unrevertSession(sessionId: string): Promise<void> {
		try {
			const response = await this.sdkClient.session.unrevert({
				path: { id: sessionId },
			});

			if (response.error) {
				throw new Error(`Failed to unrevert session: ${response.error}`);
			}
		} catch (error) {
			this.handleSdkError(error, "unrevertSession", "unreverting session", sessionId);
		}
	}

	/**
	 * Fork a session from a specific message point
	 * Creates a new session that branches from the parent session
	 */
	async forkSession(
		sessionId: string,
		messageId?: string,
		title?: string,
	): Promise<string> {
		try {
			const response = await this.sdkClient.session.fork({
				path: { id: sessionId },
				body: {
					...(messageId ? { messageID: messageId } : {}),
					...(title ? { title } : {}),
				},
			});

			if (response.error) {
				throw new Error(`Failed to fork session: ${response.error}`);
			}

			if (!response.data) {
				throw new Error("OpenCode Server session.fork returned no data.");
			}

			// Extract session ID from response
			const forkedSessionId = this.extractSessionId(response.data);
			if (!forkedSessionId) {
				throw new Error("OpenCode Server fork response did not include a session id.");
			}

			// Cache the forked session
			this.sessions.set(forkedSessionId, response.data);

			return forkedSessionId;
		} catch (error) {
			this.handleSdkError(error, "forkSession", "forking session", sessionId);
		}
	}

	/**
	 * Get file changes (diff) for a session
	 */
	async getSessionDiff(sessionId: string): Promise<SessionDiff> {
		try {
			const response = await this.sdkClient.session.diff({
				path: { id: sessionId },
			});

			if (response.error) {
				throw new Error(`Failed to get session diff: ${response.error}`);
			}

			if (!response.data) {
				throw new Error("OpenCode Server session.diff returned no data.");
			}

			// Transform SDK diff format to our SessionDiff format
			const files = (response.data as any).files || [];
			const transformedFiles = files.map((file: any) => ({
				path: file.path || "",
				added: file.added || [],
				removed: file.removed || [],
				language: file.language,
			}));

			return {
				sessionId,
				files: transformedFiles,
			};
		} catch (error) {
			this.handleSdkError(error, "getSessionDiff", "getting session diff", sessionId);
		}
	}

	/**
	 * Build system message from context and instructions
	 */
	private buildSystemMessage(
		context?: SessionContext,
		agent?: string,
		instructions?: string[],
	): string | null {
		const parts: string[] = [];

		if (agent) {
			parts.push(`Agent: ${agent}`);
		}

		if (instructions?.length) {
			parts.push(`Instructions: ${instructions.join(", ")}`);
		}

		if (context) {
			const contextParts: string[] = [];
			if (context.currentNote)
				contextParts.push(`Current note: ${context.currentNote}`);
			if (context.selection)
				contextParts.push(`Selection: ${context.selection}`);
			if (context.links?.length)
				contextParts.push(`Links: ${context.links.join(", ")}`);
			if (context.tags?.length)
				contextParts.push(`Tags: ${context.tags.join(", ")}`);

			if (contextParts.length) {
				parts.push(`Context: ${contextParts.join("; ")}`);
			}
		}

		return parts.length > 0 ? parts.join("\n") : null;
	}

	/**
	 * Search for text across all files
	 */
	async searchText(query: SearchQuery): Promise<SearchResult[]> {
		try {
			const response = await this.sdkClient.find.text({
				query: {
					pattern: query.pattern,
					...(query.path ? { directory: query.path } : {}),
				},
				...(query.language ? { language: query.language } : {}),
				...(query.limit ? { limit: query.limit } : {}),
				...(query.caseSensitive ? { caseSensitive: query.caseSensitive } : {}),
				...(query.regex ? { regex: query.regex } : {}),
			});

			if (response.error) {
				throw new Error(`Failed to search text: ${response.error}`);
			}

			if (!response.data) {
				return [];
			}

			// Transform SDK search results to our SearchResult format
			return response.data.map((result: any) => ({
				path: result.path || "",
				line: result.line || 0,
				content: result.content || "",
				language: result.language,
			}));
		} catch (error) {
			this.handleSdkError(error, "searchText", "searching text");
		}
	}

	/**
	 * Search for files by name or pattern
	 */
	async searchFiles(query: string, limit?: number): Promise<FileResult[]> {
		try {
			const response = await this.sdkClient.find.files({
				query: { query },
				...(limit ? { limit } : {}),
			});

			if (response.error) {
				throw new Error(`Failed to search files: ${response.error}`);
			}

			if (!response.data) {
				return [];
			}

			// Transform SDK file results to our FileResult format
			return response.data.map((result: any) => ({
				path: result.path || "",
				size: result.size || 0,
				lastModified: result.lastModified || Date.now(),
				language: result.language,
			}));
		} catch (error) {
			this.handleSdkError(error, "searchFiles", "searching files");
		}
	}

	/**
	 * Search for symbols across all files
	 */
	async searchSymbols(query: string, limit?: number): Promise<SymbolResult[]> {
		try {
			const response = await this.sdkClient.find.symbols({
				query: { query },
				...(limit ? { limit } : {}),
			});

			if (response.error) {
				throw new Error(`Failed to search symbols: ${response.error}`);
			}

			if (!response.data) {
				return [];
			}

			// Transform SDK symbol results to our SymbolResult format
			return response.data.map((result: any) => ({
				name: result.name || "",
				type: result.type || "",
				path: result.path || "",
				line: result.line || 0,
				column: result.column || 0,
				parent: result.parent,
			}));
		} catch (error) {
			this.handleSdkError(error, "searchSymbols", "searching symbols");
		}
	}
}
