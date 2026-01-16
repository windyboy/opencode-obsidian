import type { Conversation, PluginData, SessionListItem } from "../../types";
import type OpenCodeObsidianPlugin from "../../main";
import { ErrorSeverity } from "../../utils/error-handler";
import type { SessionManager } from "./session-manager";

export class ConversationSync {
	private syncTimer: ReturnType<typeof setInterval> | null = null;
	private isSyncing = false;

	constructor(
		private plugin: OpenCodeObsidianPlugin,
		private sessionManager: SessionManager | null,
		private getConversations: () => Conversation[],
		private getActiveConversationId: () => string | null,
		private setActiveConversationId: (id: string | null) => void,
		private setConversations: (convs: Conversation[]) => void,
		private saveConversations: () => Promise<void>,
		private updateConversationSelector: () => void,
		private updateMessages: () => void,
		private createNewConversation: () => Promise<void>,
		private findConversationBySessionId: (
			sessionId: string,
		) => Conversation | null,
	) {}

	private get conversations(): Conversation[] {
		return this.getConversations();
	}

	private get activeConversationId(): string | null {
		return this.getActiveConversationId();
	}

	/**
	 * Map server sessions to local Conversation objects
	 * Subtask 4.2: Proper field mapping from SessionListItem to Conversation
	 */
	private mapServerSessionsToConversations(
		sessions: SessionListItem[],
	): Conversation[] {
		return sessions.map((session) => {
			// Generate a unique conversation ID based on session ID
			const conversationId = `conv-${session.id}`;

			return {
				id: conversationId,
				title: session.title,
				messages: [], // Messages will be loaded on demand
				createdAt: session.lastUpdated, // Use lastUpdated as createdAt approximation
				updatedAt: session.lastUpdated,
				sessionId: session.id,
			};
		});
	}

	/**
	 * Merge server sessions with existing local conversations
	 * Subtask 4.3: Match by sessionId and preserve local data
	 * Subtask 4.4: Handle sessions that exist on server but not locally
	 * Subtask 4.5: Handle sessions that exist locally but not on server
	 */
	private mergeConversations(
		localConversations: Conversation[],
		serverConversations: Conversation[],
	): Conversation[] {
		// Create a map of server sessions by sessionId for quick lookup
		const serverSessionMap = new Map<string, Conversation>();
		for (const serverConv of serverConversations) {
			if (serverConv.sessionId) {
				serverSessionMap.set(serverConv.sessionId, serverConv);
			}
		}

		// Create a map of local conversations by sessionId
		const localSessionMap = new Map<string, Conversation>();
		const localConversationsWithoutSession: Conversation[] = [];

		for (const localConv of localConversations) {
			if (localConv.sessionId) {
				localSessionMap.set(localConv.sessionId, localConv);
			} else {
				// Keep local conversations without sessionId
				localConversationsWithoutSession.push(localConv);
			}
		}

		const mergedConversations: Conversation[] = [];

		// 1. Process all server sessions
		for (const [sessionId, serverConv] of serverSessionMap) {
			const localConv = localSessionMap.get(sessionId);

			if (localConv) {
				// Session exists both locally and on server - merge them
				// Preserve local messages and metadata, update title from server
				mergedConversations.push({
					...localConv,
					title: serverConv.title, // Update title from server
					updatedAt: serverConv.updatedAt, // Update timestamp from server
				});
			} else {
				// Session exists on server but not locally - add it (subtask 4.4)
				mergedConversations.push(serverConv);
				console.debug(
					`[ConversationSync] Added new session from server: ${sessionId}`,
				);
			}
		}

		// 2. Process local conversations that don't exist on server (subtask 4.5)
		// Policy: Keep local conversations without sessionId, remove those with sessionId not on server
		for (const [sessionId, localConv] of localSessionMap) {
			if (!serverSessionMap.has(sessionId)) {
				// Session exists locally but not on server - remove it
				console.debug(
					`[ConversationSync] Removing local conversation with deleted server session: ${sessionId}`,
				);
				// Don't add to mergedConversations (effectively removing it)
			}
		}

		// 3. Add local conversations without sessionId (keep them)
		mergedConversations.push(...localConversationsWithoutSession);

		// 4. Sort by updatedAt (most recent first)
		mergedConversations.sort((a, b) => b.updatedAt - a.updatedAt);

		return mergedConversations;
	}

