/**
 * Tests for OpenCode Obsidian Plugin main class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ErrorHandler } from "./utils/error-handler";
import type { Agent } from "./types";

// Mock Obsidian API
vi.mock("obsidian", () => ({
	Plugin: class {},
	Notice: vi.fn(),
}));

// Mock OpenCodeServerClient
const mockListAgents = vi.fn();
const mockHealthCheck = vi.fn();
const mockDisconnect = vi.fn();

vi.mock("./opencode-server/client", () => ({
	OpenCodeServerClient: vi.fn().mockImplementation(function() {
		return {
			listAgents: mockListAgents,
			healthCheck: mockHealthCheck,
			disconnect: mockDisconnect,
			onStreamToken: vi.fn(),
			onStreamThinking: vi.fn(),
			onProgressUpdate: vi.fn(),
			onSessionEnd: vi.fn(),
			onError: vi.fn(),
		};
	}),
}));

// Mock other dependencies
vi.mock("./views/opencode-obsidian-view", () => ({
	OpenCodeObsidianView: vi.fn(),
	VIEW_TYPE_OPENCODE_OBSIDIAN: "opencode-obsidian-view",
}));

vi.mock("./settings", () => ({
	OpenCodeObsidianSettingTab: vi.fn(),
}));

vi.mock("./tools/obsidian/tool-registry", () => ({
	ObsidianToolRegistry: vi.fn(),
}));

vi.mock("./tools/obsidian/tool-executor", () => ({
	ObsidianToolExecutor: vi.fn(),
}));

vi.mock("./tools/obsidian/permission-manager", () => ({
	PermissionManager: vi.fn(),
}));

vi.mock("./tools/obsidian/audit-logger", () => ({
	AuditLogger: vi.fn(),
}));

vi.mock("./session/connection-manager", () => ({
	ConnectionManager: vi.fn(),
}));

vi.mock("./session/session-event-bus", () => ({
	SessionEventBus: vi.fn().mockImplementation(function() {
		return {
			emitStreamToken: vi.fn(),
			emitStreamThinking: vi.fn(),
			emitProgressUpdate: vi.fn(),
			emitSessionEnd: vi.fn(),
			emitError: vi.fn(),
		};
	}),
}));

// Import after mocking
import OpenCodeObsidianPlugin from "./main";

describe("OpenCodeObsidianPlugin - Agent Loading", () => {
	let plugin: OpenCodeObsidianPlugin;
	let mockApp: any;

	beforeEach(() => {
		vi.clearAllMocks();

		// Create mock app
		mockApp = {
			vault: {
				adapter: {},
			},
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([]),
				getRightLeaf: vi.fn(),
				revealLeaf: vi.fn(),
			},
			metadataCache: {},
		};

		// Create plugin instance
		plugin = new OpenCodeObsidianPlugin(mockApp, {
			id: "opencode-obsidian",
			name: "OpenCode Obsidian",
			version: "1.0.0",
			dir: "/test",
		} as any);

		// Mock plugin methods
		plugin.loadData = vi.fn().mockResolvedValue({});
		plugin.saveData = vi.fn().mockResolvedValue(undefined);
		plugin.registerView = vi.fn();
		plugin.addRibbonIcon = vi.fn();
		plugin.addCommand = vi.fn();
		plugin.addSettingTab = vi.fn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("getDefaultAgents", () => {
		it("should return default agents", () => {
			const defaultAgents = (plugin as any).getDefaultAgents();

			expect(defaultAgents).toHaveLength(5);
			expect(defaultAgents[0]).toEqual({
				id: "assistant",
				name: "Assistant",
				systemPrompt: "",
			});
			expect(defaultAgents[1]).toEqual({
				id: "bootstrap",
				name: "Bootstrap",
				systemPrompt: "",
			});
			expect(defaultAgents[2]).toEqual({
				id: "thinking-partner",
				name: "Thinking Partner",
				systemPrompt: "",
			});
			expect(defaultAgents[3]).toEqual({
				id: "research-assistant",
				name: "Research Assistant",
				systemPrompt: "",
			});
			expect(defaultAgents[4]).toEqual({
				id: "read-only",
				name: "Read Only",
				systemPrompt: "",
			});
		});

		it("should return agents with required fields", () => {
			const defaultAgents = (plugin as any).getDefaultAgents();

			defaultAgents.forEach((agent: Agent) => {
				expect(agent).toHaveProperty("id");
				expect(agent).toHaveProperty("name");
				expect(agent).toHaveProperty("systemPrompt");
				expect(typeof agent.id).toBe("string");
				expect(typeof agent.name).toBe("string");
				expect(typeof agent.systemPrompt).toBe("string");
			});
		});
	});

	describe("loadAgents", () => {
		beforeEach(() => {
			// Initialize settings and errorHandler
			plugin.settings = {
				agent: "assistant",
				instructions: [],
				opencodeServer: { url: "http://127.0.0.1:4096" },
				toolPermission: "read-only",
			};
			plugin.errorHandler = new ErrorHandler({
				showUserNotifications: false,
				logToConsole: false,
				collectErrors: false,
			});
		});

		it("should not throw when client is not configured", async () => {
			plugin.opencodeClient = null;

			await expect((plugin as any).loadAgents()).resolves.not.toThrow();
		});

		it("should fallback to default agents on error", async () => {
			// Create a mock client that throws
			plugin.opencodeClient = {
				listAgents: vi.fn().mockRejectedValue(new Error("Server error")),
			} as any;

			await (plugin as any).loadAgents();

			expect(plugin.settings.agents).toHaveLength(5);
			expect(plugin.settings.agents?.[0]?.id).toBe("assistant");
			expect(plugin.settings.agents?.[1]?.id).toBe("bootstrap");
		});

		it("should save agents to settings on success", async () => {
			const mockAgents: Agent[] = [
				{
					id: "test-agent",
					name: "Test Agent",
					description: "Test",
					systemPrompt: "Test prompt",
				},
			];

			plugin.opencodeClient = {
				listAgents: vi.fn().mockResolvedValue(mockAgents),
			} as any;

			// Mock saveSettings to avoid errors
			plugin.saveSettings = vi.fn().mockResolvedValue(undefined);

			await (plugin as any).loadAgents();

			expect(plugin.settings.agents).toEqual(mockAgents);
			expect(plugin.saveSettings).toHaveBeenCalled();
		});
	});
});
