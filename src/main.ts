import { Plugin, Notice } from "obsidian";
import {
	OpenCodeObsidianView,
	VIEW_TYPE_OPENCODE_OBSIDIAN,
} from "./views/opencode-obsidian-view";
import { OpenCodeObsidianSettingTab } from "./settings";
import type { OpenCodeObsidianSettings, Agent } from "./types";
import { UI_CONFIG } from "./utils/constants";
import { ErrorHandler, ErrorSeverity } from "./utils/error-handler";
import { debounceAsync } from "./utils/helpers";
import { initializeClient, reinitializeClient } from "./client/initializer";
import { OpenCodeServerClient } from "./client/client";
import { ObsidianToolRegistry } from "./tools/obsidian/tool-registry";
import { ObsidianToolExecutor } from "./tools/obsidian/tool-executor";
import { PermissionManager } from "./tools/obsidian/permission-manager";
import { AuditLogger } from "./tools/obsidian/audit-logger";
import { ToolPermission } from "./tools/obsidian/types";
import type { PermissionScope } from "./tools/obsidian/permission-types";
import { ConnectionManager } from "./session/connection-manager";
import { SessionEventBus } from "./session/session-event-bus";
import { PermissionCoordinator } from "./tools/obsidian/permission-coordinator";
import { ServerManager } from "./embedded-server/ServerManager";
import { ServerStateChangeEvent } from "./embedded-server/types";
import { TodoManager } from "./todo/todo-manager";
import { TodoListComponent } from "./todo/todo-list-component";

/**
 * Maps string permission level settings to ToolPermission enum values
 */
const PERMISSION_LEVEL_MAP: Record<string, ToolPermission> = {
	"read-only": ToolPermission.ReadOnly,
	"scoped-write": ToolPermission.ScopedWrite,
	"full-write": ToolPermission.FullWrite,
};

/**
 * Convert string permission level to ToolPermission enum
 */
function getPermissionLevel(level: string | undefined): ToolPermission {
	return (
		PERMISSION_LEVEL_MAP[level || "read-only"] ?? ToolPermission.ReadOnly
	);
}

/**
 * Convert settings permission scope to PermissionScope type
 * Returns undefined if no scope is configured
 */
function toPermissionScope(
	scope: OpenCodeObsidianSettings["permissionScope"],
): PermissionScope | undefined {
	if (!scope) return undefined;
	return {
		allowedPaths: scope.allowedPaths,
		deniedPaths: scope.deniedPaths,
		maxFileSize: scope.maxFileSize,
		allowedExtensions: scope.allowedExtensions,
	} as PermissionScope;
}

/**
 * Default OpenCode Server configuration
 */
const DEFAULT_SERVER_CONFIG = {
	url: "",
	requestTimeoutMs: 10000,
	autoReconnect: true,
	reconnectDelay: 3000,
	reconnectMaxAttempts: 10,
	useEmbeddedServer: false,
	opencodePath: "opencode",
	embeddedServerPort: 4096,
} as const;

const DEFAULT_SETTINGS: OpenCodeObsidianSettings = {
	agent: "assistant",
	instructions: [],
	opencodeServer: { ...DEFAULT_SERVER_CONFIG },
	toolPermission: "read-only",
	permissionScope: undefined,
};

export default class OpenCodeObsidianPlugin extends Plugin {
	settings: OpenCodeObsidianSettings;
	errorHandler: ErrorHandler;
	opencodeClient: OpenCodeServerClient | null = null;
	connectionManager: ConnectionManager | null = null;
	sessionEventBus = new SessionEventBus();
	toolRegistry: ObsidianToolRegistry | null = null;
	permissionManager: PermissionManager | null = null;
	permissionCoordinator: PermissionCoordinator | null = null;
	serverManager: ServerManager | null = null;
	todoManager: TodoManager | null = null;
	todoListComponent: TodoListComponent | null = null;



