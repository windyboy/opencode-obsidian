import type { Message, ImageAttachment, Conversation } from "../../types";
import type OpenCodeObsidianPlugin from "../../main";
import type { SessionManager } from "./session-manager";
import { Notice, TFile, App } from "obsidian";
import { ErrorSeverity } from "../../utils/error-handler";

interface SlashCommand {
	command: string;
	args: string;
}

interface UsageInfo {
	model: string;
	inputTokens: number;
	outputTokens?: number;
}

interface ToolUse {
	id: string;
	name: string;
	input: unknown;
}

interface ToolResult {
	id: string;
	content: string;
	isError: boolean;
}

export class MessageSender {
	private isStreaming = false;
	private currentAbortController: AbortController | null = null;

	constructor(
		private plugin: OpenCodeObsidianPlugin,
		private app: App,
		private getActiveConversation: () => Conversation | null,
		private createNewConversation: () => Promise<void>,
		private parseSlashCommand: (content: string) => SlashCommand | null,
		private setIsStreaming: (value: boolean) => void,
		private setCurrentAbortController: (controller: AbortController | null) => void,
		private updateMessages: () => void,
		private updateStreamingStatus: (isStreaming: boolean) => void,
		private saveConversations: () => Promise<void>,
		private generateConversationTitle: (conversationId: string) => Promise<void>,
		private showThinkingIndicator: (content: string) => void,
		private showBlockedIndicator: (content: string) => void,
		private showUsageInfo: (usage: UsageInfo) => void,
		private showToolUse: (toolUse: ToolUse) => void,
		private showToolResult: (toolResult: ToolResult) => void,
		private sessionManager?: SessionManager,
	) {}

	async sendMessage(content: string): Promise<void> {
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

		this.currentAbortController = new AbortController();
		this.setCurrentAbortController(this.currentAbortController);
		this.setStreamingState(true);
		this.updateMessages();

		try {
			if (!this.plugin.opencodeClient) {
				throw new Error(
					"OpenCode Server client not initialized. Please check settings.",
				);
			}

			// Ensure client is connected
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

						const mimeTypes: Record<string, string> = {
							jpg: "image/jpeg",
							jpeg: "image/jpeg",
							gif: "image/gif",
							webp: "image/webp",
						};
						const mimeType = mimeTypes[file.extension.toLowerCase()] || "image/png";

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
				}

				activeConv.pendingImagePath = undefined;
			}

			// Get or create session ID using SessionManager
			let sessionId = activeConv.sessionId || this.plugin.opencodeClient?.getCurrentSessionId() || null;

			// Ensure session exists on server before sending message
			sessionId = await this.ensureSession(activeConv, sessionId);

			// Send message or command to OpenCode Server
			if (!this.plugin.opencodeClient) {
				throw new Error("OpenCode Server client not initialized");
			}
			
			const sendWithRetry = async (currentSessionId: string): Promise<void> => {
				if (!this.plugin.opencodeClient) return;
				
				if (slashCommand) {
					const commandResponse = await this.plugin.opencodeClient.sendSessionCommand(
						currentSessionId,
						slashCommand.command,
						slashCommand.args,
						this.plugin.settings.agent,
					);
					assistantMessage.content = commandResponse ?? "Command executed.";
					this.setStreamingState(false);
					this.updateMessages();
				} else {
					await this.plugin.opencodeClient.sendSessionMessage(currentSessionId, content, images);
				}
			};

			try {
				await sendWithRetry(sessionId);
			} catch (sendError) {
				// Handle session not found errors by creating new session and retrying
				const errorText = sendError instanceof Error ? sendError.message : "";
				if (errorText.includes("Session") && errorText.includes("not found")) {
					console.debug("[MessageSender] Session not found, creating new session and retrying");
					activeConv.sessionId = null;
					const refreshedSessionId = await this.createServerSession(activeConv);
					await sendWithRetry(refreshedSessionId);
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
			this.setStreamingState(false);
		} finally {
			if (!this.isStreaming) {
				this.currentAbortController = null;
				this.setCurrentAbortController(null);
				activeConv.updatedAt = Date.now();
				await this.saveConversations();
				this.updateMessages();

				if (
					activeConv.messages.length >= 2 &&
					(activeConv.title === "New Chat" ||
						activeConv.title.startsWith("Chat "))
				) {
					setTimeout(() => {
						void this.generateConversationTitle(activeConv.id);
					}, 1000);
				}
			}
		}
	}

