import {
	ItemView,
	WorkspaceLeaf,
	Notice,
	Modal,
	Setting,
	MarkdownRenderer,
	TFile,
	App,
} from "obsidian";
import type OpenCodeObsidianPlugin from "./main";
import { ErrorSeverity } from "./utils/error-handler";
import type {
	Conversation,
	Message,
	ToolUse,
	ToolResult,
	ImageAttachment,
} from "./types";

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

	constructor(leaf: WorkspaceLeaf, plugin: OpenCodeObsidianPlugin) {
		super(leaf);
		this.plugin = plugin;
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
		const container = this.containerEl.children[1];
		if (!container) return;
		container.empty();
		container.addClass("opencode-obsidian-view");

		this.renderView();
		await this.loadConversations(); // 先加载本地会话（但不创建新会话）
		
		// 加载会话后立即更新 UI
		this.updateConversationSelector();
		this.updateMessages();

		this.registerEventBusCallbacks();

		// Connect via ConnectionManager (single authority for connection lifecycle)
		if (this.plugin.connectionManager) {
			try {
				await this.plugin.connectionManager.ensureConnected(5000);
				console.debug(
					"[OpenCodeObsidianView] Connected to OpenCode Server",
				);
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
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				new Notice(`Connection failed: ${errorMessage}`);
			}
		} else if (this.plugin.opencodeClient) {
			// Fallback for older initialization paths
			if (!this.plugin.opencodeClient.isConnected()) {
				try {
					await this.plugin.opencodeClient.connect();
				} catch (error) {
					this.plugin.errorHandler.handleError(
						error,
						{
							module: "OpenCodeObsidianView",
							function: "onOpen",
							operation: "Connecting to OpenCode Server (fallback)",
						},
						ErrorSeverity.Warning,
					);
				}
			}
		}

		if (this.plugin.opencodeClient) {

			// Perform initial health check
			await this.performHealthCheck();

			// If server is healthy and connected, sync conversations from server
			if (
				this.plugin.opencodeClient.isConnected() &&
				this.lastHealthCheckResult
			) {
				await this.syncConversationsFromServer();
			} else {
				// 如果服务器未连接或健康检查失败，且没有会话，创建新会话
				if (this.conversations.length === 0) {
					await this.createNewConversation();
				}
			}

			// Start periodic health check
			this.startPeriodicHealthCheck();
		} else {
			// 如果没有客户端，且没有会话，创建新会话
			if (this.conversations.length === 0) {
				await this.createNewConversation();
			}
		}
	}

	/**
	 * Perform health check on OpenCode Server
	 */
	private async performHealthCheck(): Promise<void> {
		if (!this.plugin.opencodeClient) {
			new Notice("OpenCode Server client not initialized");
			return;
		}

		try {
			const isHealthy = await this.plugin.opencodeClient.healthCheck();
			this.lastHealthCheckResult = isHealthy;

			if (isHealthy) {
				new Notice("Server is healthy");
			} else {
				new Notice("Server health check failed");
			}

			// Update header display
			this.updateHeader();
		} catch (error) {
			this.lastHealthCheckResult = false;
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			new Notice(`Health check failed: ${errorMessage}`);
			this.updateHeader();
		}
	}

	/**
	 * Start periodic health check
	 */
	private startPeriodicHealthCheck(): void {
		// Clear existing timer
		this.stopPeriodicHealthCheck();

		// Check every 30 seconds (configurable)
		this.healthCheckInterval = setInterval(() => {
			if (this.plugin.opencodeClient?.isConnected()) {
				void this.performHealthCheck();
			}
		}, 30000);
	}

	/**
	 * Stop periodic health check
	 */
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
		}
	}

	private parseSlashCommand(content: string): { command: string; args: string } | null {
		const trimmed = content.trim();
		if (!trimmed.startsWith("/")) {
			return null;
		}
		const withoutSlash = trimmed.slice(1);
		if (!withoutSlash) {
			return null;
		}
		const firstSpaceIndex = withoutSlash.search(/\s/);
		if (firstSpaceIndex === -1) {
			return { command: withoutSlash, args: "" };
		}
		const command = withoutSlash.slice(0, firstSpaceIndex);
		const args = withoutSlash.slice(firstSpaceIndex).trimStart();
		if (!command) {
			return null;
		}
		return { command, args };
	}

	/**
	 * Find conversation by sessionId
	 */
	private findConversationBySessionId(
		sessionId: string,
	): Conversation | null {
		return (
			this.conversations.find((c) => c.sessionId === sessionId) || null
		);
	}

	/**
	 * Register callbacks for OpenCode Server session events.
	 * Events are forwarded by the plugin (single subscription point).
	 */
	private registerEventBusCallbacks(): void {
		// Avoid double-registration when view re-opens.
		for (const unsub of this.eventUnsubscribers) {
			try {
				unsub();
			} catch {
				// ignore
			}
		}
		this.eventUnsubscribers = [];

		const bus = this.plugin.sessionEventBus;

		// Stream token callback - append tokens to the current assistant message
		this.eventUnsubscribers.push(
			bus.onStreamToken(({ sessionId, token, done }) => {
			// Route by sessionId, not just active conversation
			const targetConv =
				this.findConversationBySessionId(sessionId) ||
				this.getActiveConversation();
			if (!targetConv || targetConv.sessionId !== sessionId) {
				// Only process if sessionId matches or if it's the active conversation (for backward compatibility)
				if (targetConv && targetConv.sessionId !== sessionId) {
					console.debug(
						"[OpenCodeObsidianView] Ignoring stream token for mismatched sessionId:",
						sessionId,
					);
					return;
				}
				if (!targetConv) return;
			}

			// Find the last assistant message and update content
			const lastMessage =
				targetConv.messages[targetConv.messages.length - 1];
			if (lastMessage && lastMessage.role === "assistant") {
				const currentContent = lastMessage.content;
				
				// Filter out user message echo: if assistant message is empty and token matches the last user message, ignore it
				// This happens when the server echoes the user's message in the first stream event
				if (!currentContent && targetConv.messages.length >= 2) {
					const lastUserMessage = targetConv.messages[targetConv.messages.length - 2];
					if (lastUserMessage && lastUserMessage.role === "user" && token === lastUserMessage.content) {
						return;
					}
				}
				
				// If token equals current content, no update needed
				if (token === currentContent) {
					return;
				}
				
				// Determine if token is full content or incremental update
				// If token starts with current content, it's full content - replace it
				// Otherwise, treat as incremental update and append
				if (currentContent && token.startsWith(currentContent)) {
					lastMessage.content = token;
				} else {
					// Incremental update - append
					lastMessage.content += token;
				}
				
				// Use incremental update method to update only this message's content
				// This avoids re-rendering the entire message list
				this.updateMessageContent(lastMessage.id, lastMessage.content);
			}

			if (done) {
				// When streaming is done, ensure final state is correct by updating messages
				// This ensures any final formatting or structure is properly rendered
				this.updateMessages();
				
				// Only update streaming status if this is the active conversation
				const activeConv = this.getActiveConversation();
				if (activeConv && activeConv.sessionId === sessionId) {
					this.isStreaming = false;
					this.updateStreamingStatus(false);
				}
				targetConv.updatedAt = Date.now();
				void this.saveConversations();
			}
			}),
		);

		// Stream thinking callback
		this.eventUnsubscribers.push(
			bus.onStreamThinking(({ sessionId, content }) => {
			// Route by sessionId
			const targetConv =
				this.findConversationBySessionId(sessionId) ||
				this.getActiveConversation();
			if (!targetConv || targetConv.sessionId !== sessionId) {
				if (targetConv && targetConv.sessionId !== sessionId) {
					console.debug(
						"[OpenCodeObsidianView] Ignoring stream thinking for mismatched sessionId:",
						sessionId,
					);
					return;
				}
				if (!targetConv) return;
			}

			const lastMessage =
				targetConv.messages[targetConv.messages.length - 1];
			if (lastMessage && lastMessage.role === "assistant") {
				void this.handleResponseChunk(
					{ type: "thinking", content },
					lastMessage,
				);
			}
			}),
		);

		// Error callback - check if error has sessionId, otherwise fallback to activeConv
		this.eventUnsubscribers.push(
			bus.onError(({ error }) => {
			// Try to extract sessionId from error if available
			let targetConv: Conversation | null = null;
			const errorWithSessionId = error as { sessionId?: string };
			if (errorWithSessionId.sessionId) {
				const sessionId = errorWithSessionId.sessionId;
				targetConv = this.findConversationBySessionId(sessionId);
			}

			// Fallback to active conversation if no sessionId or not found
			if (!targetConv) {
				targetConv = this.getActiveConversation();
			}

			if (!targetConv) return;

			const lastMessage =
				targetConv.messages[targetConv.messages.length - 1];
			if (lastMessage && lastMessage.role === "assistant") {
				lastMessage.content = `Error: ${error.message}`;
				this.updateMessages();
			}

			new Notice(error.message);
			// Only update streaming status if this is the active conversation
			const activeConv = this.getActiveConversation();
			if (activeConv === targetConv) {
				this.isStreaming = false;
				this.updateStreamingStatus(false);
			}
			}),
		);

		// Progress update callback
		this.eventUnsubscribers.push(
			bus.onProgressUpdate(({ sessionId, progress }) => {
			// Route by sessionId
			const targetConv =
				this.findConversationBySessionId(sessionId) ||
				this.getActiveConversation();
			if (!targetConv || targetConv.sessionId !== sessionId) {
				if (targetConv && targetConv.sessionId !== sessionId) {
					console.debug(
						"[OpenCodeObsidianView] Ignoring progress update for mismatched sessionId:",
						sessionId,
					);
					return;
				}
				if (!targetConv) return;
			}

			const lastMessage =
				targetConv.messages[targetConv.messages.length - 1];
			if (lastMessage && lastMessage.role === "assistant") {
				void this.handleResponseChunk(
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

		// Session end callback
		this.eventUnsubscribers.push(
			bus.onSessionEnd(({ sessionId, reason }) => {
			// Route by sessionId
			const targetConv = this.findConversationBySessionId(sessionId);
			if (targetConv && targetConv.sessionId === sessionId) {
				targetConv.sessionId = null;
			}

			// Only update streaming status if this is the active conversation
			const activeConv = this.getActiveConversation();
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

	async onClose() {
		// Clean up any ongoing streams
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

		// Stop periodic health check
		this.stopPeriodicHealthCheck();
	}

	private renderView() {
		const container = this.containerEl.children[1];
		if (!container) return;
		container.empty();

		// Header with connection status and controls
		const header = container.createDiv("opencode-obsidian-header");
		this.renderHeader(header);

		// Conversation list/selector
		const conversationSelector = container.createDiv(
			"opencode-obsidian-conversation-selector",
		);
		this.renderConversationSelector(conversationSelector);

		// Messages container
		const messagesContainer = container.createDiv(
			"opencode-obsidian-messages",
		);
		this.renderMessages(messagesContainer);

		// Input area
		const inputArea = container.createDiv("opencode-obsidian-input");
		this.renderInputArea(inputArea);
	}

	/**
	 * Incremental DOM update methods to avoid full re-renders
	 */
	private getOrCreateContainerElement(className: string): HTMLElement | null {
		const container = this.containerEl.children[1];
		if (!container) return null;

		// Use querySelector to find element by class name
		const element = container.querySelector(`.${className}`) as HTMLElement;
		if (!element) {
			// Element doesn't exist, fallback to full render
			return null;
		}
		return element;
	}

	/**
	 * Incrementally update header (connection status and controls)
	 */
	private updateHeader(): void {
		const header = this.getOrCreateContainerElement(
			"opencode-obsidian-header",
		);
		if (header) {
			this.renderHeader(header);
		}
	}

	/**
	 * Incrementally update conversation selector
	 */
	private updateConversationSelector(): void {
		const conversationSelector = this.getOrCreateContainerElement(
			"opencode-obsidian-conversation-selector",
		);
		if (conversationSelector) {
			this.renderConversationSelector(conversationSelector);
		}
	}

	/**
	 * Incrementally update messages container
	 */
	private updateMessages(): void {
		const messagesContainer = this.getOrCreateContainerElement(
			"opencode-obsidian-messages",
		);
		if (messagesContainer) {
			this.renderMessages(messagesContainer);
		}
	}

	/**
	 * Incrementally update input area (toolbar, textarea, buttons)
	 */
	private updateInputArea(): void {
		const inputArea = this.getOrCreateContainerElement(
			"opencode-obsidian-input",
		);
		if (inputArea) {
			this.renderInputArea(inputArea);
		}
	}

	/**
	 * Update streaming status in input area without full re-render
	 */
	private updateStreamingStatus(isStreaming: boolean): void {
		const statusBar = this.containerEl.querySelector(
			".opencode-obsidian-input-status",
		);
		if (!statusBar) return;

		const streamingStatus = statusBar.querySelector(
			".opencode-obsidian-streaming-status",
		) as HTMLElement;
		if (streamingStatus) {
			if (isStreaming) {
				streamingStatus.textContent = "Streaming response...";
				streamingStatus.addClass("opencode-obsidian-streaming");
			} else {
				streamingStatus.textContent = "";
				streamingStatus.removeClass("opencode-obsidian-streaming");
			}
		}

		// Update send button text
		const sendBtn = this.containerEl.querySelector(
			".opencode-obsidian-input-buttons button.mod-cta, .opencode-obsidian-input-buttons button.mod-warning",
		) as HTMLElement;
		if (sendBtn) {
			sendBtn.textContent = isStreaming ? "Stop" : "Send";
			sendBtn.removeClass("mod-cta", "mod-warning");
			sendBtn.addClass(isStreaming ? "mod-warning" : "mod-cta");
		}
	}

	private renderHeader(container: HTMLElement) {
		container.empty();

		const statusEl = container.createDiv("opencode-obsidian-status");

		// Use actual health check result
		const connectionState =
			this.plugin.connectionManager?.getDiagnostics().state ??
			(this.plugin.opencodeClient?.getConnectionState() ?? "disconnected");
		const isConnected = connectionState === "connected";
		const isHealthy = this.lastHealthCheckResult ?? false;

		if (!this.plugin.settings.opencodeServer?.url) {
			statusEl.addClass("disconnected");
			statusEl.textContent = "● Server URL not configured";
		} else if (connectionState === "error") {
			statusEl.addClass("disconnected");
			statusEl.textContent = "● Connection error";
		} else if (!isConnected) {
			statusEl.addClass("disconnected");
			statusEl.textContent = "● Not connected";
		} else if (isHealthy) {
			statusEl.addClass("connected");
			statusEl.textContent = "● Connected and healthy";
		} else {
			statusEl.addClass("disconnected");
			statusEl.textContent = "● Connected but unhealthy";
		}

		const controls = container.createDiv("opencode-obsidian-controls");

		// Check connection button
		const checkConnBtn = controls.createEl("button", {
			text: "Check connection",
			cls: "mod-small",
		});
		checkConnBtn.onclick = () => {
			void this.performHealthCheck();
		};

		// New conversation button
		const newConvBtn = controls.createEl("button", {
			text: "New chat",
			cls: "mod-cta",
		});
		newConvBtn.onclick = () => {
			void this.createNewConversation();
		};
	}

	private renderConversationSelector(container: HTMLElement) {
		container.empty();

		if (this.conversations.length === 0) {
			container.createDiv(
				"opencode-obsidian-no-conversations",
			).textContent = "No conversations yet";
			return;
		}

		const tabsContainer = container.createDiv(
			"opencode-obsidian-tabs-container",
		);

		// Create tabs for each conversation
		this.conversations.forEach((conv) => {
			const tab = tabsContainer.createDiv("opencode-obsidian-tab");
			tab.setAttribute("data-conversation-id", conv.id);

			if (conv.id === this.activeConversationId) {
				tab.addClass("active");
			}

			// Tab title
			const title = tab.createSpan("opencode-obsidian-tab-title");
			title.textContent = conv.title;
			// Add tooltip to show full title when truncated
			tab.setAttribute("title", conv.title);

			// Double-click to edit title
			let isEditing = false;
			title.ondblclick = (e) => {
				e.stopPropagation();
				if (isEditing) return;
				isEditing = true;

				const input = document.createElement("input");
				input.type = "text";
				input.value = conv.title;
				input.className = "opencode-obsidian-tab-title-edit";
				input.style.width = `${title.offsetWidth}px`;
				input.style.minWidth = "120px";
				input.style.maxWidth = "300px";

				// Replace title with input
				title.style.display = "none";
				tab.insertBefore(input, title);

				// Focus and select
				input.focus();
				input.select();

				// Handle save
				const saveTitle = async () => {
					const newTitle = input.value.trim();
					if (newTitle && newTitle !== conv.title) {
						await this.renameConversation(conv.id, newTitle);
					}
					input.remove();
					title.style.display = "";
					isEditing = false;
				};

				// Handle cancel
				const cancelEdit = () => {
					input.remove();
					title.style.display = "";
					isEditing = false;
				};

				input.onblur = () => {
					setTimeout(saveTitle, 200); // Delay to allow click events
				};

				input.onkeydown = (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						e.stopPropagation();
						void saveTitle();
					} else if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						cancelEdit();
					}
				};
			};

			// Close button (shown on hover)
			const closeBtn = tab.createSpan("opencode-obsidian-tab-close");
			closeBtn.textContent = "×";
			closeBtn.setAttribute("title", "Delete conversation");

			// Prevent event bubbling when clicking close button
			closeBtn.onclick = (e) => {
				e.stopPropagation();
				void this.deleteConversation(conv.id);
			};

			// Right-click for context menu
			tab.oncontextmenu = (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.showConversationContextMenu(tab, conv.id, e);
			};

			// Click tab to switch conversation
			tab.onclick = () => {
				if (!isEditing) {
					void this.switchConversation(conv.id);
				}
			};
		});

		// New conversation button
		const newTab = tabsContainer.createDiv("opencode-obsidian-tab opencode-obsidian-tab-new");
		newTab.textContent = "+";
		newTab.setAttribute("title", "New conversation");
		newTab.onclick = () => {
			void this.createNewConversation();
		};
	}

	private renderMessages(container: HTMLElement) {
		container.empty();

		const activeConv = this.getActiveConversation();
		if (!activeConv || activeConv.messages.length === 0) {
			container.createDiv(
				"opencode-obsidian-empty-messages",
			).textContent = "Start a conversation...";
			return;
		}

		activeConv.messages.forEach((message) => {
			this.renderMessage(container, message);
		});

		// Auto-scroll to bottom
		container.scrollTop = container.scrollHeight;
	}

	private renderMessage(container: HTMLElement, message: Message) {
		const messageEl = container.createDiv(
			`opencode-obsidian-message opencode-obsidian-message-${message.role}`,
		);
		messageEl.setAttribute("data-message-id", message.id);

		const header = messageEl.createDiv("opencode-obsidian-message-header");
		header.createSpan("opencode-obsidian-message-role").textContent =
			message.role;
		header.createSpan("opencode-obsidian-message-time").textContent =
			new Date(message.timestamp).toLocaleTimeString();

		const content = messageEl.createDiv(
			"opencode-obsidian-message-content",
		);

		// Handle different content types
		if (typeof message.content === "string") {
			// Parse and render markdown-like content
			this.renderMessageContent(content, message.content);
		} else {
			// Rich content (could include tool uses, etc.)
			content.createDiv().textContent = JSON.stringify(
				message.content,
				null,
				2,
			);
		}

		// Render images if present
		if (message.images && message.images.length > 0) {
			const imagesContainer = content.createDiv(
				"opencode-obsidian-message-images",
			);
			message.images.forEach((img) => {
				const imgEl = imagesContainer.createEl("img", {
					attr: { src: img.data, alt: img.name || "Image" },
				});
				// eslint-disable-next-line obsidianmd/no-static-styles-assignment
				imgEl.style.maxWidth = "300px";
				// eslint-disable-next-line obsidianmd/no-static-styles-assignment
				imgEl.style.maxHeight = "300px";
			});
		}

		// Add message actions (copy, edit, etc.)
		this.addMessageActions(messageEl, message);
	}

	private renderMessageContent(container: HTMLElement, content: string) {
		// Use Obsidian's MarkdownRenderer for full markdown support
		// But preserve code blocks with copy functionality
		const lines = content.split("\n");
		let inCodeBlock = false;
		let codeBlockLanguage = "";
		let codeBlockContent: string[] = [];
		let textBeforeCodeBlock = "";

		// First pass: separate code blocks from regular markdown
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;

			if (line.startsWith("```")) {
				if (inCodeBlock) {
					// End of code block
					inCodeBlock = false;
					// Render text before code block
					if (textBeforeCodeBlock.trim()) {
						const textContainer = container.createDiv(
							"opencode-obsidian-markdown-text",
						);
						void MarkdownRenderer.render(
							this.plugin.app,
							textBeforeCodeBlock.trim(),
							textContainer,
							"",
							this,
						);
						textBeforeCodeBlock = "";
					}
					// Render code block with copy button
					const codeBlock = container.createEl("pre");
					codeBlock.addClass("opencode-obsidian-code-block");
					const code = codeBlock.createEl("code");
					if (codeBlockLanguage) {
						code.addClass(`language-${codeBlockLanguage}`);
					}
					code.textContent = codeBlockContent.join("\n");
					this.addCodeBlockActions(
						codeBlock,
						codeBlockContent.join("\n"),
					);
					codeBlockContent = [];
					codeBlockLanguage = "";
				} else {
					// Start of code block
					inCodeBlock = true;
					codeBlockLanguage = line.slice(3).trim();
				}
			} else if (inCodeBlock) {
				codeBlockContent.push(line);
			} else {
				textBeforeCodeBlock += (textBeforeCodeBlock ? "\n" : "") + line;
			}
		}

		// Handle remaining text or code block
		if (inCodeBlock && codeBlockContent.length > 0) {
			// Unclosed code block, render as code
			const codeBlock = container.createEl("pre");
			codeBlock.addClass("opencode-obsidian-code-block");
			const code = codeBlock.createEl("code");
			if (codeBlockLanguage) {
				code.addClass(`language-${codeBlockLanguage}`);
			}
			code.textContent = codeBlockContent.join("\n");
			this.addCodeBlockActions(codeBlock, codeBlockContent.join("\n"));
		}

		if (textBeforeCodeBlock.trim()) {
			const textContainer = container.createDiv(
				"opencode-obsidian-markdown-text",
			);
			void MarkdownRenderer.render(
				this.plugin.app,
				textBeforeCodeBlock.trim(),
				textContainer,
				"",
				this,
			);
		}
	}

	private createParagraph(container: HTMLElement, text: string) {
		const p = container.createEl("p");

		// Simple inline formatting
		let formattedText = text
			.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
			.replace(/\*(.*?)\*/g, "<em>$1</em>")
			.replace(/`(.*?)`/g, "<code>$1</code>");

		// eslint-disable-next-line @microsoft/sdl/no-inner-html
		p.innerHTML = formattedText;
	}

	private addCodeBlockActions(codeBlock: HTMLElement, code: string) {
		const actions = codeBlock.createDiv("opencode-obsidian-code-actions");

		const copyBtn = actions.createEl("button", {
			text: "Copy",
			cls: "opencode-obsidian-code-copy",
		});

		copyBtn.onclick = async () => {
			try {
				await navigator.clipboard.writeText(code);
				copyBtn.textContent = "Copied!";
				setTimeout(() => {
					copyBtn.textContent = "Copy";
				}, 2000);
			} catch (error) {
				this.plugin.errorHandler.handleError(
					error,
					{
						module: "OpenCodeObsidianView",
						function: "addCodeActions",
						operation: "Copying code to clipboard",
					},
					ErrorSeverity.Warning,
				);
				new Notice("Failed to copy code");
			}
		};
	}

	private addMessageActions(messageEl: HTMLElement, message: Message) {
		const actions = messageEl.createDiv(
			"opencode-obsidian-message-actions",
		);

		// Copy message button
		const copyBtn = actions.createEl("button", {
			text: "📋",
			cls: "opencode-obsidian-message-action",
			attr: { title: "Copy message" },
		});

		copyBtn.onclick = async () => {
			try {
				await navigator.clipboard.writeText(message.content);
				new Notice("Message copied to clipboard");
			} catch (error) {
				this.plugin.errorHandler.handleError(
					error,
					{
						module: "OpenCodeObsidianView",
						function: "addMessageActions",
						operation: "Copying message to clipboard",
					},
					ErrorSeverity.Warning,
				);
				new Notice("Failed to copy message");
			}
		};

		// Regenerate button for assistant messages
		if (message.role === "assistant") {
			const regenBtn = actions.createEl("button", {
				text: "🔄",
				cls: "opencode-obsidian-message-action",
				attr: { title: "Regenerate response" },
			});

			regenBtn.onclick = () => {
				void this.regenerateResponse(message);
			};
		}
	}

	private renderInputArea(container: HTMLElement) {
		container.empty();

		const inputContainer = container.createDiv(
			"opencode-obsidian-input-container",
		);

		// Input toolbar
		const toolbar = inputContainer.createDiv(
			"opencode-obsidian-input-toolbar",
		);

		// TODO: Model selector removed - models are managed by OpenCode Server

		// Agent selector
		const agentSelect = toolbar.createEl("select", {
			cls: "opencode-obsidian-agent-select",
		});

		// Default agents (fallback if no custom agents loaded)
		const defaultAgents: Array<{ id: string; name: string }> = [
			{ id: "assistant", name: "Assistant" },
			{ id: "bootstrap", name: "Bootstrap" },
			{ id: "thinking-partner", name: "Thinking Partner" },
			{ id: "research-assistant", name: "Research Assistant" },
			{ id: "read-only", name: "Read Only" },
		];

		// Get loaded agents (filter out hidden ones)
		const loadedAgents =
			this.plugin.settings.agents?.filter((a) => !a.hidden) || [];

		// Use loaded agents if available, otherwise use defaults
		const agentsToShow =
			loadedAgents.length > 0 ? loadedAgents : defaultAgents;

		// Add agents to dropdown
		agentsToShow.forEach((agent) => {
			const option = agentSelect.createEl("option", {
				value: agent.id,
				text: agent.name,
			});

			// Add color indicator if agent has color (only for Agent type, not default agents)
			if ("color" in agent && typeof agent.color === "string") {
				option.style.color = agent.color;
			}
		});

		// Set current value (ensure it exists in options)
		const currentValue = this.plugin.settings.agent;
		if (agentsToShow.some((a) => a.id === currentValue)) {
			agentSelect.value = currentValue;
		} else if (agentsToShow.length > 0 && agentsToShow[0]) {
			// If current agent not found, use first available
			agentSelect.value = agentsToShow[0].id;
			this.plugin.settings.agent = agentsToShow[0].id;
			void this.plugin.saveSettings();
		}

		agentSelect.onchange = async () => {
			this.plugin.settings.agent = agentSelect.value;
			// Use debounced save for agent selector changes
			await this.plugin.debouncedSaveSettings();
		};

		const textarea = inputContainer.createEl("textarea", {
			cls: "opencode-obsidian-input-textarea",
			attr: {
				placeholder:
					"Type your message... (Shift+Enter for new line, Enter to send)",
			},
		});

		const suggestionContainer = inputContainer.createDiv(
			"opencode-obsidian-command-suggestions",
		);
		const suggestionList = suggestionContainer.createDiv(
			"opencode-obsidian-command-suggestions-list",
		);

		// Input status bar
		const statusBar = inputContainer.createDiv(
			"opencode-obsidian-input-status",
		);
		const charCount = statusBar.createSpan("opencode-obsidian-char-count");
		const streamingStatus = statusBar.createSpan(
			"opencode-obsidian-streaming-status",
		);

		// Update character count
		const updateCharCount = () => {
			const count = textarea.value.length;
			charCount.textContent = `${count} characters`;
			if (count > 8000) {
				charCount.addClass("opencode-obsidian-char-warning");
			} else {
				charCount.removeClass("opencode-obsidian-char-warning");
			}
		};

		let currentSuggestions: CommandSuggestion[] = [];
		let selectedSuggestionIndex = -1;

		const hideSuggestions = () => {
			suggestionContainer.removeClass("is-visible");
			currentSuggestions = [];
			selectedSuggestionIndex = -1;
		};

		const applySuggestion = (suggestion: CommandSuggestion) => {
			const value = textarea.value;
			const trimmed = value.startsWith("/") ? value.slice(1) : value;
			const firstSpaceIndex = trimmed.search(/\s/);
			const rest =
				firstSpaceIndex === -1 ? "" : trimmed.slice(firstSpaceIndex);
			textarea.value = `/${suggestion.name}${rest || " "}`;
			hideSuggestions();
			textarea.focus();
			updateCharCount();
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment
			textarea.style.height = "auto";
			textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
		};

		const renderSuggestions = (suggestions: CommandSuggestion[]) => {
			suggestionList.empty();
			currentSuggestions = suggestions;
			selectedSuggestionIndex = suggestions.length > 0 ? 0 : -1;
			if (suggestions.length === 0) {
				hideSuggestions();
				return;
			}
			suggestionContainer.addClass("is-visible");
			suggestions.forEach((suggestion, index) => {
				const item = suggestionList.createDiv(
					"opencode-obsidian-command-suggestion",
				);
				if (index === selectedSuggestionIndex) {
					item.addClass("is-selected");
				}
				const nameEl = item.createSpan(
					"opencode-obsidian-command-suggestion-name",
				);
				nameEl.textContent = `/${suggestion.name}`;
				if (suggestion.description) {
					const descEl = item.createSpan(
						"opencode-obsidian-command-suggestion-description",
					);
					descEl.textContent = suggestion.description;
				}
				item.onclick = () => applySuggestion(suggestion);
			});
		};

		const showStatusSuggestion = (text: string) => {
			suggestionList.empty();
			const item = suggestionList.createDiv(
				"opencode-obsidian-command-suggestion opencode-obsidian-command-suggestion-empty",
			);
			item.textContent = text;
			suggestionContainer.addClass("is-visible");
			currentSuggestions = [];
			selectedSuggestionIndex = -1;
		};

		const updateCommandSuggestions = async () => {
			const value = textarea.value;
			if (!value.startsWith("/")) {
				hideSuggestions();
				return;
			}
			if (!this.plugin.opencodeClient) {
				showStatusSuggestion("Server not connected.");
				return;
			}
			if (this.commandSuggestions.length === 0) {
				if (!this.commandSuggestionsLoading) {
					showStatusSuggestion("Loading commands...");
				}
				await this.ensureCommandSuggestions();
			}
			const query = value.slice(1).split(/\s+/)[0]?.toLowerCase() ?? "";
			const matches = this.commandSuggestions.filter((suggestion) =>
				query ? suggestion.name.toLowerCase().startsWith(query) : true,
			);
			const limited = matches.slice(0, 8);
			if (limited.length === 0) {
				if (query) {
					showStatusSuggestion("No matching commands.");
				} else {
					hideSuggestions();
				}
				return;
			}
			renderSuggestions(limited);
		};

		const handleInputChange = () => {
			updateCharCount();
			void updateCommandSuggestions();
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment
			textarea.style.height = "auto";
			textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
		};

		textarea.oninput = handleInputChange;
		updateCharCount();

		const buttonContainer = inputContainer.createDiv(
			"opencode-obsidian-input-buttons",
		);

		const sendBtn = buttonContainer.createEl("button", {
			text: this.isStreaming ? "Stop" : "Send",
			cls: this.isStreaming ? "mod-warning" : "mod-cta",
		});

		const attachBtn = buttonContainer.createEl("button", {
			text: "📎",
			cls: "opencode-obsidian-attach-btn",
			attr: { title: "Attach image" },
		});

		const clearBtn = buttonContainer.createEl("button", {
			text: "🗑️",
			cls: "opencode-obsidian-clear-btn",
			attr: { title: "Clear input" },
		});

		// Update streaming status
		if (this.isStreaming) {
			streamingStatus.textContent = "Streaming response...";
			streamingStatus.addClass("opencode-obsidian-streaming");
		} else {
			streamingStatus.textContent = "";
			streamingStatus.removeClass("opencode-obsidian-streaming");
		}

		// Handle send/stop
		sendBtn.onclick = async () => {
			if (this.isStreaming) {
				this.stopStreaming();
			} else {
				const message = textarea.value.trim();
				if (message) {
					await this.sendMessage(message);
					textarea.value = "";
					updateCharCount();
				}
			}
		};

		// Handle attach (for images)
		attachBtn.onclick = () => {
			void this.showAttachmentModal();
		};

		// Handle clear
		clearBtn.onclick = () => {
			if (textarea.value.trim()) {
				new ConfirmationModal(
					this.app,
					"Clear input?",
					"Are you sure you want to clear the current input?",
					() => {
						textarea.value = "";
						updateCharCount();
						textarea.focus();
					},
				).open();
			}
		};

		// Handle Enter key (Shift+Enter for new line)
		textarea.onkeydown = (e) => {
			if (suggestionContainer.hasClass("is-visible")) {
				if (e.key === "ArrowDown") {
					e.preventDefault();
					if (currentSuggestions.length > 0) {
						selectedSuggestionIndex =
							(selectedSuggestionIndex + 1) % currentSuggestions.length;
						renderSuggestions(currentSuggestions);
					}
					return;
				}
				if (e.key === "ArrowUp") {
					e.preventDefault();
					if (currentSuggestions.length > 0) {
						selectedSuggestionIndex =
							(selectedSuggestionIndex - 1 + currentSuggestions.length) %
							currentSuggestions.length;
						renderSuggestions(currentSuggestions);
					}
					return;
				}
				if (e.key === "Tab") {
					const suggestion = currentSuggestions[selectedSuggestionIndex];
					if (selectedSuggestionIndex >= 0 && suggestion) {
						e.preventDefault();
						applySuggestion(suggestion);
						return;
					}
				}
				if (e.key === "Escape") {
					e.preventDefault();
					hideSuggestions();
					return;
				}
				if (
					e.key === "Enter" &&
					!e.shiftKey &&
					selectedSuggestionIndex >= 0
				) {
					const suggestion = currentSuggestions[selectedSuggestionIndex];
					if (suggestion) {
						e.preventDefault();
						applySuggestion(suggestion);
						return;
					}
				}
			}
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				sendBtn.click();
			}
		};

		textarea.onblur = () => {
			setTimeout(() => {
				hideSuggestions();
			}, 150);
		};
	}

	private async loadConversations() {
		try {
			const saved = (await this.plugin.loadData()) as {
				conversations?: Conversation[];
				activeConversationId?: string;
				sessionIds?: string[]; // 保存所有使用过的 sessionId
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
				this.conversations = conversations;
				console.debug(
					`[OpenCodeObsidianView] Loaded ${this.conversations.length} conversations from local storage`,
				);
				// Restore active conversation if it exists
				if (this.conversations.length > 0) {
					// Try to restore the last active conversation, or use the first one
					const lastActiveId = saved?.activeConversationId;
					if (
						lastActiveId &&
						typeof lastActiveId === "string" &&
						this.conversations.find((c) => c.id === lastActiveId)
					) {
						this.activeConversationId = lastActiveId;
						console.debug(
							`[OpenCodeObsidianView] Restored active conversation: ${lastActiveId}`,
						);
					} else {
						const firstConv = this.conversations[0];
						if (firstConv) {
							this.activeConversationId = firstConv.id;
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
			// 不要在这里创建新会话，等待服务器同步
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
			// 出错时也不创建新会话
		}
	}

	private async saveConversations() {
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
				sessionIds: sessionIds, // 保存所有 sessionId
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

	private async createNewConversation() {
		// TODO: Provider selection should be handled by OpenCode Server
		const conversation: Conversation = {
			id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
			title: "New Chat",
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		this.conversations.unshift(conversation);
		this.activeConversationId = conversation.id;
		await this.saveConversations();
		// Update conversation selector and messages (new conversation is empty)
		this.updateConversationSelector();
		this.updateMessages();
	}

	private async switchConversation(conversationId: string) {
		this.activeConversationId = conversationId;
		await this.saveConversations();
		// Only update conversation selector (to show selected state) and messages
		this.updateConversationSelector();
		this.updateMessages();
	}

	/**
	 * Rename a conversation
	 */
	private async renameConversation(
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

		// Limit title length
		const finalTitle =
			trimmedTitle.length > 100
				? trimmedTitle.substring(0, 97) + "..."
				: trimmedTitle;

		conversation.title = finalTitle;
		conversation.updatedAt = Date.now();

		// If server supports updating session title, sync it
		// Note: This would require OpenCode Server API support
		if (conversation.sessionId && this.plugin.opencodeClient?.isConnected()) {
			// TODO: If OpenCode Server supports updating session title, do it here
			// await this.plugin.opencodeClient.updateSessionTitle(conversation.sessionId, finalTitle);
		}

		await this.saveConversations();
		this.updateConversationSelector();
	}

	private async deleteConversation(conversationId: string) {
		// Find the conversation index
		const convIndex = this.conversations.findIndex(
			(c) => c.id === conversationId,
		);
		if (convIndex === -1) return;

		const conversation = this.conversations[convIndex];
		if (!conversation) return;

		// Show confirmation dialog
		new ConfirmationModal(
			this.app,
			"Delete conversation?",
			`Are you sure you want to delete "${conversation.title}"? This action cannot be undone.`,
			async () => {
				const wasActive = conversationId === this.activeConversationId;

				// Remove the conversation
				this.conversations.splice(convIndex, 1);

				// Handle active conversation
				if (wasActive) {
					if (this.conversations.length > 0) {
						// Switch to another conversation (prefer the one at the same index, or the first one)
						const newIndex = Math.min(
							convIndex,
							this.conversations.length - 1,
						);
						this.activeConversationId =
							this.conversations[newIndex]?.id ?? null;
					} else {
						// No conversations left, create a new one
						this.activeConversationId = null;
						await this.createNewConversation();
						return;
					}
				}

				await this.saveConversations();
				this.updateConversationSelector();
				this.updateMessages();
			},
		).open();
	}

	private getActiveConversation(): Conversation | null {
		return (
			this.conversations.find(
				(c) => c.id === this.activeConversationId,
			) || null
		);
	}

	/**
	 * Generate a title for a conversation using AI
	 * Falls back to extracting from first user message if AI generation fails
	 */
	private async generateConversationTitle(
		conversationId: string,
	): Promise<void> {
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
			// Fallback: extract from first message
			this.generateTitleFromFirstMessage(conversation);
			return;
		}

		// For now, use simple extraction from first user message
		// AI generation would require a separate API call which might interfere with normal flow
		// TODO: Implement proper AI title generation when OpenCode Server supports it
		this.generateTitleFromFirstMessage(conversation);
	}

	/**
	 * Generate title from first user message (fallback method)
	 */
	private generateTitleFromFirstMessage(conversation: Conversation): void {
		const firstUserMessage = conversation.messages.find(
			(m) => m.role === "user",
		);
		if (firstUserMessage) {
			// Extract first line or first 50 characters
			const content = firstUserMessage.content.trim();
			const firstLine = content.split("\n")[0] ?? "";
			const fallbackTitle = firstLine.substring(0, 50).trim();

			if (fallbackTitle) {
				conversation.title =
					fallbackTitle.length > 50
						? fallbackTitle.substring(0, 47) + "..."
						: fallbackTitle;
				void this.saveConversations();
				this.updateConversationSelector();
			}
		}
	}

	private async sendMessage(content: string): Promise<void> {
		console.info("[OpenCodeObsidianView] sendMessage invoked:", {
			contentLength: content.length,
		});
		const activeConv = this.getActiveConversation();
		if (!activeConv) {
			await this.createNewConversation();
			await this.sendMessage(content);
			return;
		}
		if (content.trim().startsWith("/") && !this.parseSlashCommand(content)) {
			new Notice("Enter a command after /.");
			return;
		}

		// Add user message
		const userMessage: Message = {
			id: `msg-${Date.now()}-user`,
			role: "user",
			content,
			timestamp: Date.now(),
		};
		activeConv.messages.push(userMessage);

		// Create assistant message placeholder
		const assistantMessage: Message = {
			id: `msg-${Date.now()}-assistant`,
			role: "assistant",
			content: "",
			timestamp: Date.now(),
		};
		activeConv.messages.push(assistantMessage);
		const slashCommand = this.parseSlashCommand(content);

		this.isStreaming = true;
		this.currentAbortController = new AbortController();
		// Only update messages (to show new messages) and input area (streaming status)
		this.updateMessages();
		this.updateStreamingStatus(true);

		try {
			// Check if OpenCode Server client is available
			if (!this.plugin.opencodeClient) {
				throw new Error(
					"OpenCode Server client not initialized. Please check settings.",
				);
			}

			// Ensure client is connected (waits for SSE to be established)
			if (this.plugin.connectionManager) {
				await this.plugin.connectionManager.ensureConnected(10000);
			} else if (!this.plugin.opencodeClient.isConnected()) {
				await this.plugin.opencodeClient.connect();
			}

			// Check if there's a pending image path to attach
			const imagePath = activeConv.pendingImagePath;
			let images: ImageAttachment[] | undefined;

			if (imagePath && slashCommand) {
				new Notice("Attachments are not supported for commands.");
				activeConv.pendingImagePath = undefined;
			} else if (imagePath) {
				// Read image file and convert to base64
				try {
					const imageFile =
						this.app.vault.getAbstractFileByPath(imagePath);
					if (imageFile instanceof TFile) {
						const file = imageFile;
						const arrayBuffer =
							await this.app.vault.readBinary(file);
						const base64 = btoa(
							String.fromCharCode(...new Uint8Array(arrayBuffer)),
						);

						// Determine MIME type from extension
						let mimeType = "image/png";
						const ext = file.extension.toLowerCase();
						if (ext === "jpg" || ext === "jpeg") {
							mimeType = "image/jpeg";
						} else if (ext === "gif") {
							mimeType = "image/gif";
						} else if (ext === "webp") {
							mimeType = "image/webp";
						}

						images = [
							{
								data: base64,
								mimeType,
								name: file.name,
							},
						];
					}
				} catch (imageError) {
					this.plugin.errorHandler.handleError(
						imageError,
						{
							module: "OpenCodeObsidianView",
							function: "handleFileInput",
							operation: "Attaching image",
						},
						ErrorSeverity.Warning,
					);
					// Continue without image if reading fails
				}

				// Clear pending image path after using it
				activeConv.pendingImagePath = undefined;
			}

			// Get or create session ID
			let sessionId =
				activeConv.sessionId ||
				this.plugin.opencodeClient.getCurrentSessionId();
			const activeFile = this.app.workspace.getActiveFile();
			const sessionContext = activeFile
				? {
						currentNote: activeFile.path,
						properties:
							this.app.metadataCache.getFileCache(activeFile)
								?.frontmatter,
					}
				: undefined;

			if (!sessionId) {
				// Start a new session
				try {
					sessionId = await this.plugin.opencodeClient.startSession(
						sessionContext,
						this.plugin.settings.agent,
						this.plugin.settings.instructions,
					);

					activeConv.sessionId = sessionId;
					console.debug(
						"[OpenCodeObsidianView] Started new session:",
						sessionId,
					);
				} catch (sessionError) {
					const errorMsg =
						sessionError instanceof Error
							? sessionError.message
							: "Unknown error";
					this.plugin.errorHandler.handleError(
						sessionError,
						{
							module: "OpenCodeObsidianView",
							function: "sendMessage",
							operation: "Starting session",
						},
					);
					// Don't wrap if error already contains diagnostic information
					// (e.g., "Unable to connect" or "Failed to create session")
					if (
						errorMsg.includes("Unable to connect") ||
						errorMsg.includes("Failed to create session") ||
						errorMsg.includes("Failed to start session")
					) {
						throw sessionError;
					}
					throw new Error(`Failed to start session: ${errorMsg}`);
				}
			}

			if (sessionId) {
				const hasSession =
					await this.plugin.opencodeClient.ensureSession(sessionId);
				if (!hasSession) {
					activeConv.sessionId = null;
					sessionId = await this.plugin.opencodeClient.startSession(
						sessionContext,
						this.plugin.settings.agent,
						this.plugin.settings.instructions,
					);
					activeConv.sessionId = sessionId;
				}
			}

			// Send message or command to OpenCode Server
			try {
				if (slashCommand) {
					const commandResponse =
						await this.plugin.opencodeClient.sendSessionCommand(
							sessionId,
							slashCommand.command,
							slashCommand.args,
							this.plugin.settings.agent,
						);
					assistantMessage.content =
						commandResponse ?? "Command executed.";
					this.isStreaming = false;
					this.updateStreamingStatus(false);
					this.updateMessages();
				} else {
					await this.plugin.opencodeClient.sendSessionMessage(
						sessionId,
						content,
						images,
					);
				}
			} catch (sendError) {
				const errorText =
					sendError instanceof Error ? sendError.message : "";
				if (
					errorText.includes("Session") &&
					errorText.includes("not found")
				) {
					activeConv.sessionId = null;
					const refreshedSessionId =
						await this.plugin.opencodeClient.startSession(
							sessionContext,
							this.plugin.settings.agent,
							this.plugin.settings.instructions,
						);
					activeConv.sessionId = refreshedSessionId;
					if (slashCommand) {
						const commandResponse =
							await this.plugin.opencodeClient.sendSessionCommand(
								refreshedSessionId,
								slashCommand.command,
								slashCommand.args,
								this.plugin.settings.agent,
							);
						assistantMessage.content =
							commandResponse ?? "Command executed.";
						this.isStreaming = false;
						this.updateStreamingStatus(false);
						this.updateMessages();
					} else {
						await this.plugin.opencodeClient.sendSessionMessage(
							refreshedSessionId,
							content,
							images,
						);
					}
				} else {
					throw sendError;
				}
			}

			console.debug(
				"[OpenCodeObsidianView] Message sent to OpenCode Server:",
				{ sessionId, contentLength: content.length },
			);
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "OpenCodeObsidianView",
					function: "sendMessage",
					operation: "Sending message",
				},
			);
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			assistantMessage.content = `Error: ${errorMessage}`;
			new Notice(`Error: ${errorMessage}`);
			this.isStreaming = false;
			this.updateStreamingStatus(false);
		} finally {
			if (!this.isStreaming) {
				this.currentAbortController = null;
				activeConv.updatedAt = Date.now();
				await this.saveConversations();
				this.updateMessages();

				// Trigger title generation if needed
				// Only generate if there are at least 2 messages and title is still default
				if (
					activeConv.messages.length >= 2 &&
					(activeConv.title === "New Chat" ||
						activeConv.title.startsWith("Chat "))
				) {
					// Use debounce to avoid generating title multiple times
					setTimeout(() => {
						void this.generateConversationTitle(activeConv.id);
					}, 1000);
				}
			}
		}
	}

	// TODO: Implement response chunk handling for OpenCode Server protocol
	private async handleResponseChunk(chunk: unknown, message: Message) {
		const chunkAny = chunk as {
			type?: string;
			content?: string;
			id?: string;
			name?: string;
			input?: unknown;
			isError?: boolean;
			usage?: unknown;
		};

		switch (chunkAny.type) {
			case "text":
				// Text content is handled in sendMessage
				break;

			case "thinking":
				// Handle thinking/reasoning display

				this.showThinkingIndicator(chunkAny.content || "");
				break;

			case "tool_use":
				// Handle tool use display
				this.showToolUse({
					id: chunkAny.id || "unknown",

					name: chunkAny.name || "unknown",

					input: chunkAny.input || {},
				});
				break;

			case "tool_result":
				// Handle tool result display
				this.showToolResult({
					id: chunkAny.id || "unknown",

					content: chunkAny.content || "",

					isError: chunkAny.isError || false,
				});
				break;

			case "blocked":
				// Handle permission request blocking

				this.showBlockedIndicator(
					chunkAny.content || "Waiting for permission...",
				);
				break;

			case "usage":
				// Handle usage information

				if (chunkAny.usage && typeof chunkAny.usage === "object") {
					const usage = chunkAny.usage as {
						model?: string;
						inputTokens?: number;
						outputTokens?: number;
					};
					if (
						usage.model !== undefined &&
						usage.inputTokens !== undefined
					) {
						console.debug("Token usage:", usage);
						this.showUsageInfo({
							model: usage.model,
							inputTokens: usage.inputTokens,
							outputTokens: usage.outputTokens,
						});
					}
				}
				break;

			case "error":
				throw new Error(chunkAny.content || "Unknown error");
		}
	}

	private showThinkingIndicator(content: string) {
		// Show thinking indicator in the UI
		console.debug("AI is thinking:", content);

		let indicator = this.containerEl.querySelector(
			".opencode-obsidian-thinking-indicator",
		) as HTMLElement;
		if (!indicator) {
			const messagesContainer = this.containerEl.querySelector(
				".opencode-obsidian-messages",
			);
			if (messagesContainer) {
				indicator = messagesContainer.createDiv(
					"opencode-obsidian-thinking-indicator",
				);
			}
		}

		if (indicator) {
			indicator.textContent = `💭 ${content || "Thinking..."}`;
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment
			indicator.style.display = "block";

			// Auto-hide after a delay
			setTimeout(() => {
				if (indicator) {
					// eslint-disable-next-line obsidianmd/no-static-styles-assignment
					indicator.style.display = "none";
				}
			}, 3000);
		}
	}

	private showBlockedIndicator(content: string) {
		// Show blocked indicator
		let indicator = this.containerEl.querySelector(
			".opencode-obsidian-blocked-indicator",
		) as HTMLElement;
		if (!indicator) {
			const header = this.containerEl.querySelector(
				".opencode-obsidian-header",
			);
			if (header) {
				indicator = header.createDiv(
					"opencode-obsidian-blocked-indicator",
				);
			}
		}

		if (indicator) {
			indicator.textContent = `🔒 ${content}`;
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment
			indicator.style.display = "block";
		}
	}

	private hideBlockedIndicator() {
		const indicator = this.containerEl.querySelector(
			".opencode-obsidian-blocked-indicator",
		) as HTMLElement;
		if (indicator) {
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment
			indicator.style.display = "none";
		}
	}

	private showUsageInfo(usage: UsageInfo) {
		// Show usage information in the status bar or as a temporary notice
		const usageText = `${usage.model}: ${usage.inputTokens} tokens`;
		console.debug("Usage:", usageText);

		// Could show this in a status bar or as a brief notice
		// For now, just log it
	}

	private showToolUse(toolUse: ToolUse) {
		// Show tool use in the UI (could be a modal or inline display)
		console.debug("Tool use:", toolUse);
		new Notice(`Using tool: ${toolUse.name}`);
	}

	private showToolResult(toolResult: ToolResult) {
		// Show tool result in the UI
		console.debug("Tool result:", toolResult);
		if (toolResult.isError) {
			new Notice(`Tool error: ${toolResult.content}`);
		}
	}

	private stopStreaming() {
		if (this.currentAbortController) {
			this.currentAbortController.abort();
			this.currentAbortController = null;
		}
		this.abortActiveSession();
		this.isStreaming = false;
		// Only update input area to reflect streaming stopped
		this.updateStreamingStatus(false);
	}

	private abortActiveSession(): void {
		const activeConv = this.getActiveConversation();
		const sessionId = activeConv?.sessionId ?? null;
		const client = this.plugin.opencodeClient;
		if (!sessionId || !client) {
			return;
		}

		void (async () => {
			try {
				await client.abortSession(sessionId);
				if (activeConv) {
					activeConv.sessionId = null;
				}
			} catch (error) {
				this.plugin.errorHandler.handleError(
					error,
					{
						module: "OpenCodeObsidianView",
						function: "abortActiveSession",
						operation: "Aborting session",
						metadata: { sessionId },
					},
					ErrorSeverity.Warning,
				);
			}
		})();
	}

	private async regenerateResponse(message: Message) {
		const activeConv = this.getActiveConversation();
		if (!activeConv) return;

		// Find the user message that preceded this assistant message
		const messageIndex = activeConv.messages.findIndex(
			(m) => m.id === message.id,
		);
		if (messageIndex <= 0) return;

		const userMessage = activeConv.messages[messageIndex - 1];
		if (!userMessage || userMessage.role !== "user") return;

		// Remove the assistant message and regenerate
		activeConv.messages.splice(messageIndex, 1);
		await this.sendMessage(userMessage.content);
	}

	private showAttachmentModal() {
		new AttachmentModal(this.app, (file: File) => {
			void (async () => {
				try {
					const activeConv = this.getActiveConversation();
					if (!activeConv) {
						await this.createNewConversation();
					}

					// Save file to vault's attachments folder (05_Attachments)
					// The path will be sent to OpenCode Client, which will forward it to Plugin layer
					const attachmentsFolder = "05_Attachments";
					const timestamp = Date.now();
					const fileName = `${timestamp}-${file.name}`;
					const filePath = `${attachmentsFolder}/${fileName}`;

					// Ensure attachments folder exists
					const folderExists =
						await this.app.vault.adapter.exists(attachmentsFolder);
					if (!folderExists) {
						await this.app.vault.createFolder(attachmentsFolder);
					}

					// Convert File to ArrayBuffer and save
					const arrayBuffer = await file.arrayBuffer();
					await this.app.vault.createBinary(filePath, arrayBuffer);

					// Get absolute path from vault base path

					const vaultBasePath = (
						this.app.vault.adapter as { basePath?: string }
					).basePath;
					const absolutePath = vaultBasePath
						? `${vaultBasePath}/${filePath}`
						: filePath;

					// Store image path for the next message
					// The path will be sent to OpenCode Client as an image part
					const updatedActiveConv = this.getActiveConversation();
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
					const errorMessage =
						error instanceof Error
							? error.message
							: "Unknown error";
					new Notice(`Failed to save image: ${errorMessage}`);
				}
			})();
		}).open();
	}

	updateConnectionStatus(connected: boolean) {
		// In embedded mode, always connected
		const statusEl = this.containerEl.querySelector(
			".opencode-obsidian-status",
		);
		if (statusEl) {
			statusEl.removeClass("connected", "disconnected");
			statusEl.addClass("connected");
			statusEl.textContent = "● connected.";
		}
	}

	private showToolExecutionIndicator(toolName: string, show: boolean) {
		let indicator = this.containerEl.querySelector(
			".opencode-obsidian-tool-indicator",
		) as HTMLElement;

		if (show) {
			if (!indicator) {
				const header = this.containerEl.querySelector(
					".opencode-obsidian-header",
				);
				if (header) {
					indicator = header.createDiv(
						"opencode-obsidian-tool-indicator",
					);
				}
			}
			if (indicator) {
				indicator.textContent = `🔧 ${toolName}`;
				// eslint-disable-next-line obsidianmd/no-static-styles-assignment
				indicator.style.display = "block";
			}
		} else {
			if (indicator) {
				// eslint-disable-next-line obsidianmd/no-static-styles-assignment
				indicator.style.display = "none";
			}
		}
	}

	private showCompactionIndicator(show: boolean) {
		let indicator = this.containerEl.querySelector(
			".opencode-obsidian-compaction-indicator",
		) as HTMLElement;

		if (show) {
			if (!indicator) {
				const header = this.containerEl.querySelector(
					".opencode-obsidian-header",
				);
				if (header) {
					indicator = header.createDiv(
						"opencode-obsidian-compaction-indicator",
					);
				}
			}
			if (indicator) {
				indicator.textContent = "🗜️ optimizing context…";
				// eslint-disable-next-line obsidianmd/no-static-styles-assignment
				indicator.style.display = "block";
			}
		} else {
			if (indicator) {
				// eslint-disable-next-line obsidianmd/no-static-styles-assignment
				indicator.style.display = "none";
			}
		}
	}

	/**
	 * Incrementally update a single message's content without re-rendering the entire message list.
	 * This is used during streaming to update only the message being streamed.
	 */
	private updateMessageContent(messageId: string, content: string) {
		const messageEl = this.containerEl.querySelector(
			`[data-message-id="${messageId}"]`,
		) as HTMLElement;
		if (!messageEl) {
			// Message element doesn't exist yet, fallback to full update
			// This can happen if the message was just created
			this.updateMessages();
			return;
		}

		const contentEl = messageEl.querySelector(
			".opencode-obsidian-message-content",
		) as HTMLElement;
		if (!contentEl) {
			// Content element doesn't exist, fallback to full update
			this.updateMessages();
			return;
		}

		// Clear existing content and render new content
		// During streaming, this will update the message as tokens arrive
		contentEl.empty();
		this.renderMessageContent(contentEl, content);

		// Auto-scroll to bottom to keep the latest content visible
		const messagesContainer = this.containerEl.querySelector(
			".opencode-obsidian-messages",
		) as HTMLElement;
		if (messagesContainer) {
			// Use requestAnimationFrame to ensure smooth scrolling during rapid updates
			requestAnimationFrame(() => {
				messagesContainer.scrollTop = messagesContainer.scrollHeight;
			});
		}
	}

	/**
	 * Export conversation to Markdown file
	 */
	private async exportConversation(conversationId: string): Promise<void> {
		const conversation = this.conversations.find(
			(c) => c.id === conversationId,
		);
		if (!conversation) {
			new Notice("Conversation not found");
			return;
		}

		try {
			// Format conversation as Markdown
			const lines: string[] = [];

			// Header
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

			// Messages
			lines.push("## Messages");
			lines.push("");

			for (const message of conversation.messages) {
				const timestamp = new Date(message.timestamp).toLocaleString();
				lines.push(`### ${message.role === "user" ? "User" : "Assistant"} - ${timestamp}`);
				lines.push("");
				lines.push(message.content);
				lines.push("");

				// Add images if present
				if (message.images && message.images.length > 0) {
					for (const img of message.images) {
						lines.push(`![${img.name || "Image"}](${img.data.substring(0, 50)}...)`);
						lines.push("");
					}
				}
			}

			const markdownContent = lines.join("\n");

			// Generate filename
			const sanitizedTitle = conversation.title
				.replace(/[<>:"/\\|?*]/g, "_")
				.substring(0, 50);
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const filename = `${sanitizedTitle}-${timestamp}.md`;

			// Save to vault
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
	 * Sync conversations from OpenCode Server
	 * Note: This requires OpenCode Server to support listing sessions
	 */
	private async syncConversationsFromServer(): Promise<void> {
		if (!this.plugin.opencodeClient?.isConnected()) {
			// 如果服务器未连接，且没有会话，创建新会话
			if (this.conversations.length === 0) {
				await this.createNewConversation();
			}
			return;
		}

		try {
			// 1. 从本地存储获取所有保存的 sessionId
			const saved = (await this.plugin.loadData()) as {
				sessionIds?: string[];
			} | null;

			const savedSessionIds = saved?.sessionIds || [];
			const existingSessionIds = new Set(
				this.conversations
					.map((c) => c.sessionId)
					.filter((id): id is string => id !== null && id !== undefined),
			);

			// 2. 尝试从服务器恢复所有保存的 sessionId
			const restoredConversations: Conversation[] = [];

			for (const sessionId of savedSessionIds) {
				// 如果这个 sessionId 已经在 conversations 中，跳过
				if (existingSessionIds.has(sessionId)) {
					continue;
				}

				try {
					// 尝试从服务器获取会话
					const exists = await this.plugin.opencodeClient.ensureSession(
						sessionId,
					);
					if (exists) {
						// 会话存在，创建本地会话对象
						const restoredConv: Conversation = {
							id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
							title: `Restored Session`,
							messages: [], // 消息历史需要从服务器获取（如果 API 支持）
							createdAt: Date.now(),
							updatedAt: Date.now(),
							sessionId: sessionId,
						};
						restoredConversations.push(restoredConv);
						console.debug(
							`[OpenCodeObsidianView] Restored session ${sessionId} from server`,
						);
					}
				} catch (error) {
					// 会话不存在或无法访问，跳过
					console.debug(
						`[OpenCodeObsidianView] Could not restore session ${sessionId}:`,
						error,
					);
				}
			}

			// 3. 将恢复的会话添加到列表
			if (restoredConversations.length > 0) {
				this.conversations.unshift(...restoredConversations);
				// 如果没有活跃会话，设置第一个恢复的会话为活跃
				if (!this.activeConversationId && this.conversations.length > 0) {
					this.activeConversationId = this.conversations[0]?.id ?? null;
				}
				await this.saveConversations();
				this.updateConversationSelector();
				this.updateMessages();
			}

			// 4. 验证现有会话是否仍然存在
			for (const conv of this.conversations) {
				if (conv.sessionId) {
					try {
						const exists = await this.plugin.opencodeClient.ensureSession(
							conv.sessionId,
						);
						if (!exists) {
							console.debug(
								`[OpenCodeObsidianView] Session ${conv.sessionId} no longer exists on server`,
							);
						}
					} catch (error) {
						console.debug(
							`[OpenCodeObsidianView] Could not verify session ${conv.sessionId}:`,
							error,
						);
					}
				}
			}

			// 5. 如果同步后还是没有会话，创建新会话
			if (this.conversations.length === 0) {
				await this.createNewConversation();
			}

			console.debug(
				`[OpenCodeObsidianView] Conversation sync completed. Total: ${this.conversations.length}`,
			);
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "OpenCodeObsidianView",
					function: "syncConversationsFromServer",
					operation: "Syncing conversations from server",
				},
				ErrorSeverity.Warning,
			);
			// 如果同步失败，且没有会话，创建新会话
			if (this.conversations.length === 0) {
				await this.createNewConversation();
			}
		}
	}

	/**
	 * Show context menu for conversation tab
	 */
	private showConversationContextMenu(
		tab: HTMLElement,
		conversationId: string,
		event: MouseEvent,
	): void {
		// Remove existing menu if any
		const existingMenu = document.querySelector(
			".opencode-obsidian-context-menu",
		);
		if (existingMenu) {
			existingMenu.remove();
		}

		const conversation = this.conversations.find(
			(c) => c.id === conversationId,
		);
		if (!conversation) return;

		const menu = document.createElement("div");
		menu.className = "opencode-obsidian-context-menu";
		menu.style.position = "fixed";
		menu.style.left = `${event.clientX}px`;
		menu.style.top = `${event.clientY}px`;
		menu.style.zIndex = "10000";

		// Rename option
		const renameItem = menu.createDiv("opencode-obsidian-context-menu-item");
		renameItem.textContent = "Rename";
		renameItem.onclick = async () => {
			menu.remove();
			// Trigger edit mode by simulating double-click
			const titleEl = tab.querySelector(
				".opencode-obsidian-tab-title",
			) as HTMLElement;
			if (titleEl) {
				titleEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
			}
		};

		// Export option
		const exportItem = menu.createDiv("opencode-obsidian-context-menu-item");
		exportItem.textContent = "Export";
		exportItem.onclick = () => {
			menu.remove();
			void this.exportConversation(conversationId);
		};

		// Delete option
		const deleteItem = menu.createDiv("opencode-obsidian-context-menu-item");
		deleteItem.textContent = "Delete";
		deleteItem.addClass("opencode-obsidian-context-menu-item-danger");
		deleteItem.onclick = () => {
			menu.remove();
			void this.deleteConversation(conversationId);
		};

		document.body.appendChild(menu);

		// Close menu when clicking outside
		const closeMenu = (e: MouseEvent) => {
			if (!menu.contains(e.target as Node)) {
				menu.remove();
				document.removeEventListener("click", closeMenu);
			}
		};

		setTimeout(() => {
			document.addEventListener("click", closeMenu);
		}, 0);
	}

	// TODO: Model display methods removed - models are managed by OpenCode Server
	private getCurrentModelDisplayName(): string {
		return "Model (managed by server)";
	}

	// TODO: Model display methods removed - models are managed by OpenCode Server
}

class AttachmentModal extends Modal {
	private onFileSelect: (file: File) => void;

	constructor(app: App, onFileSelect: (file: File) => void) {
		super(app);
		this.onFileSelect = onFileSelect;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Attach image" });

		const dropZone = contentEl.createDiv("opencode-obsidian-drop-zone");
		dropZone.textContent = "Drop an image here or click to select";

		const fileInput = contentEl.createEl("input", {
			type: "file",
			attr: { accept: "image/*", style: "display: none" },
		});

		// Handle file selection
		const handleFile = (file: File) => {
			if (!file.type.startsWith("image/")) {
				new Notice("Please select an image file");
				return;
			}

			if (file.size > 10 * 1024 * 1024) {
				// 10MB limit
				new Notice("Image file is too large (max 10mb).");
				return;
			}

			this.onFileSelect(file);
			this.close();
		};

		// Click to select
		dropZone.onclick = () => fileInput.click();

		fileInput.onchange = () => {
			const file = fileInput.files?.[0];
			if (file) handleFile(file);
		};

		// Drag and drop
		dropZone.ondragover = (e) => {
			e.preventDefault();
			dropZone.addClass("opencode-obsidian-drop-zone-hover");
		};

		dropZone.ondragleave = () => {
			dropZone.removeClass("opencode-obsidian-drop-zone-hover");
		};

		dropZone.ondrop = (e) => {
			e.preventDefault();
			dropZone.removeClass("opencode-obsidian-drop-zone-hover");

			const file = e.dataTransfer?.files[0];
			if (file) handleFile(file);
		};

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Cancel").onClick(() => this.close()),
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ConfirmationModal extends Modal {
	private title: string;
	private message: string;
	private onConfirm: () => void;

	constructor(
		app: App,
		title: string,
		message: string,
		onConfirm: () => void,
	) {
		super(app);
		this.title = title;
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: this.title });
		contentEl.createEl("p", { text: this.message });

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.close()),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Confirm")
					.setCta()
					.onClick(() => {
						this.onConfirm();
						this.close();
					}),
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
