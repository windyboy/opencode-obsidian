import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type OpenCodeObsidianPlugin from "./main";
import {
	createTextarea,
	hasClass,
	normalizePath,
	parseNumber,
	splitLines,
	splitCommaList,
	normalizeExtension,
} from "./utils/helpers";

export class OpenCodeObsidianSettingTab extends PluginSettingTab {
	plugin: OpenCodeObsidianPlugin;

	constructor(app: App, plugin: OpenCodeObsidianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Ensure opencodeServer config exists with defaults
	 */
	private ensureServerConfig(): NonNullable<
		typeof this.plugin.settings.opencodeServer
	> {
		if (!this.plugin.settings.opencodeServer) {
			this.plugin.settings.opencodeServer = {
				url: "",
				requestTimeoutMs: 10000,
				autoReconnect: true,
				reconnectDelay: 3000,
				reconnectMaxAttempts: 10,
				useEmbeddedServer: false,
				opencodePath: "opencode",
				embeddedServerPort: 4096,
			};
		}
		return this.plugin.settings.opencodeServer;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Main title
		containerEl.createEl("p", {
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			text: "Configure your OpenCode Obsidian plugin settings. Changes are saved automatically.",
			cls: "setting-item-description",
		});

		// Section 1: OpenCode Server configuration
		this.renderServerConfiguration(containerEl);

		// Section 2: Agent configuration
		this.renderAgentConfiguration(containerEl);

		// Section 3: Tool permission configuration
		this.renderToolPermissions(containerEl);

		// Section 4: Advanced settings (collapsible)
		this.renderAdvancedSettings(containerEl);
	}

	/**
	 * Render OpenCode Server configuration section
	 */
	private renderServerConfiguration(containerEl: HTMLElement): void {
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		new Setting(containerEl).setName("OpenCode Server").setHeading();

		containerEl.createEl("p", {
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			text: "Configure connection to OpenCode Server. Providers and API keys are managed on the server side.",
			cls: "setting-item-description",
		});

		// Use embedded server toggle
		const serverConfig = this.ensureServerConfig();
		const embeddedServerEnabled = serverConfig.useEmbeddedServer ?? false;

		new Setting(containerEl)
			.setName("Use embedded server")
			.setDesc("Run OpenCode Server directly within Obsidian (experimental)")
			.addToggle((toggle) => {
				toggle
					.setValue(embeddedServerEnabled)
					.onChange(async (value) => {
						serverConfig.useEmbeddedServer = value;
						await this.plugin.saveSettings();
						// Re-render to show/hide dependent settings
						this.display();
					});
			});

		// Embedded server configuration (only shown when enabled)
		if (embeddedServerEnabled) {
			// Server status display
			const serverStatusSetting = new Setting(containerEl);
			serverStatusSetting.setName("Server Status");
			const statusContainer = serverStatusSetting.controlEl.createDiv("opencode-server-status");
			
			// Update status display
			const updateStatusDisplay = () => {
				statusContainer.empty();
				if (this.plugin.serverManager) {
					const state = this.plugin.serverManager.getState();
					const statusText = statusContainer.createEl("span", {
						text: state.charAt(0).toUpperCase() + state.slice(1),
						cls: `opencode-server-status-${state}`
					});
					
					// Show error details if server is in error state
					if (state === "error") {
						const error = this.plugin.serverManager.getLastError();
						if (error) {
							statusContainer.createEl("span", {
								text: ` - ${error.message}`,
								cls: "opencode-server-status-error-message"
							});
						}
					}
					
					// Add start/stop button based on current state
					const buttonContainer = statusContainer.createDiv("opencode-server-control-buttons");
					if (state === "running") {
						const stopButton = buttonContainer.createEl("button", {
							text: "Stop",
							cls: "mod-danger"
						});
						stopButton.onclick = async () => {
							stopButton.disabled = true;
							stopButton.textContent = "Stopping...";
							this.plugin.serverManager?.stop();
							await this.plugin.saveSettings();
							this.display();
						};
					} else if (state === "stopped" || state === "error") {
						const startButton = buttonContainer.createEl("button", {
							text: "Start",
							cls: "mod-cta"
						});
						startButton.onclick = async () => {
							startButton.disabled = true;
							startButton.textContent = "Starting...";
							if (this.plugin.serverManager) {
								await this.plugin.serverManager.start();
							} else {
								// Reinitialize server manager if it doesn't exist
								this.plugin.serverManager = await import("./embedded-server/ServerManager").then(m => 
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
							}
							await this.plugin.saveSettings();
							this.display();
						};
					}
				} else {
					statusContainer.createEl("span", {
						text: "Not initialized",
						cls: "opencode-server-status-stopped"
					});
					const initializeButton = statusContainer.createEl("button", {
						text: "Initialize",
						cls: "mod-cta"
					});
					initializeButton.onclick = async () => {
						initializeButton.disabled = true;
						initializeButton.textContent = "Initializing...";
						this.plugin.serverManager = await import("./embedded-server/ServerManager").then(m => 
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
						await this.plugin.saveSettings();
						this.display();
					};
				}
			};
			
			updateStatusDisplay();
			
			// Add refresh button to manually update status
			serverStatusSetting.addExtraButton((button) => {
				button
					.setIcon("refresh-cw")
					.setTooltip("Refresh server status")
					.onClick(() => {
						updateStatusDisplay();
					});
			});

			// OpenCode executable path
			new Setting(containerEl)
				.setName("OpenCode executable path")
				.setDesc("Path to the opencode executable (e.g., /usr/local/bin/opencode or C:\\Program Files\\OpenCode\\opencode.exe)")
				.addText((text) => {
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					text.setPlaceholder("opencode")
						.setValue(serverConfig.opencodePath || "opencode");
					text.onChange(async (value: string) => {
						serverConfig.opencodePath = value.trim() || "opencode";
						await this.plugin.debouncedSaveSettings();
					});
			});

			// Embedded server port
			new Setting(containerEl)
				.setName("Embedded server port")
				.setDesc("Port to run the embedded OpenCode Server on")
				.addText((text) => {
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					text.setPlaceholder("4096")
						.setValue((serverConfig.embeddedServerPort || 4096).toString());
					text.inputEl.type = "number";
					text.inputEl.min = "1024";
					text.inputEl.max = "65535";
					text.onChange(async (value: string) => {
						const port = parseInt(value.trim(), 10);
						serverConfig.embeddedServerPort = isNaN(port) || port < 1024 || port > 65535 ? 4096 : port;
						await this.plugin.debouncedSaveSettings();
					});
			});
		} else {
			// External server URL (only shown when embedded server is disabled)
			new Setting(containerEl)
				.setName("Server URL")
				.setDesc(
					"HTTP URL for OpenCode Server (e.g., http://127.0.0.1:4096 or https://opencode.example.com)",
				)
				.addText((text) => {
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					text.setPlaceholder("http://127.0.0.1:4096")
						.setValue(this.plugin.settings.opencodeServer?.url || "")
						.inputEl.classList.add("opencode-setting-url");
					text.onChange(async (value: string) => {
						const trimmedValue = value.trim();
						const serverConfig = this.ensureServerConfig();
						serverConfig.url = trimmedValue;

						// Validate URL format
						if (trimmedValue && !this.isValidHttpUrl(trimmedValue)) {
							text.inputEl.classList.add("mod-invalid");
						} else {
							text.inputEl.classList.remove("mod-invalid");
						}

						await this.plugin.debouncedSaveSettings();
					});
			})
				.addButton((button) => {
					button
						.setButtonText("Test connection")
						.setTooltip("Test connection to the OpenCode server")
						.onClick(async () => {
							button.setDisabled(true);
							button.setButtonText("Testing...");

							const serverConfig = this.ensureServerConfig();
							const url = serverConfig.url.trim();

							if (!url) {
								new Notice("Please enter a server address");
								button.setDisabled(false);
								button.setButtonText("Test connection");
								return;
							}

							if (!this.isValidHttpUrl(url)) {
								new Notice("Invalid HTTP URL");
								button.setDisabled(false);
								button.setButtonText("Test connection");
								return;
							}

							try {
								// Use existing client or create temporary client
								let client = this.plugin.opencodeClient;
								const currentClientUrl = client?.getConfig()?.url;
								const normalizedCurrentUrl = currentClientUrl
									? normalizePath(currentClientUrl)
									: "";
								const normalizedNewUrl = normalizePath(url);

								if (!client || normalizedCurrentUrl !== normalizedNewUrl) {
									// Create temporary client for health check
									const { OpenCodeServerClient } = await import(
					"./client/client"
				);
									client = new OpenCodeServerClient(
										serverConfig,
										this.plugin.errorHandler,
									);
								}

								const isHealthy = await client!.healthCheck();

								if (isHealthy) {
									new Notice("Connection successful");
								} else {
									new Notice(
										"Connection failed: Server health check failed",
									);
								}
							} catch (error) {
								console.error(
									"[OpenCodeSettings] Connection test failed:",
									error,
								);
								const errorMessage = error instanceof Error
									? error.message
									: String(error);
								new Notice(`Connection failed: ${errorMessage}`);
							} finally {
								button.setDisabled(false);
								button.setButtonText("Test connection");
							}
						});
				});
		}
	}

	/**
	 * Render Agent configuration section
	 */
	private renderAgentConfiguration(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Agent configuration").setHeading();

		containerEl.createEl("p", {
			text: "Select the default agent to use for conversations. Custom agents can be loaded from .opencode/agent/ directory.",
			cls: "setting-item-description",
		});

		const agentSetting = new Setting(containerEl)
			.setName("Default agent")
			.setDesc(this.getAgentDescription());

		agentSetting.addDropdown((dropdown) => {
			const defaultAgents: Array<{ id: string; name: string }> = [
				{ id: "assistant", name: "Assistant" },
				{ id: "bootstrap", name: "Bootstrap" },
				{ id: "thinking-partner", name: "Thinking Partner" },
				{ id: "research-assistant", name: "Research Assistant" },
				{ id: "read-only", name: "Read Only" },
			];

			const loadedAgents =
				this.plugin.settings.agents?.filter((a) => !a.hidden) || [];
			const agentsToShow =
				loadedAgents.length > 0 ? loadedAgents : defaultAgents;

			agentsToShow.forEach((agent) => {
				let displayName = agent.name;
				if ("description" in agent && agent.description) {
					const desc =
						typeof agent.description === "string"
							? agent.description
							: JSON.stringify(agent.description);
					displayName = `${agent.name} - ${desc}`;
				}
				dropdown.addOption(agent.id, displayName);
			});

			const currentValue = this.plugin.settings.agent;
			if (agentsToShow.some((a) => a.id === currentValue)) {
				dropdown.setValue(currentValue);
			} else if (agentsToShow.length > 0 && agentsToShow[0]) {
				dropdown.setValue(agentsToShow[0].id);
				this.plugin.settings.agent = agentsToShow[0].id;
				void this.plugin.saveSettings();
			}

			dropdown.onChange(async (value) => {
				this.plugin.settings.agent = value;
				await this.plugin.debouncedSaveSettings();
				agentSetting.setDesc(this.getAgentDescription());
			});
		});

		// Add refresh button
		agentSetting.addButton((button) => {
			button
				.setButtonText("Refresh agents")
				.setTooltip("Fetch latest agents from server")
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText("Refreshing...");

					try {
						if (!this.plugin.opencodeClient) {
							new Notice("OpenCode Server client not configured");
							return;
						}

						const agents = await this.plugin.opencodeClient.listAgents();
						this.plugin.settings.agents = agents;
						await this.plugin.saveSettings();
						this.display(); // Re-render settings
						new Notice("Agents refreshed successfully");
					} catch (error) {
						const errorMessage = error instanceof Error
							? error.message
							: "Unknown error";
						new Notice(`Failed to refresh agents: ${errorMessage}`);
					} finally {
						button.setDisabled(false);
						button.setButtonText("Refresh agents");
					}
				});
		});
	}

	/**
	 * Render tool permission configuration section
	 */
	private renderToolPermissions(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Tool permissions").setHeading();

		containerEl.createEl("p", {
			text: "Configure tool execution permissions for safety. Scoped write allows fine-grained control over file operations.",
			cls: "setting-item-description",
		});

		// Permission level selection
		const permissionLevelSetting = new Setting(containerEl)
			.setName("Permission level")
			.setDesc(this.getPermissionLevelDescription());

		permissionLevelSetting.addDropdown((dropdown) => {
			dropdown
				.addOption("read-only", "Read-only (safest)")
				.addOption("scoped-write", "Scoped write (recommended)")
				.addOption("full-write", "Full write (advanced)")
				.setValue(this.plugin.settings.toolPermission || "read-only")
				.onChange(async (value) => {
					this.plugin.settings.toolPermission = value as
						| "read-only"
						| "scoped-write"
						| "full-write";
					await this.plugin.saveSettings();
					permissionLevelSetting.setDesc(
						this.getPermissionLevelDescription(),
					);

					// If switching to read-only, clear permission scope configuration
					if (value === "read-only") {
						this.plugin.settings.permissionScope = undefined;
					} else if (
						value === "scoped-write" &&
						!this.plugin.settings.permissionScope
					) {
						// Initialize default configuration for scoped-write
						const configDir = this.app.vault.configDir;
						this.plugin.settings.permissionScope = {
							allowedPaths: undefined,
							deniedPaths: [
								`**/${configDir}/**`,
								"**/.git/**",
								"**/node_modules/**",
							],
							maxFileSize: 10485760, // 10MB
							allowedExtensions: [
								".md",
								".txt",
								".json",
								".yaml",
								".yml",
							],
						};
					}

					// Re-render to update permission scope UI visibility
					this.display();
					new Notice("Tool permission level updated");
				});
		});

		// Permission scope configuration (only shown for scoped-write or full-write)
		const showScopeSettings =
			this.plugin.settings.toolPermission === "scoped-write" ||
			this.plugin.settings.toolPermission === "full-write";

		if (showScopeSettings) {
			this.renderPermissionScope(containerEl);
		}
	}

	/**
	 * Render permission scope detailed configuration
	 */
	private renderPermissionScope(containerEl: HTMLElement): void {
		const scope = this.plugin.settings.permissionScope || {};

		// Allowed path patterns
		const allowedPathsSetting = new Setting(containerEl)
			.setName("Allowed paths")
			.setDesc(
				"Glob patterns for allowed paths (e.g., notes/**, docs/*.md). Leave empty to allow all paths (subject to denied paths). One pattern per line.",
			);

		const allowedPathsTextarea = createTextarea({
			className: "opencode-setting-textarea",
			placeholder: "notes/**\ndocs/*.md",
			rows: 3,
			value: scope.allowedPaths?.join("\n") || "",
			onChange: async (value) => {
				if (!this.plugin.settings.permissionScope) {
					this.plugin.settings.permissionScope = {};
				}
				const paths = splitLines(value);
				this.plugin.settings.permissionScope.allowedPaths =
					paths.length > 0 ? paths : undefined;
				await this.plugin.debouncedSaveSettings();
			},
		});
		allowedPathsSetting.controlEl.appendChild(allowedPathsTextarea);

		// Denied path patterns
		const deniedPathsSetting = new Setting(containerEl).setName(
			"Denied paths",
		);
		const configDir = this.app.vault.configDir;
		deniedPathsSetting.setDesc(
			`Glob patterns for denied paths (checked first, always denied). Example: **/${configDir}/**, **/.git/**. One pattern per line.`,
		);

		const deniedPathsTextarea = createTextarea({
			className: "opencode-setting-textarea",
			placeholder: `**/${configDir}/**\n**/.git/**\n**/node_modules/**`,
			rows: 3,
			value: scope.deniedPaths?.join("\n") || "",
			onChange: async (value) => {
				if (!this.plugin.settings.permissionScope) {
					this.plugin.settings.permissionScope = {};
				}
				const paths = splitLines(value);
				this.plugin.settings.permissionScope.deniedPaths =
					paths.length > 0 ? paths : undefined;
				await this.plugin.debouncedSaveSettings();
			},
		});
		deniedPathsSetting.controlEl.appendChild(deniedPathsTextarea);

		// Maximum file size
		const maxFileSizeSetting = new Setting(containerEl);
		maxFileSizeSetting.setName("Maximum file size");
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		maxFileSizeSetting.setDesc(
			"Maximum file size in bytes (e.g., 10485760 for 10MB). Leave empty for no limit.",
		);

		maxFileSizeSetting.addText((text) => {
			const currentValue = scope.maxFileSize;
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			text.setPlaceholder("10485760 (10MB)").setValue(
				currentValue ? currentValue.toString() : "",
			);
			text.inputEl.type = "number";
			text.inputEl.min = "1";
			text.onChange(async (value: string) => {
				if (!this.plugin.settings.permissionScope) {
					this.plugin.settings.permissionScope = {};
				}
				const numValue = parseInt(value.trim(), 10);
				this.plugin.settings.permissionScope.maxFileSize =
					value.trim() && !isNaN(numValue) && numValue > 0
						? numValue
						: undefined;
				await this.plugin.debouncedSaveSettings();
			});
		});

		// Add help button
		maxFileSizeSetting.addExtraButton((button) => {
			button
				.setIcon("help")
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				.setTooltip(
					"Common sizes: 1024 (1KB), 1048576 (1MB), 10485760 (10MB), 104857600 (100MB)",
				)
				.onClick(() => {
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					new Notice(
						"1KB=1024, 1MB=1048576, 10MB=10485760, 100MB=104857600",
					);
				});
		});

		// Allowed file extensions
		const allowedExtensionsSetting = new Setting(containerEl);
		allowedExtensionsSetting.setName("Allowed file extensions");
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		allowedExtensionsSetting.setDesc(
			"Comma-separated list of allowed file extensions (e.g., .md, .txt, .json). Leave empty to allow all extensions.",
		);

		allowedExtensionsSetting.addText((text) => {
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			text.setPlaceholder(".md, .txt, .json, .yaml").setValue(
				scope.allowedExtensions?.join(", ") || "",
			);
			text.onChange(async (value: string) => {
				if (!this.plugin.settings.permissionScope) {
					this.plugin.settings.permissionScope = {};
				}
				const extensions = splitCommaList(value).map(normalizeExtension);
				this.plugin.settings.permissionScope.allowedExtensions =
					extensions.length > 0 ? extensions : undefined;
				await this.plugin.debouncedSaveSettings();
			});
		});

		// Add reset button
		allowedExtensionsSetting.addExtraButton((button) => {
			button
				.setIcon("reset")
				.setTooltip("Reset to default")
				.onClick(() => {
					if (this.plugin.settings.permissionScope) {
						this.plugin.settings.permissionScope.allowedExtensions =
							undefined;
						this.display();
						void this.plugin.saveSettings();
					}
				});
		});
	}

	/**
	 * Render advanced settings section (collapsible)
	 */
	private renderAdvancedSettings(containerEl: HTMLElement): void {
		const advancedSection = containerEl.createDiv(
			"opencode-settings-advanced",
		);

		const header = advancedSection.createDiv(
			"opencode-settings-advanced-header",
		);
		new Setting(header).setName("Advanced").setHeading();

		const toggleButton = header.createEl("button", {
			text: "Show",
			cls: "mod-cta",
		});

		const content = advancedSection.createDiv(
			"opencode-settings-advanced-content",
		);
		content.addClass("hidden");

		toggleButton.onclick = () => {
			const isVisible = !hasClass(content, "hidden");
			if (isVisible) {
				content.addClass("hidden");
			} else {
				content.removeClass("hidden");
			}
			toggleButton.textContent = isVisible ? "Show" : "Hide";
		};

		// Reconnection configuration
		this.renderReconnectionSettings(content);

		// Reset configuration button
		new Setting(content)
			.setName("Reset to defaults")
			.setDesc(
				"Reset all settings to default values. This cannot be undone.",
			)
			.addButton((button) => {
				button
					.setButtonText("Reset")
					.setWarning()
					.onClick(() => {
						// Confirmation dialog can be added here
						new Notice("Reset functionality coming soon");
					});
			});
	}

	/**
	 * Render reconnection settings
	 */
	private renderReconnectionSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Reconnection").setHeading();

		containerEl.createEl("p", {
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			text: "Configure automatic reconnection behavior when connection to OpenCode Server is lost.",
			cls: "setting-item-description",
		});

		// Auto reconnect toggle
		new Setting(containerEl)
			.setName("Auto reconnect")
			.setDesc(
				"Automatically attempt to reconnect when connection is lost",
			)
			.addToggle((toggle) => {
				toggle
					.setValue(
						this.plugin.settings.opencodeServer?.autoReconnect ??
							true,
					)
					.onChange(async (value) => {
						const serverConfig = this.ensureServerConfig();
						serverConfig.autoReconnect = value;
						await this.plugin.saveSettings();
					});
			});

		// Reconnect delay
		new Setting(containerEl)
			.setName("Reconnect delay")
			.setDesc(
				"Delay between reconnection attempts in milliseconds (default: 3000ms, with exponential backoff)",
			)
			.addText((text) => {
				const delay =
					this.plugin.settings.opencodeServer?.reconnectDelay ?? 3000;
				text.setPlaceholder("3000").setValue(delay.toString());
				text.inputEl.type = "number";
				text.inputEl.min = "1000";
				text.onChange(async (value: string) => {
					const serverConfig = this.ensureServerConfig();
					serverConfig.reconnectDelay = parseNumber(value, 3000, 1000);
					await this.plugin.debouncedSaveSettings();
				});
			});

		// Max reconnect attempts
		new Setting(containerEl)
			.setName("Max reconnect attempts")
			.setDesc(
				"Maximum number of reconnection attempts (0 = unlimited, default: 10)",
			)
			.addText((text) => {
				const maxAttempts =
					this.plugin.settings.opencodeServer?.reconnectMaxAttempts ??
					10;
				text.setPlaceholder("10").setValue(
					maxAttempts === 0 ? "0" : maxAttempts.toString(),
				);
				text.inputEl.type = "number";
				text.inputEl.min = "0";
				text.onChange(async (value: string) => {
					const serverConfig = this.ensureServerConfig();
					serverConfig.reconnectMaxAttempts = parseNumber(value, 10, 0);
					await this.plugin.debouncedSaveSettings();
				});
			});

		// Request timeout
		new Setting(containerEl)
			.setName("Request timeout")
			.setDesc(
				"Maximum time to wait for HTTP requests in milliseconds (0 = no timeout, default: 10000)",
			)
			.addText((text) => {
				const timeoutMs =
					this.plugin.settings.opencodeServer?.requestTimeoutMs ?? 10000;
				text.setPlaceholder("10000").setValue(timeoutMs.toString());
				text.inputEl.type = "number";
				text.inputEl.min = "0";
				text.onChange(async (value: string) => {
					const serverConfig = this.ensureServerConfig();
					serverConfig.requestTimeoutMs = parseNumber(value, 10000, 0);
					await this.plugin.debouncedSaveSettings();
				});
			});
	}