	async onload() {
		console.debug("[OpenCode Obsidian] Plugin loading...");

		try {
			// Initialize error handler with Obsidian Notice integration
			this.errorHandler = new ErrorHandler({
				showUserNotifications: true,
				logToConsole: true,
				collectErrors: false,
				notificationCallback: (
					message: string,
					severity: ErrorSeverity,
				) => {
					new Notice(
						message,
						severity === ErrorSeverity.Critical ? 10000 : 5000,
					);
				},
			});
			console.debug("[OpenCode Obsidian] Error handler initialized");

			await this.loadSettings();

			// Migrate old settings format if needed
			this.migrateSettings();

			console.debug("[OpenCode Obsidian] Settings loaded:", {
				agent: this.settings.agent,
				opencodeServer:
					this.settings.opencodeServer?.url || "not configured",
				useEmbeddedServer: this.settings.opencodeServer?.useEmbeddedServer,
			});

			// Initialize tool execution layer
			try {
				if (this.app && this.app.vault) {
					this.permissionManager = new PermissionManager(
						this.app.vault,
						getPermissionLevel(this.settings.toolPermission),
						toPermissionScope(this.settings.permissionScope),
					);

					const auditLogger = new AuditLogger(this.app.vault);

					const toolExecutor = new ObsidianToolExecutor(
						this.app.vault,
						this.app,
						this.app.metadataCache,
						this.permissionManager,
						auditLogger,
					);

					this.toolRegistry = new ObsidianToolRegistry(
						toolExecutor,
						this.app,
					);

					// Initialize server (external or embedded)
					if (this.settings.opencodeServer) {
						const serverConfig = this.settings.opencodeServer;
						try {
							this.serverManager = await ServerManager.initializeFromConfig(
								serverConfig,
								this.errorHandler,
								(event) => this.handleServerStateChange(event),
								undefined
							);
						} catch (error) {
							this.errorHandler.handleError(
								error,
								{
									module: "OpenCodeObsidianPlugin",
									function: "onload",
									operation: "Server initialization",
								},
								ErrorSeverity.Warning,
							);
							// Continue loading plugin even if server initialization fails
						}
					}

					// Initialize OpenCode Server client if conditions are met
					const opencodeServer = this.settings.opencodeServer;
					if (opencodeServer) {
						const useEmbeddedServer = opencodeServer.useEmbeddedServer;
						const hasServerUrl = opencodeServer.url;
						const embeddedServerReady = useEmbeddedServer && this.serverManager && this.serverManager.getState() === "running";
						const externalServerConfigured = !useEmbeddedServer && hasServerUrl;

						// Only initialize client if:
						// 1. Using embedded server and serverManager is ready and running, OR
						// 2. Using external server and URL is configured
						if ((embeddedServerReady || externalServerConfigured) && hasServerUrl) {
							const clientSetup = await initializeClient(
					opencodeServer,
					this.errorHandler,
					this.sessionEventBus,
					this.permissionManager,
					auditLogger,
					this.app,
					async (agents: Agent[]) => {
						// Only save if agents have actually changed to avoid infinite loop
						const agentsChanged = JSON.stringify(this.settings.agents) !== JSON.stringify(agents);
						if (agentsChanged) {
							this.settings.agents = agents;
							await this.saveSettings();
						}
					},
					() => this.getDefaultAgents()
				);

							if (clientSetup) {
								this.opencodeClient = clientSetup.client;
								this.connectionManager = clientSetup.connectionManager;
								this.permissionCoordinator = clientSetup.permissionCoordinator;
							}
						}
					}
				}
			} catch (error) {
				this.errorHandler.handleError(
					error,
					{
						module: "OpenCodeObsidianPlugin",
						function: "onload",
						operation: "Initializing tool execution layer",
					},
					ErrorSeverity.Warning,
				);
				// Continue loading plugin even if tool execution layer fails
			}

			// Initialize Todo Manager
			try {
				this.todoManager = new TodoManager({}, this.errorHandler);
				console.debug("[OpenCode Obsidian] Todo Manager initialized");
			} catch (error) {
				this.errorHandler.handleError(
					error,
					{ module: "OpenCodeObsidianPlugin", function: "onload" },
					ErrorSeverity.Warning
				);
			}

			// Register the main view
			this.registerView(
				VIEW_TYPE_OPENCODE_OBSIDIAN,
				(leaf) => new OpenCodeObsidianView(leaf, this),
			);

			// Add ribbon icon
			this.addRibbonIcon("bot", "Open opencode", () => {
				void this.activateView();
			});

			// Add command to open view
			this.addCommand({
				id: "open-view",
				name: "Open chat view",
				callback: () => {
					void this.activateView();
				},
			});

			// Add command to create new conversation
			this.addCommand({
				id: "new-conversation",
				name: "New conversation",
				hotkeys: [{ modifiers: ["Mod"], key: "n" }],
				callback: () => {
					const view = this.getActiveView();
					if (view) {
						void view.createNewConversation();
					} else {
						new Notice("Please open the chat view first");
					}
				},
			});

			// Add command to open search panel
			this.addCommand({
				id: "open-search-panel",
				name: "Search files",
				hotkeys: [{ modifiers: ["Mod"], key: "f" }],
				callback: () => {
					const view = this.getActiveView();
					if (view) {
						view.openSearchPanel();
					} else {
						new Notice("Please open the chat view first");
					}
				},
			});

			// Add command to open todo list
			this.addCommand({
				id: "open-todo-list",
				name: "Open Todo List",
				hotkeys: [{ modifiers: ["Mod"], key: "t" }],
				callback: () => {
					const view = this.getActiveView();
					if (view) {
						// 这里将在OpenCodeObsidianView中实现显示待办事项列表的方法
						if (typeof (view as any).showTodoList === 'function') {
							(view as any).showTodoList();
						} else {
							new Notice("Todo list functionality not available in this view");
						}
					} else {
						new Notice("Please open the chat view first");
					}
				},
			});

			// Add settings tab
			this.addSettingTab(new OpenCodeObsidianSettingTab(this.app, this));

				// Server status check after plugin fully loaded
			void this.checkServerStatusAndPrompt();

			console.debug("[OpenCode Obsidian] Plugin loaded successfully ✓");
		} catch (error) {
			if (this.errorHandler) {
				this.errorHandler.handleError(
					error,
					{
						module: "OpenCodeObsidianPlugin",
						function: "onload",
						operation: "Plugin loading",
					},
					ErrorSeverity.Critical,
				);
			} else {
				// Fallback if errorHandler is not initialized
				console.error("[OpenCode Obsidian] Failed to load plugin:", error);
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				new Notice(
					"Failed to load OpenCode Obsidian plugin. Check console for details.",
				);
			}
			throw error; // Re-throw to let Obsidian handle the error
		}
	}

