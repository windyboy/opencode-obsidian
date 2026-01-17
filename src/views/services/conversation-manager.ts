import type { Conversation, Message, PluginData } from "../../types";
import type OpenCodeObsidianPlugin from "../../main";
import type { SessionManager } from "./session-manager";
import { Notice, type WorkspaceLeaf } from "obsidian";
import { ErrorSeverity } from "../../utils/error-handler";

export class ConversationManager {
	constructor(
		private plugin: OpenCodeObsidianPlugin,
		private getConversations: () => Conversation[],
		private getActiveConversationId: () => string | null,
		private setActiveConversationId: (id: string | null) => void,
		private setConversations: (convs: Conversation[]) => void,
		private saveCallback: () => Promise<void>,
		private updateConversationSelector: () => void,
		private updateMessages: () => void,
		private sessionManager?: SessionManager,
		private setIsLoading?: (loading: boolean) => void,
		private leaf?: WorkspaceLeaf,
	) {
		// Set up session not found callback to automatically remove sessions from local cache
		if (this.sessionManager) {
			this.sessionManager.setOnSessionNotFoundCallback((sessionId) => {
				this.handleSessionNotFound(sessionId);
			});
		}
	}

	private get conversations(): Conversation[] {
		return this.getConversations();
	}

	private get activeConversationId(): string | null {
		return this.getActiveConversationId();
	}