	/**
	 * Helper method: Validate HTTP URL format
	 */
	private isValidHttpUrl(url: string): boolean {
		try {
			const parsed = new URL(url);
			return parsed.protocol === "http:" || parsed.protocol === "https:";
		} catch {
			return false;
		}
	}

	/**
	 * Get Agent description text
	 */
	private getAgentDescription(): string {
		const agentCount =
			this.plugin.settings.agents?.filter((a) => !a.hidden).length || 0;
		if (agentCount > 0) {
			return `The default agent to use for conversations. ${agentCount} custom agent(s) loaded from .opencode/agent/ directory.`;
		}
		return "The default agent to use for conversations. Create custom agents in .opencode/agent/ directory.";
	}

	/**
	 * Get permission level description text
	 */
	private getPermissionLevelDescription(): string {
		const level = this.plugin.settings.toolPermission || "read-only";
		switch (level) {
			case "read-only":
				return "Tools can only read files. No write, create, modify, or delete operations are allowed. (Safest option)";
			case "scoped-write":
				return "Tools can write to files within specified paths. Configure allowed/denied paths, file size limits, and extensions below. (Recommended)";
			case "full-write":
				return "Tools can write to all files (with minimal safety restrictions). Use with caution. (Advanced users only)";
			default:
				return "Control what tools can do.";
		}
	}
}