	/**
	 * Check server status on plugin startup and prompt user if needed
	 */
	private async checkServerStatusAndPrompt(): Promise<void> {
		try {
			const serverConfig = this.settings.opencodeServer;
			if (!serverConfig) {
				return; // No server configured yet
			}

			// Check if using embedded server
			if (serverConfig.useEmbeddedServer) {
				// Give server some time to start if it's initializing
				await new Promise(resolve => setTimeout(resolve, 1000));

				// Check if server manager exists and is running
				if (this.serverManager) {
					const state = this.serverManager.getState();
					if (state !== "running" && state !== "starting") {
						// Server is not running, show prompt
						this.showServerStartPrompt();
					}
				} else {
					// Server manager not initialized, show prompt
					this.showServerStartPrompt();
				}
			} else {
				// Using external server - check connection
				if (serverConfig.url && this.opencodeClient) {
					try {
						const isHealthy = await this.opencodeClient.healthCheck();
						if (!isHealthy) {
							// External server not reachable, show notice
							new Notice("OpenCode external server not reachable. Please check configuration.");
						}
					} catch (error) {
						// Connection error, show notice
						console.debug("[OpenCode Obsidian] External server connection check failed:", error);
						new Notice("Unable to connect to OpenCode server. Please verify configuration.");
					}
				}
			}
		} catch (error) {
			console.error("[OpenCode Obsidian] Server status check failed:", error);
			// Don't show error to user - just log it
		}
	}

	/**
	 * Show server start prompt modal
	 */
	private showServerStartPrompt(): void {
		// Import modal dynamically to avoid circular dependencies
		import("./views/modals/server-start-modal").then(m => {
			new m.ServerStartModal(this.app, this).open();
		});
	}

	onunload(): void {
		console.debug("[OpenCode Obsidian] Plugin unloading...");

		// Cleanup permission coordinator
		this.permissionCoordinator = null;

		// Stop embedded server if running
		if (this.serverManager) {
			this.serverManager.stop();
			this.serverManager = null;
		}

		// Disconnect from OpenCode Server
		if (this.opencodeClient) {
			void this.opencodeClient.disconnect().then(() => {
				this.opencodeClient = null;
				this.connectionManager = null;
			});
		}

		console.debug("[OpenCode Obsidian] Plugin unloaded");
	}

	/**
	 * Handle server state changes
	 */
	public handleServerStateChange(event: ServerStateChangeEvent): void {
		console.debug("[OpenCode Obsidian] Server state change:", event);

		if (event.state === "error" && event.error) {
			this.errorHandler.handleError(
				new Error(`Server error: ${event.error.message}`),
				{ module: "OpenCodeObsidianPlugin", function: "handleServerStateChange" },
				ErrorSeverity.Error
			);
		}
	}

	async loadSettings() {
		const loadedData =
			(await this.loadData()) as Partial<OpenCodeObsidianSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData ?? {});