	private setStreamingState(value: boolean): void {
		this.isStreaming = value;
		this.setIsStreaming(value);
		this.updateStreamingStatus(value);
	}

	/**
	 * Ensure session exists on server, creating one if necessary
	 * Handles session verification and creation with retry logic
	 */
	private async ensureSession(
		conversation: Conversation,
		sessionId: string | null,
	): Promise<string> {
		// If no sessionId, create a new session
		if (!sessionId) {
			return await this.createServerSession(conversation);
		}

		// Verify session exists on server
		if (this.plugin.opencodeClient) {
			const hasSession = await this.plugin.opencodeClient.ensureSession(sessionId);
			if (!hasSession) {
				// Session not found on server, create new one
				conversation.sessionId = null;
				return await this.createServerSession(conversation);
			}
		}

		return sessionId;
	}

	/**
	 * Create a new session on the server using SessionManager or fallback to client
	 */
	private async createServerSession(conversation: Conversation): Promise<string> {
		if (!this.plugin.opencodeClient) {
			throw new Error("OpenCode Server client not initialized");
		}

		try {
			let newSessionId: string;

			// Use SessionManager if available for proper session management
			if (this.sessionManager && this.plugin.opencodeClient.isConnected()) {
				newSessionId = await this.sessionManager.createSession(conversation.title);
			} else {
				// Fallback to direct client call for backward compatibility
				const activeFile = this.app.workspace.getActiveFile();
				const sessionContext = activeFile
					? {
							currentNote: activeFile.path,
							properties:
								this.app.metadataCache.getFileCache(activeFile)
									?.frontmatter,
						}
					: undefined;

				newSessionId = await this.plugin.opencodeClient.startSession(
					sessionContext,
					this.plugin.settings.agent,
					this.plugin.settings.instructions,
				);
			}

			// Update conversation with new sessionId
			conversation.sessionId = newSessionId;
			await this.saveConversations();

			console.debug("[MessageSender] Created new session:", newSessionId);
			return newSessionId;
		} catch (sessionError) {
			const errorMsg = sessionError instanceof Error ? sessionError.message : "Unknown error";
			this.plugin.errorHandler.handleError(
				sessionError,
				{
					module: "MessageSender",
					function: "createServerSession",
					operation: "Creating server session",
				},
			);
			if (
				errorMsg.includes("Unable to connect") ||
				errorMsg.includes("Failed to create session") ||
				errorMsg.includes("Failed to start session")
			) {
				throw sessionError;
			}
			throw new Error(`Failed to create session: ${errorMsg}`);
		}
	}

	async handleResponseChunk(chunk: unknown, message: Message): Promise<void> {
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
				break;

			case "thinking":
				this.showThinkingIndicator(chunkAny.content || "");
				break;

			case "tool_use":
				this.showToolUse({
					id: chunkAny.id || "unknown",
					name: chunkAny.name || "unknown",
					input: chunkAny.input || {},
				});
				break;

			case "tool_result":
				this.showToolResult({
					id: chunkAny.id || "unknown",
					content: chunkAny.content || "",
					isError: chunkAny.isError || false,
				});
				break;

			case "blocked":
				this.showBlockedIndicator(
					chunkAny.content || "Waiting for permission...",
				);
				break;

			case "usage":
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

	stopStreaming(): void {
		if (this.currentAbortController) {
			this.currentAbortController.abort();
			this.currentAbortController = null;
			this.setCurrentAbortController(null);
		}
		this.abortActiveSession();
		this.setStreamingState(false);
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

	async regenerateResponse(message: Message): Promise<void> {
		const activeConv = this.getActiveConversation();
		if (!activeConv) return;

		const messageIndex = activeConv.messages.findIndex(
			(m) => m.id === message.id,
		);
		if (messageIndex <= 0) return;

		const userMessage = activeConv.messages[messageIndex - 1];
		if (!userMessage || userMessage.role !== "user") return;

		activeConv.messages.splice(messageIndex, 1);
		await this.sendMessage(userMessage.content);
	}

	getIsStreaming(): boolean {
		return this.isStreaming;
	}
}
