import type { Message, Conversation } from "../../types";
import { MessageRendererComponent } from "./message-renderer";

export class MessageListComponent {
	private messageRenderer: MessageRendererComponent;

	constructor(
		messageRenderer: MessageRendererComponent,
		private getActiveConversation: () => Conversation | null,
		private onRegenerate?: (message: Message) => void,
		private getScrollPosition?: (conversationId: string) => number | undefined,
		private getIsLoading?: () => boolean,
		private onRevert?: (message: Message) => void,
		private onUnrevert?: () => void,
		private onFork?: (conversationId: string, messageId: string) => void,
	) {
		this.messageRenderer = messageRenderer;
	}

	render(container: HTMLElement): void {
		container.empty();

		const isLoading = this.getIsLoading?.() ?? false;

		// Show loading overlay if loading
		if (isLoading) {
			const overlay = container.createDiv("opencode-obsidian-loading-overlay");
			const loadingMessage = overlay.createDiv("opencode-obsidian-loading-message");
			loadingMessage.createSpan("opencode-obsidian-spinner");
			loadingMessage.createSpan({ text: "Loading conversation..." });
			return;
		}

		const activeConv = this.getActiveConversation();
		if (!activeConv || activeConv.messages.length === 0) {
			container.createDiv(
				"opencode-obsidian-empty-messages",
			).textContent = "Start a conversation...";
			return;
		}

		// Check if there are any reverted messages
		const hasRevertedMessages = activeConv.messages.some(m => m.isReverted);

		activeConv.messages.forEach((message) => {
			// Skip rendering reverted messages
			if (message.isReverted) {
				return;
			}
			this.renderMessage(container, message);
		});

		// Show indicator if there are reverted messages
		if (hasRevertedMessages) {
			const revertedIndicator = container.createDiv("opencode-obsidian-reverted-indicator");
			revertedIndicator.createSpan({ text: "⚠️ Some messages have been reverted and are hidden" });
			
			if (this.onUnrevert) {
				const unrevertBtn = revertedIndicator.createEl("button", {
					text: "Unrevert all",
					cls: "opencode-obsidian-unrevert-button",
				});
				unrevertBtn.onclick = () => {
					void this.onUnrevert?.();
				};
			}
		}

		// Restore scroll position if available
		const savedScrollPosition = this.getScrollPosition?.(activeConv.id);
		if (savedScrollPosition !== undefined && savedScrollPosition > 0) {
			requestAnimationFrame(() => {
				container.scrollTop = savedScrollPosition;
			});
		} else {
			// Default: scroll to bottom for new conversations
			container.scrollTop = container.scrollHeight;
		}
	}

	private renderMessage(container: HTMLElement, message: Message): void {
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

		if (typeof message.content === "string") {
			this.messageRenderer.renderMessageContent(content, message.content);
		} else {
			content.createDiv().textContent = JSON.stringify(
				message.content,
				null,
				2,
			);
		}

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

		const activeConv = this.getActiveConversation();
		const onForkMessage = this.onFork && activeConv
			? (msg: Message) => this.onFork?.(activeConv.id, msg.id)
			: undefined;

		this.messageRenderer.addMessageActions(
			messageEl,
			message,
			this.onRegenerate,
			this.onRevert,
			onForkMessage,
			activeConv?.id,
		);
	}

}
