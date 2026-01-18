import {
	ItemView,
	WorkspaceLeaf,
	Notice,
} from "obsidian";
import type OpenCodeObsidianPlugin from "../main";
import { ErrorSeverity } from "../utils/error-handler";
import { debounceAsync } from "../utils/debounce-throttle";
import { parseSlashCommand, sanitizeFilename, createFilenameSafeTimestamp } from "../utils/data-helpers";
import { empty, setAttribute, setStyles } from "../utils/dom-helpers";
import type {
	Conversation,
	Message,
	ToolUse,
	ToolResult,
	PluginData,
} from "../types";
import { HeaderComponent } from "./components/header";
import { ConversationSelectorComponent } from "./components/conversation-selector";
import { MessageListComponent } from "./components/message-list";
import { MessageRendererComponent } from "./components/message-renderer";
import { InputAreaComponent } from "./components/input-area";
import { ConfirmationModal } from "./modals/confirmation-modal";
import { AttachmentModal } from "./modals/attachment-modal";
import { DiffViewerModal } from "./modals/diff-viewer-modal";
import { SearchPanel } from "./components/search-panel";
import { ConversationManager } from "./services/conversation-manager";
import { MessageSender } from "./services/message-sender";
import { ConversationSync } from "./services/conversation-sync";
import { SessionManager } from "./services/session-manager";
import { TodoListComponent } from "../todo/todo-list-component";

export const VIEW_TYPE_OPENCODE_OBSIDIAN = "opencode-obsidian-view";

interface UsageInfo {
	model: string;
	inputTokens: number;
	outputTokens?: number;
}

interface CommandSuggestion {
	name: string;
	description?: string;
}

export class OpenCodeObsidianView extends ItemView {
	plugin: OpenCodeObsidianPlugin;
	private conversations: Conversation[] = [];
	private activeConversationId: string | null = null;
	private isStreaming = false;
	private isConversationOperationLoading = false;
	private currentAbortController: AbortController | null = null;
	// Health status is now managed by connection handler
	// private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
	private lastHealthCheckResult: boolean | null = null;
	private eventUnsubscribers: Array<() => void> = [];
	private commandSuggestions: CommandSuggestion[] = [];
	private commandSuggestionsLoading = false;
	private scrollPositions: Record<string, number> = {};
	private debouncedSaveScrollPosition = debounceAsync(async (conversationId: string, scrollTop: number) => {
		await this.saveScrollPosition(conversationId, scrollTop);
	}, 500);
	// Todo list related
	private isTodoListVisible: boolean = false;
	private todoListContainer: HTMLElement | null = null;

	// Components
	private headerComponent: HeaderComponent;
	private conversationSelectorComponent: ConversationSelectorComponent;
	private messageListComponent: MessageListComponent;
	private messageRendererComponent: MessageRendererComponent;
	private inputAreaComponent: InputAreaComponent;
	private searchPanel: SearchPanel | null = null;
	private searchPanelContainer: HTMLElement | null = null;
	private isSearchPanelVisible = false;