	async loadConversations(): Promise<void> {
		try {
			const saved = (await this.plugin.loadData()) as PluginData | null;

			console.debug(
				"[OpenCodeObsidianView] Loading conversations from local storage:",
				saved,
			);

			const conversations = saved?.conversations;
			if (
				conversations &&
				Array.isArray(conversations) &&
				conversations.length > 0
			) {
				this.setConversations(conversations);
				const loadedConvs = this.conversations;
				console.debug(
					`[OpenCodeObsidianView] Loaded ${loadedConvs.length} conversations from local storage`,
				);
				// Restore active conversation if it exists
				if (loadedConvs.length > 0) {
					// Try to restore the last active conversation, or use the first one
					const lastActiveId = saved?.activeConversationId;
					if (
						lastActiveId &&
						typeof lastActiveId === "string" &&
						loadedConvs.find((c) => c.id === lastActiveId)
					) {
						this.setActiveConversationId(lastActiveId);
						console.debug(
							`[OpenCodeObsidianView] Restored active conversation: ${lastActiveId}`,
						);
					} else {
						const firstConv = loadedConvs[0];
						if (firstConv) {
							this.setActiveConversationId(firstConv.id);
							console.debug(
								`[OpenCodeObsidianView] Set first conversation as active: ${firstConv.id}`,
							);
						}
					}
				}
			} else {
				console.debug(
					"[OpenCodeObsidianView] No conversations found in local storage",
				);
			}
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "OpenCodeObsidianView",
					function: "loadConversations",
					operation: "Loading conversations",
				},
				ErrorSeverity.Warning,
			);
			console.debug(
				"[OpenCodeObsidianView] Error loading conversations:",
				error,
			);
		}
	}

	async saveConversations(): Promise<void> {
		try {
			const currentData = (await this.plugin.loadData()) as PluginData | null;

			// Collect all sessionIds
			const sessionIds = this.conversations
				.map((c) => c.sessionId)
				.filter((id): id is string => id !== null && id !== undefined);

			const dataToSave: PluginData = {
				...(currentData || {}),
				conversations: this.conversations,
				activeConversationId: this.activeConversationId,
				sessionIds: sessionIds,
				lastSyncTimestamp: currentData?.lastSyncTimestamp,
			};
			await this.plugin.saveData(dataToSave);
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "OpenCodeObsidianView",
					function: "saveConversations",
					operation: "Saving conversations",
				},
				ErrorSeverity.Warning,
			);
		}
	}

	async createNewConversation(): Promise<void> {
		this.setIsLoading?.(true);
		this.updateConversationSelector();
		try {
			const conversation: Conversation = {
				id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
				title: "New Chat",
				messages: [],
				createdAt: Date.now(),
				updatedAt: Date.now(),
			};

			// Create session on server if SessionManager is available and client is connected
			if (this.sessionManager && this.plugin.opencodeClient?.isConnected()) {
				try {
					// Use retry method for better reliability
					const sessionId = await this.sessionManager.createSessionWithRetry(conversation.title);
					conversation.sessionId = sessionId;
					new Notice("New conversation created and synced with server");
				} catch (error) {
					this.plugin.errorHandler.handleError(
						error,
						{
							module: "ConversationManager",
							function: "createNewConversation",
							operation: "Creating server session",
						},
						ErrorSeverity.Warning,
					);
					// Show retry option to user
					new Notice("Failed to create server session. Conversation will be local-only.");
					// Continue with local-only conversation if server session creation fails
				}
			} else {
				new Notice("New conversation created");
			}

			const newConversations = [...this.conversations];
			newConversations.unshift(conversation);
			this.setConversations(newConversations);
			this.setActiveConversationId(conversation.id);
			await this.saveConversations();
			this.updateConversationSelector();
			this.updateMessages();
		} finally {
			this.setIsLoading?.(false);
			this.updateConversationSelector();
		}
	}

	async switchConversation(conversationId: string): Promise<void> {
		const conversation = this.conversations.find((c) => c.id === conversationId);
		if (!conversation) return;

		this.setIsLoading?.(true);
		this.updateConversationSelector();
		
		try {
			this.setActiveConversationId(conversationId);
			
			// Save last active session ID to workspace state
			if (conversation.sessionId && this.leaf) {
				this.leaf.setEphemeralState({ lastActiveSessionId: conversation.sessionId });
			}
			
			await this.saveConversations();
			this.updateConversationSelector();
			this.updateMessages();
		} finally {
			this.setIsLoading?.(false);
			this.updateConversationSelector();
		}
	}

	async renameConversation(
		conversationId: string,
		newTitle: string,
	): Promise<void> {
		this.setIsLoading?.(true);
		this.updateConversationSelector();
		try {
			const conversation = this.conversations.find(
				(c) => c.id === conversationId,
			);
			if (!conversation) return;

			const trimmedTitle = newTitle.trim();
			if (!trimmedTitle) {
				new Notice("Title cannot be empty");
				return;
			}

			const finalTitle = trimmedTitle.length > 100 ? `${trimmedTitle.substring(0, 97)}...` : trimmedTitle;

			conversation.title = finalTitle;
			conversation.updatedAt = Date.now();

			// Update session title on server if sessionId exists
			if (conversation.sessionId && this.sessionManager && this.plugin.opencodeClient?.isConnected()) {
				try {
					// Use retry method for better reliability
					await this.sessionManager.updateSessionTitleWithRetry(conversation.sessionId, finalTitle);
					new Notice("Conversation renamed and synced with server");
				} catch (error) {
					this.plugin.errorHandler.handleError(
						error,
						{
							module: "ConversationManager",
							function: "renameConversation",
							operation: "Updating server session title",
							metadata: { sessionId: conversation.sessionId, title: finalTitle },
						},
						ErrorSeverity.Warning,
					);
					new Notice("Failed to update session title on server. Local title updated.");
					// Continue with local update even if server update fails
				}
			} else {
				new Notice("Conversation renamed");
			}

			await this.saveConversations();
			this.updateConversationSelector();
		} finally {
			this.setIsLoading?.(false);
			this.updateConversationSelector();
		}
	}

	async deleteConversation(conversationId: string): Promise<void> {
		this.setIsLoading?.(true);
		this.updateConversationSelector();
		try {
			const convs = this.conversations;
			const convIndex = convs.findIndex(
				(c) => c.id === conversationId,
			);
			if (convIndex === -1) return;

			const conversation = convs[convIndex];
			if (!conversation) return;

			// Delete session on server if sessionId exists
			if (conversation.sessionId && this.sessionManager && this.plugin.opencodeClient?.isConnected()) {
				try {
					// Use retry method for better reliability
					await this.sessionManager.deleteSessionWithRetry(conversation.sessionId);
					new Notice("Conversation deleted and removed from server");
				} catch (error) {
					this.plugin.errorHandler.handleError(
						error,
						{
							module: "ConversationManager",
							function: "deleteConversation",
							operation: "Deleting server session",
							metadata: { sessionId: conversation.sessionId },
						},
						ErrorSeverity.Warning,
					);
					new Notice("Failed to delete session on server. Local conversation will be deleted.");
					// Continue with local deletion even if server deletion fails
				}
			} else {
				new Notice("Conversation deleted");
			}

			const wasActive = conversationId === this.activeConversationId;

			// Remove the conversation
			const newConversations = [...convs];
			newConversations.splice(convIndex, 1);
			this.setConversations(newConversations);

			// Handle active conversation
			if (wasActive) {
				if (newConversations.length > 0) {
					const newIndex = Math.min(
						convIndex,
						newConversations.length - 1,
					);
					this.setActiveConversationId(
						newConversations[newIndex]?.id ?? null,
					);
				} else {
					this.setActiveConversationId(null);
					await this.createNewConversation();
					return;
				}
			}

			await this.saveConversations();
			this.updateConversationSelector();
			this.updateMessages();
		} finally {
			this.setIsLoading?.(false);
			this.updateConversationSelector();
		}
	}

	/**
	 * Fork a conversation from a specific message point
	 * Creates a new conversation that branches from the parent conversation
	 * @param conversationId - ID of the conversation to fork
	 * @param messageId - Optional message ID to fork from
	 * @returns Promise<string> - ID of the newly created forked conversation
	 */
	async forkConversation(
		conversationId: string,
		messageId?: string,
	): Promise<string> {
		const parentConversation = this.conversations.find(
			(c) => c.id === conversationId,
		);
		if (!parentConversation) {
			throw new Error(`Conversation not found: ${conversationId}`);
		}

		if (!parentConversation.sessionId) {
			throw new Error(
				`Cannot fork conversation without sessionId: ${conversationId}`,
			);
		}

		if (!this.sessionManager) {
			throw new Error("SessionManager not available");
		}

		if (!this.plugin.opencodeClient?.isConnected()) {
			throw new Error("OpenCode client not connected");
		}

		this.setIsLoading?.(true);
		this.updateConversationSelector();

		try {
			// Generate title for forked session
			const forkTitle = `Fork of ${parentConversation.title}`;

			// Fork session on server
			const forkedSessionId = await this.sessionManager.forkSessionWithRetry(
				parentConversation.sessionId,
				messageId,
				forkTitle,
			);

			// Create new local conversation
			const forkedConversation: Conversation = {
				id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
				title: forkTitle,
				messages: [], // Will be loaded from server
				createdAt: Date.now(),
				updatedAt: Date.now(),
				sessionId: forkedSessionId,
			};

			// Add to conversations list
			const newConversations = [...this.conversations];
			newConversations.unshift(forkedConversation);
			this.setConversations(newConversations);

			// Switch to forked conversation
			this.setActiveConversationId(forkedConversation.id);

			// Save conversations
			await this.saveConversations();

			// Load messages from server
			await this.loadSessionMessages(forkedConversation.id);

			// Update UI
			this.updateConversationSelector();
			this.updateMessages();

			new Notice("Session forked successfully");

			return forkedConversation.id;
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "ConversationManager",
					function: "forkConversation",
					operation: "Forking conversation",
					metadata: { conversationId, messageId },
				},
				ErrorSeverity.Error,
			);
			new Notice("Failed to fork session");
			throw error;
		} finally {
			this.setIsLoading?.(false);
			this.updateConversationSelector();
		}
	}

	getActiveConversation(): Conversation | null {
		return (
			this.conversations.find(
				(c) => c.id === this.activeConversationId,
			) || null
		);
	}

	async generateConversationTitle(conversationId: string): Promise<void> {
		const conversation = this.conversations.find(
			(c) => c.id === conversationId,
		);
		if (!conversation || conversation.messages.length < 2) {
			return;
		}

		// Skip if title is already generated (not default)
		if (
			conversation.title !== "New Chat" &&
			!conversation.title.startsWith("Chat ")
		) {
			return;
		}

		// Skip if no OpenCode Server client
		if (!this.plugin.opencodeClient?.isConnected()) {
			this.generateTitleFromFirstMessage(conversation);
			return;
		}

		// For now, use simple extraction from first user message
		this.generateTitleFromFirstMessage(conversation);
	}

	generateTitleFromFirstMessage(conversation: Conversation): void {
		const firstUserMessage = conversation.messages.find((m) => m.role === "user");
		if (!firstUserMessage) return;

		const firstLine = firstUserMessage.content.trim().split("\n")[0] ?? "";
		const fallbackTitle = firstLine.substring(0, 50).trim();
		if (!fallbackTitle) return;

		conversation.title = fallbackTitle.length > 50 ? `${fallbackTitle.substring(0, 47)}...` : fallbackTitle;
		void this.saveConversations();
		this.updateConversationSelector();
	}

	findConversationBySessionId(sessionId: string): Conversation | null {
		return (
			this.conversations.find((c) => c.sessionId === sessionId) || null
		);
	}

	/**
	 * Load message history from server for a conversation with a sessionId
	 * Populates the conversation's messages array with server data
	 */
	async loadSessionMessages(conversationId: string): Promise<void> {
		const conversation = this.conversations.find(
			(c) => c.id === conversationId,
		);
		if (!conversation) {
			throw new Error(`Conversation not found: ${conversationId}`);
		}

		if (!conversation.sessionId) {
			throw new Error(`Conversation has no sessionId: ${conversationId}`);
		}

		if (!this.sessionManager) {
			throw new Error("SessionManager not available");
		}

		if (!this.plugin.opencodeClient?.isConnected()) {
			throw new Error("OpenCode client not connected");
		}

		try {
			// Use retry method for better reliability
			const messages = await this.sessionManager.loadSessionMessagesWithRetry(conversation.sessionId);
			conversation.messages = messages;
			conversation.updatedAt = Date.now();
			await this.saveConversations();
			this.updateMessages();
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "ConversationManager",
					function: "loadSessionMessages",
					operation: "Loading session messages from server",
					metadata: { conversationId, sessionId: conversation.sessionId },
				},
				ErrorSeverity.Error,
			);
			throw error;
		}
	}

	/**
	 * Handle session not found (404) by removing sessionId from conversation
	 * This is called automatically when a 404 error is encountered
	 */
	private async handleSessionNotFound(sessionId: string): Promise<void> {
		const conversation = this.conversations.find((c) => c.sessionId === sessionId);
		if (!conversation) {
			return;
		}

		console.debug(`[ConversationManager] Removing sessionId ${sessionId} from conversation ${conversation.id} due to 404 error`);
		
		// Remove sessionId from conversation (convert to local-only)
		conversation.sessionId = undefined;
		conversation.updatedAt = Date.now();
		
		await this.saveConversations();
		this.updateConversationSelector();
		
		// Show notice to user
		new Notice(`Session "${conversation.title}" was not found on server. Converted to local-only conversation.`);
	}
}
