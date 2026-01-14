import {
	ItemView,
	WorkspaceLeaf,
	Notice,
} from "obsidian";
import type OpenCodeObsidianPlugin from "../main";
import { ErrorSeverity } from "../utils/error-handler";
import type {
	Conversation,
	Message,
	ToolUse,
	ToolResult,
} from "../types";
import { HeaderComponent } from "./components/header";
import { ConversationSelectorComponent } from "./components/conversation-selector";
import { MessageListComponent } from "./components/message-list";
import { MessageRendererComponent } from "./components/message-renderer";
import { InputAreaComponent } from "./components/input-area";
import { AttachmentModal } from "./modals/attachment-modal";
import { ConfirmationModal } from "./modals/confirmation-modal";
import { ConversationManager } from "./services/conversation-manager";
import { MessageSender } from "./services/message-sender";
import { ConversationSync } from "./services/conversation-sync";

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
	private currentAbortController: AbortController | null = null;
	private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
	private lastHealthCheckResult: boolean | null = null;
	private eventUnsubscribers: Array<() => void> = [];
	private commandSuggestions: CommandSuggestion[] = [];
	private commandSuggestionsLoading = false;

	// Components
	private headerComponent: HeaderComponent;
	private conversationSelectorComponent: ConversationSelectorComponent;
	private messageListComponent: MessageListComponent;
	private messageRendererComponent: MessageRendererComponent;
	private inputAreaComponent: InputAreaComponent;

	// Services
	private conversationManager: ConversationManager;
	private messageSender: MessageSender;
	private conversationSync: ConversationSync;

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


		this.conversationSync = new ConversationSync(
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
		container.empty();
		container.addClass("opencode-obsidian-view");

		this.renderView();
		await this.conversationManager.loadConversations();

		this.updateConversationSelector();
		this.updateMessages();

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
			await this.performHealthCheck();
			
			if (this.plugin.opencodeClient.isConnected() && this.lastHealthCheckResult) {
				await this.conversationSync.syncConversationsFromServer();
			}
			
			this.startPeriodicHealthCheck();
		}
		
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

		this.stopPeriodicHealthCheck();
	}

	private renderView() {
		const container = this.getContainer();
		if (!container) return;
		
		container.empty();
		this.headerComponent.render(container.createDiv("opencode-obsidian-header"));
		this.conversationSelectorComponent.render(container.createDiv("opencode-obsidian-conversation-selector"));
		this.messageListComponent.render(container.createDiv("opencode-obsidian-messages"));
		this.inputAreaComponent.render(container.createDiv("opencode-obsidian-input"));
	}

	private getContainer(): HTMLElement | null {
		return (this.containerEl.children[1] as HTMLElement) || null;
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

	private updateStreamingStatus(isStreaming: boolean): void {
		this.inputAreaComponent.updateStreamingStatus(isStreaming);
	}

	private async performHealthCheck(): Promise<void> {
		if (!this.plugin.opencodeClient) {
			new Notice("OpenCode Server client not initialized");
			return;
		}

		try {
			const isHealthy = await this.plugin.opencodeClient.healthCheck();
			this.lastHealthCheckResult = isHealthy;
			new Notice(isHealthy ? "Server is healthy" : "Server health check failed");
		} catch (error) {
			this.lastHealthCheckResult = false;
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`Health check failed: ${errorMessage}`);
		} finally {
			this.updateHeader();
		}
	}

	private startPeriodicHealthCheck(): void {
		this.stopPeriodicHealthCheck();

		this.healthCheckInterval = setInterval(() => {
			if (this.plugin.opencodeClient?.isConnected()) {
				void this.performHealthCheck();
			}
		}, 30000);
	}

	private stopPeriodicHealthCheck(): void {
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
			this.healthCheckInterval = null;
		}
	}

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
		const trimmed = content.trim();
		if (!trimmed.startsWith("/")) return null;
		
		const withoutSlash = trimmed.slice(1).trim();
		if (!withoutSlash) return null;
		
		const spaceIndex = withoutSlash.indexOf(" ");
		if (spaceIndex === -1) {
			return { command: withoutSlash, args: "" };
		}
		
		const command = withoutSlash.slice(0, spaceIndex);
		return command ? { command, args: withoutSlash.slice(spaceIndex + 1) } : null;
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

		contentEl.empty();
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

			const sanitizedTitle = conversation.title
				.replace(/[<>:"/\\|?*]/g, "_")
				.substring(0, 50);
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
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
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment
			indicator.style.display = "block";
			setTimeout(() => {
				// eslint-disable-next-line obsidianmd/no-static-styles-assignment
				indicator.style.display = "none";
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
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment
			indicator.style.display = "block";
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
}
