import { MarkdownRenderer, Notice, ItemView } from "obsidian";
import type { Message } from "../../types";
import type OpenCodeObsidianPlugin from "../../main";
import { ErrorSeverity } from "../../utils/error-handler";

export class MessageRendererComponent {
	constructor(
		private plugin: OpenCodeObsidianPlugin,
		private view: ItemView,
	) {}

	renderMessageContent(container: HTMLElement, content: string): void {
		const lines = content.split("\n");
		let inCodeBlock = false;
		let codeBlockLanguage = "";
		let codeBlockContent: string[] = [];
		let textBeforeCodeBlock = "";

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;

			if (line.startsWith("```")) {
				if (inCodeBlock) {
					inCodeBlock = false;
					if (textBeforeCodeBlock.trim()) {
						const textContainer = container.createDiv(
							"opencode-obsidian-markdown-text",
						);
						void MarkdownRenderer.render(
							this.plugin.app,
							textBeforeCodeBlock.trim(),
							textContainer,
							"",
							this.view,
						);
						textBeforeCodeBlock = "";
					}
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
					inCodeBlock = true;
					codeBlockLanguage = line.slice(3).trim();
				}
			} else if (inCodeBlock) {
				codeBlockContent.push(line);
			} else {
				textBeforeCodeBlock += (textBeforeCodeBlock ? "\n" : "") + line;
			}
		}

		if (inCodeBlock && codeBlockContent.length > 0) {
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
				this.view,
			);
		}
	}

	private addCodeBlockActions(codeBlock: HTMLElement, code: string): void {
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

	addMessageActions(
		messageEl: HTMLElement,
		message: Message,
		onRegenerate?: (message: Message) => void,
	): void {
		const actions = messageEl.createDiv(
			"opencode-obsidian-message-actions",
		);

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

		if (message.role === "assistant" && onRegenerate) {
			const regenBtn = actions.createEl("button", {
				text: "🔄",
				cls: "opencode-obsidian-message-action",
				attr: { title: "Regenerate response" },
			});

			regenBtn.onclick = () => {
				void onRegenerate(message);
			};
		}
	}
}
