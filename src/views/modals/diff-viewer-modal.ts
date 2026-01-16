import { Modal, App, MarkdownRenderer } from "obsidian";
import type { SessionDiff, FileDiff } from "../../types";

/**
 * Modal for displaying session file diffs
 * Shows all file changes made during a session with syntax highlighting
 */
export class DiffViewerModal extends Modal {
	private sessionDiff: SessionDiff;

	constructor(app: App, sessionDiff: SessionDiff) {
		super(app);
		this.sessionDiff = sessionDiff;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("opencode-diff-viewer");

		// Header
		contentEl.createEl("h2", { text: "Session Changes" });

		// Check if there are any changes
		if (!this.sessionDiff.files || this.sessionDiff.files.length === 0) {
			contentEl.createEl("p", {
				text: "No file modifications",
				cls: "opencode-diff-empty",
			});
			return;
		}

		// Render each file diff
		for (const fileDiff of this.sessionDiff.files) {
			this.renderFileDiff(contentEl, fileDiff);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	/**
	 * Render a single file diff
	 */
	private renderFileDiff(container: HTMLElement, fileDiff: FileDiff): void {
		const fileContainer = container.createDiv("opencode-diff-file");

		// File path header
		const fileHeader = fileContainer.createDiv("opencode-diff-file-header");
		fileHeader.createEl("strong", { text: fileDiff.path });

		// Diff content container
		const diffContent = fileContainer.createDiv("opencode-diff-content");

		// Show removed lines
		if (fileDiff.removed && fileDiff.removed.length > 0) {
			const removedSection = diffContent.createDiv("opencode-diff-section");
			removedSection.createEl("div", {
				text: `- ${fileDiff.removed.length} line${fileDiff.removed.length === 1 ? "" : "s"} removed`,
				cls: "opencode-diff-section-header removed",
			});

			this.renderCodeBlock(
				removedSection,
				fileDiff.removed.join("\n"),
				fileDiff.language,
				"removed",
			);
		}

		// Show added lines
		if (fileDiff.added && fileDiff.added.length > 0) {
			const addedSection = diffContent.createDiv("opencode-diff-section");
			addedSection.createEl("div", {
				text: `+ ${fileDiff.added.length} line${fileDiff.added.length === 1 ? "" : "s"} added`,
				cls: "opencode-diff-section-header added",
			});

			this.renderCodeBlock(
				addedSection,
				fileDiff.added.join("\n"),
				fileDiff.language,
				"added",
			);
		}
	}

	/**
	 * Render a code block with syntax highlighting using Obsidian's markdown renderer
	 */
	private renderCodeBlock(
		container: HTMLElement,
		code: string,
		language: string | undefined,
		diffType: "added" | "removed",
	): void {
		const codeBlock = container.createEl("pre", {
			cls: `opencode-diff-code ${diffType}`,
		});
		const codeEl = codeBlock.createEl("code");

		if (language) {
			codeEl.addClass(`language-${language}`);
		}

		codeEl.textContent = code;

		// Add copy button
		this.addCopyButton(codeBlock, code);
	}

	/**
	 * Add copy button to code block
	 */
	private addCopyButton(codeBlock: HTMLElement, code: string): void {
		const actions = codeBlock.createDiv("opencode-diff-code-actions");

		const copyBtn = actions.createEl("button", {
			text: "Copy",
			cls: "opencode-diff-code-copy",
		});

		copyBtn.onclick = async () => {
			try {
				await navigator.clipboard.writeText(code);
				copyBtn.textContent = "Copied!";
				setTimeout(() => {
					copyBtn.textContent = "Copy";
				}, 2000);
			} catch (error) {
				console.error("Failed to copy code:", error);
			}
		};
	}
}
