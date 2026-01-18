import { App, Modal, Setting, Notice } from "obsidian";
import type OpenCodeObsidianPlugin from "../../main";

/**
 * Modal window that prompts user to start OpenCode server when not running
 */
export class ServerStartModal extends Modal {
	private plugin: OpenCodeObsidianPlugin;

	constructor(app: App, plugin: OpenCodeObsidianPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;

		// Modal title
		contentEl.createEl("h2", { text: "OpenCode Server Not Running" });

		// Modal content
		contentEl.createEl("p", {
			text: "The OpenCode server is not currently running. You need to start it to use the plugin features.",
			cls: "setting-item-description"
		});

		contentEl.createEl("p", {
			text: "Would you like to start the OpenCode server now?",
			cls: "setting-item-description"
		});

		// Action buttons
		const buttonContainer = contentEl.createDiv("opencode-server-start-buttons");

		// Start button
		const startButton = buttonContainer.createEl("button", {
			text: "Start Server",
			cls: "mod-cta"
		});

		// Configure button
		const configureButton = buttonContainer.createEl("button", {
			text: "Configure",
			cls: "mod-button"
		});

		// Cancel button
		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
			cls: "mod-button"
		});

		// Button handlers
		startButton.onclick = async () => {
			startButton.disabled = true;
			startButton.textContent = "Starting...";

			try {
				if (!this.plugin.serverManager) {
					// Initialize server manager if it doesn't exist
					if (this.plugin.settings.opencodeServer) {
						const serverConfig = this.plugin.settings.opencodeServer;
						this.plugin.serverManager = await import("../../embedded-server/ServerManager").then(m => 
							m.ServerManager.initializeFromConfig(
								serverConfig,
								this.plugin.errorHandler,
								(event) => this.plugin.handleServerStateChange(event),
								async (url) => {
									serverConfig.url = url;
									await this.plugin.saveSettings();
								}
							)
						);
					} else {
						new Notice("Server configuration not found");
						this.close();
						return;
					}
				} else {
					// Start the server if it's already initialized
					await this.plugin.serverManager.start();
				}

				// Verify server started successfully
				const serverState = this.plugin.serverManager?.getState();
				if (serverState === "running") {
					new Notice("OpenCode server started successfully");
					this.close();
				} else {
					new Notice("Failed to start OpenCode server. Please check the configuration.");
					this.close();
				}
			} catch (error) {
				console.error("Failed to start OpenCode server:", error);
				new Notice(`Failed to start server: ${error instanceof Error ? error.message : "Unknown error"}`);
				this.close();
			}
		};

		configureButton.onclick = () => {
			this.close();
			// Open settings tab to server configuration
			// For simplicity, we'll just show a notice since opening settings programmatically
			// requires more complex API usage that might not be available in all Obsidian versions
			new Notice("Please open settings manually to configure the server.");
		};

		cancelButton.onclick = () => {
			this.close();
			new Notice("OpenCode server not started. Plugin features will be limited.");
		};

		// Style buttons
		buttonContainer.style.display = "flex";
		buttonContainer.style.gap = "8px";
		buttonContainer.style.justifyContent = "flex-end";
		buttonContainer.style.marginTop = "16px";
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
