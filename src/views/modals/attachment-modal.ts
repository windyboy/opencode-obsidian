import { Modal, Setting, Notice, App } from "obsidian";
import { empty } from "../../utils/dom-helpers";

export class AttachmentModal extends Modal {
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
		empty(contentEl);
	}
}