	// Services
	private conversationManager: ConversationManager;
	private messageSender: MessageSender;
	private conversationSync: ConversationSync;
	private sessionManager: SessionManager | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: OpenCodeObsidianPlugin) {
		super(leaf);
		this.plugin = plugin;

		// Initialize message renderer first (needed by message list)
		this.messageRendererComponent = new MessageRendererComponent(
			this.plugin,
			this,
		);

		// Initialize services first (needed by components)
		this.conversationManager = new ConversationManager(
			this.plugin,
			() => this.conversations,
			() => this.activeConversationId,
			(id) => {
				this.activeConversationId = id;
			},
			(convs) => {
				this.conversations = convs;
			},
			() => this.conversationManager.saveConversations(),
			() => this.updateConversationSelector(),
			() => this.updateMessages(),
			undefined, // SessionManager will be set after initialization
			(loading) => {
				this.isConversationOperationLoading = loading;
			},
			this.leaf, // Pass leaf for workspace state management
		);

		// Initialize components
		this.headerComponent = new HeaderComponent(
			this.plugin,
			() => this.lastHealthCheckResult,
			() => this.performHealthCheck(),
			() => this.conversationManager.createNewConversation(),
		);

		this.messageListComponent = new MessageListComponent(
			this.messageRendererComponent,
			() => this.conversationManager.getActiveConversation(),
			(message) => this.messageSender.regenerateResponse(message),
			(conversationId) => this.scrollPositions[conversationId],
			() => this.isConversationOperationLoading,
			(message) => this.revertToMessage(message),
			() => this.unrevertSession(),
			(conversationId, messageId) => this.forkConversation(conversationId, messageId),
		);

		this.conversationSelectorComponent = new ConversationSelectorComponent(
			() => this.conversations,
			() => this.activeConversationId,
			this.app,
			(id) => this.conversationManager.switchConversation(id),
			(id, title) => this.conversationManager.renameConversation(id, title),
			(id) => this.conversationManager.deleteConversation(id),
			() => this.conversationManager.createNewConversation(),
			(id) => this.exportConversation(id),
			() => this.isConversationOperationLoading,
			() => this.syncConversationsFromServer(),
			(sessionId) => this.viewSessionDiff(sessionId),
			(id) => this.forkConversation(id),
		);

		// Initialize message sender (needed by input area)
		this.messageSender = new MessageSender(
			this.plugin,
			this.app,
			() => this.conversationManager.getActiveConversation(),
			() => this.conversationManager.createNewConversation(),
			(content) => this.parseSlashCommand(content),
			(value) => {
				this.isStreaming = value;
			},
			(controller) => {
				this.currentAbortController = controller;
			},
			() => this.updateMessages(),
			(value) => this.updateStreamingStatus(value),
			() => this.conversationManager.saveConversations(),
			(id) => this.conversationManager.generateConversationTitle(id),
			(content) => this.showThinkingIndicator(content),
			(content) => this.showBlockedIndicator(content),
			(usage) => this.showUsageInfo(usage),
			(toolUse) => this.showToolUse(toolUse),
			(toolResult) => this.showToolResult(toolResult),
			undefined, // SessionManager will be set after initialization
		);

		// Initialize input area component (needs messageSender)
		this.inputAreaComponent = new InputAreaComponent(
			this.plugin,
			this.app,
			(content) => this.messageSender.sendMessage(content),
			() => this.messageSender.stopStreaming(),
			() => this.showAttachmentModal(),
			() => this.ensureCommandSuggestions(),
			(content) => this.parseSlashCommand(content),
			(value) => {
				this.isStreaming = value;
			},
		);

		// Initialize SessionManager if client is available
		if (this.plugin.opencodeClient) {
			this.sessionManager = new SessionManager(
				this.plugin.opencodeClient,
				this.plugin.errorHandler,
			);
		}

		// Update ConversationManager with SessionManager
		if (this.sessionManager) {
			// We need to add a setter method to ConversationManager
			// For now, we'll recreate it with the SessionManager
			this.conversationManager = new ConversationManager(
				this.plugin,
				() => this.conversations,
				() => this.activeConversationId,
				(id) => {
					this.activeConversationId = id;
				},
				(convs) => {
					this.conversations = convs;
				},
				() => this.conversationManager.saveConversations(),
				() => this.updateConversationSelector(),
				() => this.updateMessages(),
				this.sessionManager,
				(loading) => {
					this.isConversationOperationLoading = loading;
				},
				this.leaf, // Pass leaf for workspace state management
			);

			// Recreate MessageSender with SessionManager
			this.messageSender = new MessageSender(
				this.plugin,
				this.app,
				() => this.conversationManager.getActiveConversation(),
				() => this.conversationManager.createNewConversation(),
				(content) => this.parseSlashCommand(content),
				(value) => {
					this.isStreaming = value;
				},
				(controller) => {
					this.currentAbortController = controller;
				},
				() => this.updateMessages(),
				(value) => this.updateStreamingStatus(value),
				() => this.conversationManager.saveConversations(),
				(id) => this.conversationManager.generateConversationTitle(id),
				(content) => this.showThinkingIndicator(content),
				(content) => this.showBlockedIndicator(content),
				(usage) => this.showUsageInfo(usage),
				(toolUse) => this.showToolUse(toolUse),
				(toolResult) => this.showToolResult(toolResult),
				this.sessionManager,
			);
		}

		this.conversationSync = new ConversationSync(
			this.plugin,
			this.sessionManager,
			() => this.conversations,
			() => this.activeConversationId,
			(id) => {
				this.activeConversationId = id;
			},
			(convs) => {
				this.conversations = convs;
			},
			() => this.conversationManager.saveConversations(),
			() => this.updateConversationSelector(),
			() => this.updateMessages(),
			() => this.conversationManager.createNewConversation(),
			(sessionId) => this.conversationManager.findConversationBySessionId(sessionId),
		);
	}

	getViewType() {
		return VIEW_TYPE_OPENCODE_OBSIDIAN;
	}

	getDisplayText() {
		return "Opencode";
	}

	getIcon() {
		return "bot";
	}

	async onOpen() {
		const container = this.getContainer();
		if (!container) return;
		empty(container);
		container.addClass("opencode-obsidian-view");

		this.renderView();
		await this.conversationManager.loadConversations();
		
		// Load scroll positions from plugin data
		await this.loadScrollPositions();

		// Restore last active session from workspace state
		let sessionRestored = false;
		const ephemeralState = this.leaf.getEphemeralState() as { lastActiveSessionId?: string } | undefined;
		if (ephemeralState?.lastActiveSessionId && this.sessionManager) {
			const conversation = this.conversationManager.findConversationBySessionId(ephemeralState.lastActiveSessionId);
			if (conversation) {
				await this.conversationManager.switchConversation(conversation.id);
				sessionRestored = true;
			}
		}

		// If session restoration failed or no session was saved, use existing fallback logic
		if (!sessionRestored && !this.activeConversationId && this.conversations.length > 0) {
			// Fallback to first conversation
			const firstConv = this.conversations[0];
			if (firstConv) {
				await this.conversationManager.switchConversation(firstConv.id);
			}
		}

		this.updateConversationSelector();
		this.updateMessages();
		
		// Attach scroll listener to message container
		this.attachScrollListener();

		this.registerEventBusCallbacks();

		// Ensure connection to OpenCode Server
		try {
			if (this.plugin.connectionManager) {
				await this.plugin.connectionManager.ensureConnected(5000);
				console.debug("[OpenCodeObsidianView] Connected to OpenCode Server");
			} else if (this.plugin.opencodeClient && !this.plugin.opencodeClient.isConnected()) {
				await this.plugin.opencodeClient.connect();
			}
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "OpenCodeObsidianView",
					function: "onOpen",
					operation: "Connecting to OpenCode Server",
				},
				ErrorSeverity.Warning,
			);
			if (this.plugin.connectionManager) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				new Notice(`Connection failed: ${errorMessage}`);
			}
		}

		if (this.plugin.opencodeClient) {
			// Perform initial health check
			await this.performHealthCheck();
			
			if (this.plugin.opencodeClient.isConnected() && this.lastHealthCheckResult) {
				await this.conversationSync.syncConversationsFromServer();
				// Start periodic sync after initial sync
				this.conversationSync.startPeriodicSync();
			}
			
			// Removed periodic health check - health status is now managed by connection handler
			// Connection state changes will trigger UI updates automatically
		}
		
		// Create new conversation if none exist
		if (this.conversations.length === 0) {
			await this.conversationManager.createNewConversation();
		}
	}

	async onClose() {
		if (this.currentAbortController) {
			this.currentAbortController.abort();
		}

		for (const unsub of this.eventUnsubscribers) {
			try {
				unsub();
			} catch {
				// ignore
			}
		}
		this.eventUnsubscribers = [];

		// Periodic health check removed - no need to stop it
		// this.stopPeriodicHealthCheck();
		this.conversationSync.stopPeriodicSync();
	}

	private renderView() {
		const container = this.getContainer();
		if (!container) return;
		
		empty(container);
		this.headerComponent.render(container.createDiv("opencode-obsidian-header"));
		
		// Create view toggle button
		const viewToggle = container.createEl("button", {
			cls: "opencode-obsidian-view-toggle",
			text: this.isTodoListVisible ? "Chat" : "Todo List",
			attr: { title: this.isTodoListVisible ? "Switch to chat view" : "Switch to todo list view" }
		});
		viewToggle.addEventListener("click", () => this.toggleView());
		
		// Create search panel container
		this.searchPanelContainer = container.createDiv("opencode-obsidian-search-panel");
		if (this.isSearchPanelVisible && this.plugin.opencodeClient && !this.isTodoListVisible) {
			this.searchPanel = new SearchPanel(this.plugin, this.searchPanelContainer);
		} else {
			this.searchPanelContainer.hide();
		}
		
		// Render either chat view or todo list view
		if (this.isTodoListVisible) {
			// Render todo list
			if (this.plugin.todoManager) {
				const todoListComponent = new TodoListComponent(this.plugin, this.plugin.todoManager);
				todoListComponent.render(container.createDiv("opencode-obsidian-todo-view"));
			} else {
				const errorDiv = container.createDiv("opencode-obsidian-error");
				errorDiv.textContent = "Todo manager not initialized. Please try reloading the plugin.";
			}
		} else {
			// Render chat view
			this.conversationSelectorComponent.render(container.createDiv("opencode-obsidian-conversation-selector"));
			this.messageListComponent.render(container.createDiv("opencode-obsidian-messages"));
			this.inputAreaComponent.render(container.createDiv("opencode-obsidian-input"));
		}
	}

	private getContainer(): HTMLElement | null {
		const contentEl = this.containerEl.children[1] as HTMLElement | undefined;
		return contentEl ?? this.containerEl;
	}

	private updateHeader(): void {
		const header = this.getContainer()?.querySelector(".opencode-obsidian-header") as HTMLElement;
		if (header) this.headerComponent.render(header);
	}

	private updateConversationSelector(): void {
		const selector = this.getContainer()?.querySelector(".opencode-obsidian-conversation-selector") as HTMLElement;
		if (selector) this.conversationSelectorComponent.render(selector);
	}

	private updateMessages(): void {
		const messages = this.getContainer()?.querySelector(".opencode-obsidian-messages") as HTMLElement;
		if (messages) this.messageListComponent.render(messages);
	}

	/**
	 * Show the search panel
	 */
	public openSearchPanel(): void {
		if (!this.searchPanelContainer || !this.plugin.opencodeClient) {
			return;
		}

		this.isSearchPanelVisible = true;
		this.searchPanelContainer.show();
		this.searchPanel = new SearchPanel(this.plugin, this.searchPanelContainer);
		this.searchPanel.focus();
	}

	/**
	 * Hide the search panel
	 */
	public closeSearchPanel(): void {
		if (!this.searchPanelContainer) {
			return;
		}

		this.isSearchPanelVisible = false;
		this.searchPanelContainer.hide();
		if (this.searchPanel) {
			this.searchPanel.destroy();
			this.searchPanel = null;
		}
	}

	/**
	 * Toggle the search panel visibility
	 */
	public toggleSearchPanel(): void {
		if (this.isSearchPanelVisible) {
			this.closeSearchPanel();
		} else {
			this.openSearchPanel();
		}
	}

	private updateStreamingStatus(isStreaming: boolean): void {
		this.inputAreaComponent.updateStreamingStatus(isStreaming);
	}

	private async performHealthCheck(): Promise<void> {
		if (!this.plugin.opencodeClient) {
			new Notice("OpenCode Server client not initialized");
			return;
		}

		try {
			const healthResult = await this.plugin.opencodeClient.healthCheck();
			this.lastHealthCheckResult = healthResult.isHealthy;
			new Notice(healthResult.isHealthy ? "Server is healthy" : `Server health check failed: ${healthResult.error || 'Unknown error'}`);
		} catch (error) {
			this.lastHealthCheckResult = false;
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`Health check failed: ${errorMessage}`);
		} finally {
			this.updateHeader();
		}
	}

	private async syncConversationsFromServer(): Promise<void> {
		if (!this.plugin.opencodeClient?.isConnected()) {
			new Notice("Not connected to server");
			return;
		}

		this.isConversationOperationLoading = true;
		this.updateConversationSelector();

		try {
			await this.conversationSync.syncConversationsFromServer();
			new Notice("Conversations synced from server");
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`Sync failed: ${errorMessage}`);
		} finally {
			this.isConversationOperationLoading = false;
			this.updateConversationSelector();
		}
	}

	/**
	 * Show or hide the todo list
	 */
	public showTodoList(): void {
		this.isTodoListVisible = !this.isTodoListVisible;
		this.renderView();
	}

	/**
	 * Toggle between chat and todo list views
	 */
	private toggleView(): void {
		this.isTodoListVisible = !this.isTodoListVisible;
		this.renderView();
	}

	private async revertToMessage(message: Message): Promise<void> {
		if (!this.sessionManager) {
			new Notice("Session manager not available");
			return;
		}

		const activeConv = this.conversationManager.getActiveConversation();
		if (!activeConv || !activeConv.sessionId) {
			new Notice("No active session to revert");
			return;
		}

		try {
			await this.sessionManager.revertSession(activeConv.sessionId, message.id);
			
			// Mark messages after the revert point as reverted
			const messageIndex = activeConv.messages.findIndex(m => m.id === message.id);
			if (messageIndex !== -1) {
				for (let i = messageIndex + 1; i < activeConv.messages.length; i++) {
					const msg = activeConv.messages[i];
					if (msg) {
						msg.isReverted = true;
					}
				}
			}
			
			// Save the updated conversation
			await this.conversationManager.saveConversations();
			this.updateMessages();
			
			new Notice("Session reverted successfully");
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to revert session: ${errorMessage}`);
		}
	}

	private async unrevertSession(): Promise<void> {
		if (!this.sessionManager) {
			new Notice("Session manager not available");
			return;
		}

		const activeConv = this.conversationManager.getActiveConversation();
		if (!activeConv || !activeConv.sessionId) {
			new Notice("No active session to unrevert");
			return;
		}

		try {
			await this.sessionManager.unrevertSession(activeConv.sessionId);
			
			// Mark all messages as not reverted
			activeConv.messages.forEach(m => {
				m.isReverted = false;
			});
			
			// Save the updated conversation
			await this.conversationManager.saveConversations();
			this.updateMessages();
			
			new Notice("Session unreverted successfully");
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to unrevert session: ${errorMessage}`);
		}
	}

	/**
	 * Fork a conversation from a specific message point
	 * @param conversationId - ID of the conversation to fork
	 * @param messageId - Optional message ID to fork from
	 */
	async forkConversation(
		conversationId: string,
		messageId?: string,
	): Promise<void> {
		if (!this.conversationManager) {
			new Notice("Conversation manager not available");
			return;
		}

		try {
			await this.conversationManager.forkConversation(
				conversationId,
				messageId,
			);
		} catch (error) {
			// Error already logged by ConversationManager
			// Just show user-friendly notice
			new Notice("Failed to fork session. Please try again.");
		}
	}

	// Periodic health check removed - health status is now managed by connection handler
	// private startPeriodicHealthCheck(): void {
	//	this.stopPeriodicHealthCheck();

	//	this.healthCheckInterval = setInterval(() => {
	//		if (this.plugin.opencodeClient?.isConnected()) {
	//			void this.performHealthCheck();
	//		}
	//	}, 30000);
	// }

	// private stopPeriodicHealthCheck(): void {
	//	if (this.healthCheckInterval) {
	//		clearInterval(this.healthCheckInterval);
	//		this.healthCheckInterval = null;
	//	}
	// }

	private async ensureCommandSuggestions(): Promise<void> {
		if (!this.plugin.opencodeClient) {
			return;
		}
		if (this.commandSuggestionsLoading || this.commandSuggestions.length > 0) {
			return;
		}
		this.commandSuggestionsLoading = true;
		try {
			this.commandSuggestions = await this.plugin.opencodeClient.listCommands();
			this.inputAreaComponent.setCommandSuggestions(this.commandSuggestions);
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "OpenCodeObsidianView",
					function: "ensureCommandSuggestions",
					operation: "Loading command suggestions",
				},
				ErrorSeverity.Warning,
			);
		} finally {
			this.commandSuggestionsLoading = false;
			this.inputAreaComponent.setCommandSuggestionsLoading(false);
		}
	}

	private parseSlashCommand(content: string): { command: string; args: string } | null {
		return parseSlashCommand(content);
	}

	private findTargetConversation(sessionId: string, requireMatch = false): Conversation | null {
		const targetConv =
			this.conversationManager.findConversationBySessionId(sessionId) ||
			this.conversationManager.getActiveConversation();
		
		if (!targetConv) return null;
		
		if (requireMatch && targetConv.sessionId !== sessionId) {
			console.debug(
				"[OpenCodeObsidianView] Ignoring event for mismatched sessionId:",
				sessionId,
			);
			return null;
		}
		
		return targetConv;
	}

	private registerEventBusCallbacks(): void {
		for (const unsub of this.eventUnsubscribers) {
			try {
				unsub();
			} catch {
				// ignore
			}
		}
		this.eventUnsubscribers = [];

		// Subscribe to health status changes from connection handler
		if (this.plugin.opencodeClient) {
			this.eventUnsubscribers.push(
				this.plugin.opencodeClient.onHealthStatusChange((isHealthy) => {
					this.lastHealthCheckResult = isHealthy;
					this.updateHeader();
					console.debug("[OpenCodeObsidianView] Health status updated:", isHealthy);
				})
			);
		}

		const bus = this.plugin.sessionEventBus;

		this.eventUnsubscribers.push(
			bus.onStreamToken(({ sessionId, token, done }) => {
				const targetConv = this.findTargetConversation(sessionId, true);
				if (!targetConv) return;

				const lastMessage =
					targetConv.messages[targetConv.messages.length - 1];
				if (lastMessage && lastMessage.role === "assistant") {
					const currentContent = lastMessage.content;

					if (!currentContent && targetConv.messages.length >= 2) {
						const lastUserMessage = targetConv.messages[targetConv.messages.length - 2];
						if (lastUserMessage && lastUserMessage.role === "user" && token === lastUserMessage.content) {
							return;
						}
					}

					if (token === currentContent) {
						return;
					}

					if (currentContent && token.startsWith(currentContent)) {
						lastMessage.content = token;
					} else {
						lastMessage.content += token;
					}

					this.updateMessageContent(lastMessage.id, lastMessage.content);
				}

				if (done) {
					this.updateMessages();

					const activeConv = this.conversationManager.getActiveConversation();
					if (activeConv && activeConv.sessionId === sessionId) {
						this.isStreaming = false;
						this.updateStreamingStatus(false);
					}
					targetConv.updatedAt = Date.now();
					void this.conversationManager.saveConversations();
				}
			}),
		);

		this.eventUnsubscribers.push(
			bus.onStreamThinking(({ sessionId, content }) => {
				const targetConv = this.findTargetConversation(sessionId, true);
				if (!targetConv) return;

				const lastMessage =
					targetConv.messages[targetConv.messages.length - 1];
				if (lastMessage && lastMessage.role === "assistant") {
					void this.messageSender.handleResponseChunk(
						{ type: "thinking", content },
						lastMessage,
					);
				}
			}),
		);

		this.eventUnsubscribers.push(
			bus.onError(({ error }) => {
				const errorWithSessionId = error as { sessionId?: string };
				const targetConv = errorWithSessionId.sessionId
					? this.findTargetConversation(errorWithSessionId.sessionId)
					: this.conversationManager.getActiveConversation();
				
				if (!targetConv) return;

				const lastMessage =
					targetConv.messages[targetConv.messages.length - 1];
				if (lastMessage && lastMessage.role === "assistant") {
					lastMessage.content = `Error: ${error.message}`;
					this.updateMessages();
				}

				new Notice(error.message);
				const activeConv = this.conversationManager.getActiveConversation();
				if (activeConv === targetConv) {
					this.isStreaming = false;
					this.updateStreamingStatus(false);
				}
			}),
		);

		this.eventUnsubscribers.push(
			bus.onProgressUpdate(({ sessionId, progress }) => {
				const targetConv = this.findTargetConversation(sessionId, true);
				if (!targetConv) return;

				const lastMessage =
					targetConv.messages[targetConv.messages.length - 1];
				if (lastMessage && lastMessage.role === "assistant") {
					void this.messageSender.handleResponseChunk(
						{
							type: "progress",
							message: progress.message,
							stage: progress.stage,
							progress: progress.progress,
						},
						lastMessage,
					);
				}
			}),
		);

		this.eventUnsubscribers.push(
			bus.onSessionEnd(({ sessionId, reason }) => {
				const targetConv = this.conversationManager.findConversationBySessionId(sessionId);
				if (targetConv && targetConv.sessionId === sessionId) {
					targetConv.sessionId = null;
				}

				const activeConv = this.conversationManager.getActiveConversation();
				if (activeConv && activeConv.sessionId === sessionId) {
					this.isStreaming = false;
					this.updateStreamingStatus(false);
				}

				if (reason === "error") {
					new Notice("Session ended due to error");
				}
			}),
		);
	}

	private updateMessageContent(messageId: string, content: string) {
		const messageEl = this.containerEl.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement;
		const contentEl = messageEl?.querySelector(".opencode-obsidian-message-content") as HTMLElement;
		
		if (!contentEl) {
			this.updateMessages();
			return;
		}

		empty(contentEl);
		this.messageRendererComponent.renderMessageContent(contentEl, content);

		const messagesContainer = this.containerEl.querySelector(".opencode-obsidian-messages") as HTMLElement;
		if (messagesContainer) {
			requestAnimationFrame(() => {
				messagesContainer.scrollTop = messagesContainer.scrollHeight;
			});
		}
	}

	private async exportConversation(conversationId: string): Promise<void> {
		const conversation = this.conversations.find(
			(c) => c.id === conversationId,
		);
		if (!conversation) {
			new Notice("Conversation not found");
			return;
		}

		try {
			const lines: string[] = [];

			lines.push(`# ${conversation.title}`);
			lines.push("");
			lines.push(`**Created:** ${new Date(conversation.createdAt).toLocaleString()}`);
			lines.push(`**Last Updated:** ${new Date(conversation.updatedAt).toLocaleString()}`);
			if (conversation.sessionId) {
				lines.push(`**Session ID:** ${conversation.sessionId}`);
			}
			lines.push("");
			lines.push("---");
			lines.push("");

			lines.push("## Messages");
			lines.push("");

			for (const message of conversation.messages) {
				const timestamp = new Date(message.timestamp).toLocaleString();
				lines.push(`### ${message.role === "user" ? "User" : "Assistant"} - ${timestamp}`);
				lines.push("");
				lines.push(message.content);
				lines.push("");

				if (message.images && message.images.length > 0) {
					for (const img of message.images) {
						lines.push(`![${img.name || "Image"}](${img.data.substring(0, 50)}...)`);
						lines.push("");
					}
				}
			}

			const markdownContent = lines.join("\n");

			const sanitizedTitle = sanitizeFilename(conversation.title);
			const timestamp = createFilenameSafeTimestamp();
			const filename = `${sanitizedTitle}-${timestamp}.md`;

			const exportPath = `Exports/${filename}`;
			await this.app.vault.createFolder("Exports").catch(() => {
				// Folder might already exist
			});

			await this.app.vault.create(exportPath, markdownContent);

			new Notice(`Conversation exported to ${exportPath}`);
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "OpenCodeObsidianView",
					function: "exportConversation",
					operation: "Exporting conversation",
				},
				ErrorSeverity.Warning,
			);
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			new Notice(`Failed to export conversation: ${errorMessage}`);
		}
	}

	/**
	 * View session diff (file changes) for a session
	 */
	private async viewSessionDiff(sessionId: string): Promise<void> {
		try {
			// Show loading notice
			const loadingNotice = new Notice("Loading session changes...", 0);

			// Fetch session diff from server
			const sessionDiff = await this.plugin.opencodeClient?.getSessionDiff(sessionId);

			// Close loading notice
			loadingNotice.hide();

			// Check if we got a valid diff
			if (!sessionDiff) {
				new Notice("Failed to load session changes: Client not available");
				return;
			}

			// Open diff viewer modal
			new DiffViewerModal(this.app, sessionDiff).open();
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "OpenCodeObsidianView",
					function: "viewSessionDiff",
					operation: "Viewing session diff",
					metadata: { sessionId },
				},
				ErrorSeverity.Warning,
			);
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			new Notice(`Failed to load session changes: ${errorMessage}`);
		}
	}

	private showAttachmentModal() {
		new AttachmentModal(this.app, (file: File) => {
			void (async () => {
				try {
					const activeConv = this.conversationManager.getActiveConversation();
					if (!activeConv) {
						await this.conversationManager.createNewConversation();
					}

					const attachmentsFolder = "05_Attachments";
					const timestamp = Date.now();
					const fileName = `${timestamp}-${file.name}`;
					const filePath = `${attachmentsFolder}/${fileName}`;

					const folderExists =
						await this.app.vault.adapter.exists(attachmentsFolder);
					if (!folderExists) {
						await this.app.vault.createFolder(attachmentsFolder);
					}

					const arrayBuffer = await file.arrayBuffer();
					await this.app.vault.createBinary(filePath, arrayBuffer);

					const vaultBasePath = (
						this.app.vault.adapter as { basePath?: string }
					).basePath;
					const absolutePath = vaultBasePath
						? `${vaultBasePath}/${filePath}`
						: filePath;

					const updatedActiveConv = this.conversationManager.getActiveConversation();
					if (updatedActiveConv) {
						updatedActiveConv.pendingImagePath = absolutePath;
					}

					new Notice(`Image attached: ${file.name}`);
				} catch (error) {
					this.plugin.errorHandler.handleError(
						error,
						{
							module: "OpenCodeObsidianView",
							function: "handleFileInput",
							operation: "Saving image",
						},
						ErrorSeverity.Warning,
					);
					const errorMessage = error instanceof Error ? error.message : "Unknown error";
					new Notice(`Failed to save image: ${errorMessage}`);
				}
			})();
		}).open();
	}


	private getOrCreateIndicator(selector: string, parentSelector: string): HTMLElement | null {
		let indicator = this.containerEl.querySelector(selector) as HTMLElement | null;
		if (!indicator) {
			const parent = this.containerEl.querySelector(parentSelector);
			if (parent) {
				indicator = parent.createDiv(selector.replace(".", ""));
			}
		}
		return indicator;
	}

	private showThinkingIndicator(content: string) {
		console.debug("AI is thinking:", content);
		const indicator = this.getOrCreateIndicator(
			".opencode-obsidian-thinking-indicator",
			".opencode-obsidian-messages",
		);
		if (indicator) {
			indicator.textContent = `💭 ${content || "Thinking..."}`;
			setStyles(indicator, { display: "block" });
			setTimeout(() => {
				setStyles(indicator, { display: "none" });
			}, 3000);
		}
	}

	private showBlockedIndicator(content: string) {
		const indicator = this.getOrCreateIndicator(
			".opencode-obsidian-blocked-indicator",
			".opencode-obsidian-header",
		);
		if (indicator) {
			indicator.textContent = `🔒 ${content}`;
			setStyles(indicator, { display: "block" });
		}
	}

	private showUsageInfo(usage: UsageInfo) {
		const usageText = `${usage.model}: ${usage.inputTokens} tokens`;
		console.debug("Usage:", usageText);
	}

	private showToolUse(toolUse: ToolUse) {
		console.debug("Tool use:", toolUse);
		new Notice(`Using tool: ${toolUse.name}`);
	}

	private showToolResult(toolResult: ToolResult) {
		console.debug("Tool result:", toolResult);
		if (toolResult.isError) {
			new Notice(`Tool error: ${toolResult.content}`);
		}
	}

	private async loadScrollPositions(): Promise<void> {
		try {
			const data = (await this.plugin.loadData()) as PluginData | null;
			this.scrollPositions = data?.scrollPositions || {};
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "OpenCodeObsidianView",
					function: "loadScrollPositions",
					operation: "Loading scroll positions",
				},
				ErrorSeverity.Warning,
			);
		}
	}

	private async saveScrollPosition(conversationId: string, scrollTop: number): Promise<void> {
		try {
			this.scrollPositions[conversationId] = scrollTop;
			const currentData = (await this.plugin.loadData()) as PluginData | null;
			const dataToSave: PluginData = {
				...(currentData || {}),
				scrollPositions: this.scrollPositions,
			};
			await this.plugin.saveData(dataToSave);
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "OpenCodeObsidianView",
					function: "saveScrollPosition",
					operation: "Saving scroll position",
				},
				ErrorSeverity.Warning,
			);
		}
	}

	private attachScrollListener(): void {
		const messagesContainer = this.containerEl.querySelector(".opencode-obsidian-messages") as HTMLElement;
		if (!messagesContainer) return;

		messagesContainer.addEventListener("scroll", () => {
			if (this.activeConversationId) {
				void this.debouncedSaveScrollPosition(this.activeConversationId, messagesContainer.scrollTop);
			}
		});
	}

	/**
	 * Public method to create a new conversation
	 * Used by keyboard shortcuts and commands
	 */
	async createNewConversation(): Promise<void> {
		await this.conversationManager.createNewConversation();
	}
}