		// Ensure OpenCode Server configuration exists
		if (!this.settings.opencodeServer) {
			this.settings.opencodeServer = { ...DEFAULT_SERVER_CONFIG };
		}
	}

	/**
	 * Migrate old settings format to new format
	 */
	private migrateSettings(): void {
		let needsSave = false;

		// Initialize OpenCode Server configuration with defaults if not present
		if (!this.settings.opencodeServer) {
			this.settings.opencodeServer = { ...DEFAULT_SERVER_CONFIG };
			needsSave = true;
		}

		if (
			this.settings.opencodeServer &&
			this.settings.opencodeServer.requestTimeoutMs === undefined
		) {
			this.settings.opencodeServer.requestTimeoutMs =
				DEFAULT_SERVER_CONFIG.requestTimeoutMs;
			needsSave = true;
		}

		// Initialize tool permission level if not present (default: read-only)
		if (!this.settings.toolPermission) {
			this.settings.toolPermission = "read-only";
			needsSave = true;
		}

		if (needsSave) {
			void this.saveSettings();
		}
	}

	async saveSettings() {
		// Update PermissionManager configuration (if initialized)
		if (this.permissionManager) {
			this.permissionManager.setPermissionLevel(
				getPermissionLevel(this.settings.toolPermission),
			);
			this.permissionManager.setScope(
				toPermissionScope(this.settings.permissionScope) ??
					({} as PermissionScope),
			);
		}

		// Check if server URL changed and reinitialize client if needed
		const normalizeUrl = (url?: string) => url?.trim().replace(/\/+$/, "") || "";
		const oldUrl = normalizeUrl(this.opencodeClient?.getConfig()?.url);
		const newUrl = normalizeUrl(this.settings.opencodeServer?.url);
		const urlChanged = oldUrl !== newUrl && newUrl;
		
		await this.saveData(this.settings);
		
		// Reinitialize OpenCode Server client if URL changed
		if (urlChanged && this.settings.opencodeServer && this.permissionManager) {
			console.debug(
				"[OpenCode Obsidian] Server URL changed, reinitializing client...",
				{ oldUrl, newUrl },
			);
			
			const auditLogger = new AuditLogger(this.app.vault);
			const clientSetup = await reinitializeClient(
				this.opencodeClient,
				this.settings.opencodeServer,
				this.errorHandler,
				this.sessionEventBus,
				this.permissionManager,
				auditLogger,
				this.app,
				async (agents: Agent[]) => {
					// Only save if agents have actually changed to avoid infinite loop
					const agentsChanged = JSON.stringify(this.settings.agents) !== JSON.stringify(agents);
					if (agentsChanged) {
						this.settings.agents = agents;
						await this.saveSettings();
					}
				},
				() => this.getDefaultAgents()
			);
			
			if (clientSetup) {
				this.opencodeClient = clientSetup.client;
				this.connectionManager = clientSetup.connectionManager;
				this.permissionCoordinator = clientSetup.permissionCoordinator;
			}
			
			console.debug(
				"[OpenCode Obsidian] OpenCode Server client reinitialized with new URL:",
				newUrl,
			);
		}
	}

	/**
	 * Debounced version of saveSettings for use in frequently-triggered callbacks
	 * (e.g., input field onChange handlers)
	 */
	debouncedSaveSettings = debounceAsync(async () => {
		await this.saveSettings();
	}, UI_CONFIG.DEBOUNCE_DELAY);

	async activateView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_OPENCODE_OBSIDIAN)[0];

		if (!leaf) {
			// Create new leaf in right sidebar
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({
					type: VIEW_TYPE_OPENCODE_OBSIDIAN,
					active: true,
				});
				leaf = rightLeaf;
			}
		}

		if (leaf) {
			void workspace.revealLeaf(leaf);
		}
	}

	getActiveView(): OpenCodeObsidianView | null {
		const leaves = this.app.workspace.getLeavesOfType(
			VIEW_TYPE_OPENCODE_OBSIDIAN,
		);
		if (leaves.length > 0 && leaves[0]) {
			return leaves[0].view as OpenCodeObsidianView;
		}
		return null;
	}

	/**
	 * Create a new conversation in the active view
	 * Used by keyboard shortcuts and commands
	 */
	async createNewConversationInActiveView(): Promise<void> {
		const view = this.getActiveView();
		if (view) {
			await view.createNewConversation();
		} else {
			new Notice("Please open the chat view first");
		}
	}

	/**
	 * Load agents from OpenCode Server
	 * Non-blocking operation that updates settings on success
	 * Falls back to default agents on error
	 */
	private async loadAgents(): Promise<void> {
		try {
			if (!this.opencodeClient) {
				return; // No client configured yet
			}
			const agents = await this.opencodeClient.listAgents();
			this.settings.agents = agents;
			await this.saveSettings();
		} catch (error) {
			// Fallback to hardcoded agents
			this.settings.agents = this.getDefaultAgents();
			this.errorHandler.handleError(
				error,
				{ module: "Plugin", function: "loadAgents" },
				ErrorSeverity.Warning,
			);
		}
	}

	/**
	 * Get default hardcoded agents as fallback
	 * @returns Array of default agents
	 */
	private getDefaultAgents(): Agent[] {
		return [
			{ id: "assistant", name: "Assistant", systemPrompt: "" },
			{ id: "bootstrap", name: "Bootstrap", systemPrompt: "" },
			{ id: "thinking-partner", name: "Thinking Partner", systemPrompt: "" },
			{ id: "research-assistant", name: "Research Assistant", systemPrompt: "" },
			{ id: "read-only", name: "Read Only", systemPrompt: "" },
		];
	}
}