	async syncConversationsFromServer(): Promise<void> {
		if (!this.plugin.opencodeClient?.isConnected()) {
			if (this.conversations.length === 0) {
				await this.createNewConversation();
			}
			return;
		}

		// If SessionManager is not available, fall back to old behavior
		if (!this.sessionManager) {
			console.debug(
				"[ConversationSync] SessionManager not available, skipping server sync",
			);
			if (this.conversations.length === 0) {
				await this.createNewConversation();
			}
			return;
		}

		try {
			// 1. Fetch all sessions from server using SessionManager
			const serverSessions = await this.sessionManager.listSessions(true); // Force refresh

			// 2. Map server sessions to local conversations (subtask 4.2)
			const serverConversations = this.mapServerSessionsToConversations(serverSessions);

			// 3. Merge with existing local conversations (subtask 4.3)
			const mergedConversations = this.mergeConversations(
				this.conversations,
				serverConversations,
			);

			// 4. Update conversations list
			this.setConversations(mergedConversations);

			// 5. Ensure we have an active conversation
			if (!this.activeConversationId && mergedConversations.length > 0) {
				this.setActiveConversationId(mergedConversations[0]?.id ?? null);
			}

			// 6. Save and update UI
			await this.saveConversations();
			this.updateConversationSelector();
			this.updateMessages();

			// 7. If no conversations after sync, create a new one
			if (this.conversations.length === 0) {
				await this.createNewConversation();
			}

			console.debug(
				`[ConversationSync] Conversation sync completed. Total: ${this.conversations.length}`,
			);
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "ConversationSync",
					function: "syncConversationsFromServer",
					operation: "Syncing conversations from server",
				},
				ErrorSeverity.Warning,
			);
			if (this.conversations.length === 0) {
				await this.createNewConversation();
			}
		}
	}

	/**
	 * Start periodic sync timer (every 5 minutes)
	 * Subtask 17.1: Add periodic sync timer
	 */
	startPeriodicSync(): void {
		this.stopPeriodicSync();

		// Sync every 5 minutes (300000ms)
		this.syncTimer = setInterval(() => {
			void this.performBackgroundSync();
		}, 300000);

		console.debug("[ConversationSync] Periodic sync started (5 minute interval)");
	}

	/**
	 * Stop periodic sync timer
	 * Subtask 17.5: Clear sync timer on plugin unload
	 */
	stopPeriodicSync(): void {
		if (this.syncTimer) {
			clearInterval(this.syncTimer);
			this.syncTimer = null;
			console.debug("[ConversationSync] Periodic sync stopped");
		}
	}

	/**
	 * Perform background sync without disrupting UI
	 * Subtask 17.2: Implement background sync that updates session list without disrupting UI
	 * Subtask 17.3: Handle concurrent modifications by comparing timestamps
	 */
	private async performBackgroundSync(): Promise<void> {
		// Prevent concurrent syncs
		if (this.isSyncing) {
			console.debug("[ConversationSync] Sync already in progress, skipping");
			return;
		}

		if (!this.plugin.opencodeClient?.isConnected() || !this.sessionManager) {
			return;
		}

		this.isSyncing = true;

		try {
			// Fetch sessions from server
			const serverSessions = await this.sessionManager.listSessions(true);
			const serverConversations = this.mapServerSessionsToConversations(serverSessions);

			// Merge with local conversations, handling concurrent modifications
			const mergedConversations = this.mergeConversationsWithTimestamps(
				this.conversations,
				serverConversations,
			);

			// Only update if there are actual changes
			if (this.hasConversationChanges(this.conversations, mergedConversations)) {
				this.setConversations(mergedConversations);
				await this.saveConversations();
				
				// Update UI without disrupting active conversation
				this.updateConversationSelector();
				
				console.debug(
					`[ConversationSync] Background sync completed. Total: ${this.conversations.length}`,
				);
			} else {
				console.debug("[ConversationSync] No changes detected during background sync");
			}
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "ConversationSync",
					function: "performBackgroundSync",
					operation: "Background sync",
				},
				ErrorSeverity.Warning,
			);
		} finally {
			this.isSyncing = false;
		}
	}

	/**
	 * Merge conversations with timestamp comparison for concurrent modifications
	 * Subtask 17.3: Handle concurrent modifications by comparing timestamps
	 */
	private mergeConversationsWithTimestamps(
		localConversations: Conversation[],
		serverConversations: Conversation[],
	): Conversation[] {
		const serverSessionMap = new Map<string, Conversation>();
		for (const serverConv of serverConversations) {
			if (serverConv.sessionId) {
				serverSessionMap.set(serverConv.sessionId, serverConv);
			}
		}

		const localSessionMap = new Map<string, Conversation>();
		const localConversationsWithoutSession: Conversation[] = [];

		for (const localConv of localConversations) {
			if (localConv.sessionId) {
				localSessionMap.set(localConv.sessionId, localConv);
			} else {
				localConversationsWithoutSession.push(localConv);
			}
		}

		const mergedConversations: Conversation[] = [];

		// Process all server sessions
		for (const [sessionId, serverConv] of serverSessionMap) {
			const localConv = localSessionMap.get(sessionId);

			if (localConv) {
				// Compare timestamps to handle concurrent modifications
				// If server is newer, update title and timestamp
				// If local is newer or equal, keep local version
				if (serverConv.updatedAt > localConv.updatedAt) {
					mergedConversations.push({
						...localConv,
						title: serverConv.title,
						updatedAt: serverConv.updatedAt,
					});
					console.debug(
						`[ConversationSync] Updated conversation from server (newer): ${sessionId}`,
					);
				} else {
					// Keep local version (it's newer or same)
					mergedConversations.push(localConv);
				}
			} else {
				// New session from server
				mergedConversations.push(serverConv);
				console.debug(
					`[ConversationSync] Added new session from server: ${sessionId}`,
				);
			}
		}

		// Remove local conversations that don't exist on server
		for (const [sessionId, localConv] of localSessionMap) {
			if (!serverSessionMap.has(sessionId)) {
				console.debug(
					`[ConversationSync] Removing local conversation with deleted server session: ${sessionId}`,
				);
			}
		}

		// Keep local conversations without sessionId
		mergedConversations.push(...localConversationsWithoutSession);

		// Sort by updatedAt (most recent first)
		mergedConversations.sort((a, b) => b.updatedAt - a.updatedAt);

		return mergedConversations;
	}

	/**
	 * Check if there are actual changes between conversation lists
	 */
	private hasConversationChanges(
		oldConversations: Conversation[],
		newConversations: Conversation[],
	): boolean {
		if (oldConversations.length !== newConversations.length) {
			return true;
		}

		// Check if any conversation has changed
		for (let i = 0; i < oldConversations.length; i++) {
			const oldConv = oldConversations[i];
			const newConv = newConversations[i];

			if (
				oldConv?.id !== newConv?.id ||
				oldConv?.title !== newConv?.title ||
				oldConv?.updatedAt !== newConv?.updatedAt ||
				oldConv?.sessionId !== newConv?.sessionId
			) {
				return true;
			}
		}

		return false;
	}
}
