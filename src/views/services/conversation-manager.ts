import type { Conversation, Message } from "../../types";
import type OpenCodeObsidianPlugin from "../../main";
import { Notice } from "obsidian";
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
	) {}

	private get conversations(): Conversation[] {
		return this.getConversations();
	}

	private get activeConversationId(): string | null {
		return this.getActiveConversationId();
	}

	async loadConversations(): Promise<void> {
		try {
			const saved = (await this.plugin.loadData()) as {
				conversations?: Conversation[];
				activeConversationId?: string;
				sessionIds?: string[];
			} | null;

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
			const currentData = (await this.plugin.loadData()) as Record<
				string,
				unknown
			> | null;

			// 收集所有 sessionId
			const sessionIds = this.conversations
				.map((c) => c.sessionId)
				.filter((id): id is string => id !== null && id !== undefined);

			const dataToSave = {
				...(currentData || {}),
				conversations: this.conversations,
				activeConversationId: this.activeConversationId,
				sessionIds: sessionIds,
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
		const conversation: Conversation = {
			id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
			title: "New Chat",
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		const newConversations = [...this.conversations];
		newConversations.unshift(conversation);
		this.setConversations(newConversations);
		this.setActiveConversationId(conversation.id);
		await this.saveConversations();
		this.updateConversationSelector();
		this.updateMessages();
	}

	async switchConversation(conversationId: string): Promise<void> {
		this.setActiveConversationId(conversationId);
		await this.saveConversations();
		this.updateConversationSelector();
		this.updateMessages();
	}

	async renameConversation(
		conversationId: string,
		newTitle: string,
	): Promise<void> {
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

		// If server supports updating session title, sync it
		if (conversation.sessionId && this.plugin.opencodeClient?.isConnected()) {
			// TODO: If OpenCode Server supports updating session title, do it here
		}

		await this.saveConversations();
		this.updateConversationSelector();
	}

	async deleteConversation(conversationId: string): Promise<void> {
		const convs = this.conversations;
		const convIndex = convs.findIndex(
			(c) => c.id === conversationId,
		);
		if (convIndex === -1) return;

		const conversation = convs[convIndex];
		if (!conversation) return;

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
}
