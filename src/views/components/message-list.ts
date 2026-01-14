import type { Message, Conversation } from "../../types";
import { MessageRendererComponent } from "./message-renderer";

export class MessageListComponent {
	private messageRenderer: MessageRendererComponent;

	constructor(
		messageRenderer: MessageRendererComponent,
		private getActiveConversation: () => Conversation | null,
		private onRegenerate?: (message: Message) => void,
	) {
		this.messageRenderer = messageRenderer;
	}

	render(container: HTMLElement): void {
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

		container.scrollTop = container.scrollHeight;
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

		this.messageRenderer.addMessageActions(messageEl, message, this.onRegenerate);
	}

}
