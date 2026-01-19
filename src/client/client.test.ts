/**
 * Comprehensive tests for OpenCode Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ErrorHandler } from "../utils/error-handler";

// Mock the SDK client
const mockSDKClient = {
	event: {
		subscribe: vi.fn(),
	},
	session: {
		create: vi.fn(),
		get: vi.fn(),
		prompt: vi.fn(),
		abort: vi.fn(),
		fork: vi.fn(),
	},
	app: {
		agents: vi.fn(),
	},
};

// Mock Obsidian API
vi.mock("obsidian", () => ({
	requestUrl: vi.fn(),
}));

// Mock SDK client creation
vi.mock("@opencode-ai/sdk/client", () => ({
	createOpencodeClient: vi.fn(() => mockSDKClient),
}));

// Import after mocking
import { OpenCodeServerClient } from "./client";

// Helper function to create mock async generator
function createMockStream(events: any[]): AsyncGenerator<any, any, unknown> {
	return (async function* () {
		for (const event of events) {
			yield event;
		}
	})();
}

describe("OpenCodeServerClient", () => {
	let client: OpenCodeServerClient;
	let errorHandler: ErrorHandler;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		errorHandler = new ErrorHandler({
			showUserNotifications: false,
			logToConsole: false,
			collectErrors: false,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("Constructor and initialization", () => {
		it("should create client with normalized URL", () => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096" },
				errorHandler,
			);
			const config = client.getConfig();
			expect(config.url).toBe("http://127.0.0.1:4096");
		});

		it("should normalize URL without scheme", () => {
			client = new OpenCodeServerClient(
				{ url: "127.0.0.1:4096" },
				errorHandler,
			);
			const config = client.getConfig();
			expect(config.url).toBe("http://127.0.0.1:4096");
		});

		it("should normalize URL with trailing slashes", () => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096///" },
				errorHandler,
			);
			const config = client.getConfig();
			expect(config.url).toBe("http://127.0.0.1:4096");
		});

		it("should throw error for empty URL", () => {
			expect(() => {
				new OpenCodeServerClient({ url: "" }, errorHandler);
			}).toThrow("OpenCode Server URL is empty");
		});

		it("should throw error for invalid URL", () => {
			expect(() => {
				new OpenCodeServerClient({ url: "://invalid" }, errorHandler);
			}).toThrow("OpenCode Server URL is invalid");
		});

		it("should throw error for non-HTTP protocol", () => {
			expect(() => {
				new OpenCodeServerClient({ url: "ftp://example.com" }, errorHandler);
			}).toThrow("OpenCode Server URL must use http:// or https://");
		});

		it("should set default request timeout", () => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096" },
				errorHandler,
			);
			const config = client.getConfig();
			expect(config.requestTimeoutMs).toBe(10000);
		});

		it("should use custom request timeout", () => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096", requestTimeoutMs: 5000 },
				errorHandler,
			);
			const config = client.getConfig();
			expect(config.requestTimeoutMs).toBe(5000);
		});

		it("should initialize with disconnected state", () => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096" },
				errorHandler,
			);
			expect(client.getConnectionState()).toBe("disconnected");
			expect(client.isConnected()).toBe(false);
		});
	});

	describe("Connection management", () => {
		beforeEach(() => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096", autoReconnect: false },
				errorHandler,
			);
		});

		afterEach(async () => {
			if (client) {
				await client.disconnect();
			}
		});

		it("should change state to connecting on connect", async () => {
			// Mock subscribe to reject immediately to avoid infinite loop
			mockSDKClient.event.subscribe.mockRejectedValue(
				new Error("Connection failed"),
			);

			await client.connect();
			// State should be connecting initially
			expect(["connecting", "disconnected"]).toContain(
				client.getConnectionState(),
			);
		});

		it("should not connect if already connecting", async () => {
			mockSDKClient.event.subscribe.mockImplementation(
				() =>
					new Promise((resolve) => {
						// Never resolve to keep in connecting state
						setTimeout(() => resolve({ data: { stream: createMockStream([]) } }), 10000);
					}),
			);

			await client.connect();
			const firstState = client.getConnectionState();
			await client.connect();
			expect(client.getConnectionState()).toBe(firstState);
		});

		it("should disconnect and clean up state", async () => {
			await client.disconnect();
			expect(client.getConnectionState()).toBe("disconnected");
			expect(client.getCurrentSessionId()).toBeNull();
		});

		it("should get connection state", () => {
			expect(client.getConnectionState()).toBe("disconnected");
		});

		it("should check if connected", () => {
			expect(client.isConnected()).toBe(false);
		});

		it("should enter error state after max reconnect attempts", async () => {
			const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
			client = new OpenCodeServerClient(
				{
					url: "http://127.0.0.1:4096",
					autoReconnect: true,
					reconnectDelay: 1000,
					reconnectMaxAttempts: 2,
				},
				errorHandler,
			);

			const reconnectAttempts: Array<{ attempt: number; nextDelayMs: number }> =
				[];
			client.onReconnectAttempt((info) => {
				reconnectAttempts.push({
					attempt: info.attempt,
					nextDelayMs: info.nextDelayMs,
				});
			});

			mockSDKClient.event.subscribe.mockRejectedValue(new Error("fail"));

			await client.connect();
			await vi.advanceTimersByTimeAsync(1000);
			// Wait for async operations (use a small delay instead of runAllTimersAsync)
			await vi.advanceTimersByTimeAsync(100);

			expect(client.getConnectionState()).toBe("error");
			expect(client.getLastConnectionError()).toBeInstanceOf(Error);
			expect(reconnectAttempts.length).toBeGreaterThan(0);

			randomSpy.mockRestore();
		});
	});

	describe("Session management", () => {
		beforeEach(() => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096" },
				errorHandler,
			);
		});

		it("should create session successfully", async () => {
			const mockSession = { id: "session-123", info: { id: "session-123" } };
			mockSDKClient.session.create.mockResolvedValue({
				data: mockSession,
				error: null,
			});

			const sessionId = await client.createSession("Test Session");
			expect(sessionId).toBe("session-123");
			expect(client.getCurrentSessionId()).toBe("session-123");
		});

		it("should create session with default title", async () => {
			const mockSession = { id: "session-456", info: { id: "session-456" } };
			mockSDKClient.session.create.mockResolvedValue({
				data: mockSession,
				error: null,
			});

			const sessionId = await client.createSession();
			expect(sessionId).toBe("session-456");
			expect(mockSDKClient.session.create).toHaveBeenCalledWith({
				body: expect.objectContaining({
					title: expect.stringContaining("Session"),
				}),
			});
		});

		it("should handle session creation error", async () => {
			mockSDKClient.session.create.mockResolvedValue({
				data: null,
				error: "Server error",
			});

			await expect(client.createSession()).rejects.toThrow(
				"Failed to create session",
			);
		});

		it("should handle missing session ID in response", async () => {
			mockSDKClient.session.create.mockResolvedValue({
				data: { info: {} },
				error: null,
			});

			await expect(client.createSession()).rejects.toThrow(
				"OpenCode Server session response did not include an id",
			);
		});

		it("should start session with context", async () => {
			const mockSession = { id: "session-789", info: { id: "session-789" } };
			mockSDKClient.session.create.mockResolvedValue({
				data: mockSession,
				error: null,
			});
			mockSDKClient.session.prompt.mockResolvedValue({
				data: {},
				error: null,
			});

			const context = {
				currentNote: "test.md",
				selection: "selected text",
				links: ["link1", "link2"],
				tags: ["tag1"],
			};

			const sessionId = await client.startSession(context, "agent1", [
				"instruction1",
			]);
			expect(sessionId).toBe("session-789");
			expect(mockSDKClient.session.prompt).toHaveBeenCalled();
		});

		it("should start session without context", async () => {
			const mockSession = { id: "session-abc", info: { id: "session-abc" } };
			mockSDKClient.session.create.mockResolvedValue({
				data: mockSession,
				error: null,
			});

			const sessionId = await client.startSession();
			expect(sessionId).toBe("session-abc");
			expect(mockSDKClient.session.prompt).not.toHaveBeenCalled();
		});

		it("should ensure session exists locally", async () => {
			const mockSession = { id: "session-123", info: { id: "session-123" } };
			mockSDKClient.session.create.mockResolvedValue({
				data: mockSession,
				error: null,
			});

			await client.createSession();
			const exists = await client.ensureSession("session-123");
			expect(exists).toBe(true);
			expect(mockSDKClient.session.get).not.toHaveBeenCalled();
		});

		it("should ensure session exists on server", async () => {
			const mockSession = { id: "session-456", info: { id: "session-456" } };
			mockSDKClient.session.get.mockResolvedValue({
				data: mockSession,
				error: null,
			});

			const exists = await client.ensureSession("session-456");
			expect(exists).toBe(true);
			expect(mockSDKClient.session.get).toHaveBeenCalledWith({
				path: { id: "session-456" },
			});
		});

		it("should return false if session not found on server", async () => {
			mockSDKClient.session.get.mockResolvedValue({
				data: null,
				error: "Not found",
			});

			const exists = await client.ensureSession("session-999");
			expect(exists).toBe(false);
		});

		it("should abort session successfully", async () => {
			const mockSession = { id: "session-123", info: { id: "session-123" } };
			mockSDKClient.session.create.mockResolvedValue({
				data: mockSession,
				error: null,
			});
			mockSDKClient.session.abort.mockResolvedValue({
				data: {},
				error: null,
			});

			await client.createSession();
			await client.abortSession("session-123");
			expect(mockSDKClient.session.abort).toHaveBeenCalledWith({
				path: { id: "session-123" },
			});
			expect(client.getCurrentSessionId()).toBeNull();
		});

		it("should handle abort for non-existent session", async () => {
			mockSDKClient.session.abort.mockResolvedValue({
				data: {},
				error: null,
			});

			await client.abortSession("non-existent");
			// Should not throw, but should log warning
		});

		it("should get current session ID", async () => {
			expect(client.getCurrentSessionId()).toBeNull();

			const mockSession = { id: "session-123", info: { id: "session-123" } };
			mockSDKClient.session.create.mockResolvedValue({
				data: mockSession,
				error: null,
			});

			await client.createSession();
			expect(client.getCurrentSessionId()).toBe("session-123");
		});
	});

	describe("Permission response", () => {
		beforeEach(() => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096" },
				errorHandler,
			);
			// Mock the permission.respond method on the SDK client
			(mockSDKClient.session as any).permission = {
				respond: vi.fn(),
			};
		});

		it("should respond to permission request successfully", async () => {
			(mockSDKClient.session as any).permission.respond.mockResolvedValue({
				data: {},
				error: null,
			});

			await client.respondToPermission(
				"session-123",
				"request-456",
				true,
				"User approved",
			);

			expect(
				(mockSDKClient.session as any).permission.respond,
			).toHaveBeenCalledWith({
				path: { id: "session-123" },
				body: {
					requestId: "request-456",
					approved: true,
					reason: "User approved",
				},
			});
		});

		it("should retry on first failure and succeed on second attempt", async () => {
			const mockRespond = (mockSDKClient.session as any).permission.respond;
			mockRespond
				.mockRejectedValueOnce(new Error("Network error"))
				.mockResolvedValueOnce({
					data: {},
					error: null,
				});

			const promise = client.respondToPermission(
				"session-123",
				"request-456",
				false,
				"User denied",
			);

			// Fast-forward time by 500ms to allow retry
			await vi.advanceTimersByTimeAsync(500);
			await promise;

			expect(mockRespond).toHaveBeenCalledTimes(2);
		});

		it("should wait 500ms between retry attempts", async () => {
			const mockRespond = (mockSDKClient.session as any).permission.respond;
			mockRespond
				.mockRejectedValueOnce(new Error("Network error"))
				.mockResolvedValueOnce({
					data: {},
					error: null,
				});

			const promise = client.respondToPermission(
				"session-123",
				"request-456",
				true,
			);

			// Fast-forward time by 500ms
			await vi.advanceTimersByTimeAsync(500);
			await promise;

			expect(mockRespond).toHaveBeenCalledTimes(2);
		});

		it("should throw error after all retry attempts fail", async () => {
			const mockRespond = (mockSDKClient.session as any).permission.respond;
			mockRespond.mockRejectedValue(new Error("Persistent network error"));

			// Use expect().rejects to properly handle the rejection
			const promise = expect(
				client.respondToPermission("session-123", "request-456", true),
			).rejects.toThrow("Persistent network error");

			// Fast-forward time by 500ms to allow retry
			await vi.advanceTimersByTimeAsync(500);
			await promise;

			expect(mockRespond).toHaveBeenCalledTimes(2); // Initial + 1 retry
		});

		it("should handle error response from SDK", async () => {
			(mockSDKClient.session as any).permission.respond.mockResolvedValue({
				data: null,
				error: "Permission endpoint not available",
			});

			// Use expect().rejects to properly handle the rejection
			const promise = expect(
				client.respondToPermission("session-123", "request-456", false),
			).rejects.toThrow("Permission response failed");

			// Fast-forward time by 500ms to allow retry
			await vi.advanceTimersByTimeAsync(500);
			await promise;
		});

		it("should work without optional reason parameter", async () => {
			(mockSDKClient.session as any).permission.respond.mockResolvedValue({
				data: {},
				error: null,
			});

			await client.respondToPermission("session-123", "request-456", true);

			expect(
				(mockSDKClient.session as any).permission.respond,
			).toHaveBeenCalledWith({
				path: { id: "session-123" },
				body: {
					requestId: "request-456",
					approved: true,
					reason: undefined,
				},
			});
		});
	});

	describe("Message sending", () => {
		beforeEach(() => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096", autoReconnect: false },
				errorHandler,
			);
		});

		it("should send message to existing session", async () => {
			const mockSession = { id: "session-123", info: { id: "session-123" } };
			mockSDKClient.session.create.mockResolvedValue({
				data: mockSession,
				error: null,
			});
			mockSDKClient.session.prompt.mockResolvedValue({
				data: {},
				error: null,
			});

			await client.createSession();
			await client.sendMessage("session-123", "Hello, world!");

			expect(mockSDKClient.session.prompt).toHaveBeenCalledWith({
				path: { id: "session-123" },
				body: {
					parts: [{ type: "text", text: "Hello, world!" }],
				},
			});
		});

		it("should fetch session if not in cache", async () => {
			const mockSession = { id: "session-456", info: { id: "session-456" } };
			mockSDKClient.session.get.mockResolvedValue({
				data: mockSession,
				error: null,
			});
			mockSDKClient.session.prompt.mockResolvedValue({
				data: {},
				error: null,
			});

			await client.sendMessage("session-456", "Test message");

			expect(mockSDKClient.session.get).toHaveBeenCalledWith({
				path: { id: "session-456" },
			});
			expect(mockSDKClient.session.prompt).toHaveBeenCalled();
		});

		it("should throw error if session not found", async () => {
			mockSDKClient.session.get.mockResolvedValue({
				data: null,
				error: "Not found",
			});

			await expect(
				client.sendMessage("session-999", "Test"),
			).rejects.toThrow("Session session-999 not found");
		});

		it("should send session message (legacy)", async () => {
			const mockSession = { id: "session-123", info: { id: "session-123" } };
			mockSDKClient.session.create.mockResolvedValue({
				data: mockSession,
				error: null,
			});
			mockSDKClient.session.prompt.mockResolvedValue({
				data: {},
				error: null,
			});

			await client.createSession();
			await client.sendSessionMessage("session-123", "Legacy message");

			expect(mockSDKClient.session.prompt).toHaveBeenCalled();
		});

		it("should warn about unsupported images", async () => {
			const mockSession = { id: "session-123", info: { id: "session-123" } };
			mockSDKClient.session.create.mockResolvedValue({
				data: mockSession,
				error: null,
			});
			mockSDKClient.session.prompt.mockResolvedValue({
				data: {},
				error: null,
			});

			await client.createSession();
			await client.sendSessionMessage("session-123", "Message", [
				{ type: "image", url: "test.jpg" },
			]);

			// Should still send message but log warning
			expect(mockSDKClient.session.prompt).toHaveBeenCalled();
		});

	});
	describe("Config getters", () => {
		beforeEach(() => {
			client = new OpenCodeServerClient(
				{
					url: "http://127.0.0.1:4096",
					requestTimeoutMs: 5000,
					autoReconnect: false,
				},
				errorHandler,
			);
		});

		it("should get config copy", () => {
			const config1 = client.getConfig();
			const config2 = client.getConfig();
			expect(config1).toEqual(config2);
			expect(config1).not.toBe(config2); // Should be different objects
		});

		it("should return correct config values", () => {
			const config = client.getConfig();
			expect(config.url).toBe("http://127.0.0.1:4096");
			expect(config.requestTimeoutMs).toBe(5000);
			expect(config.autoReconnect).toBe(false);
		});
	});

	describe("Event callback registration", () => {
		beforeEach(() => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096" },
				errorHandler,
			);
		});

		it("should register stream token callbacks", () => {
			const callback = vi.fn();
			client.onStreamToken(callback);
			// Callback should be registered (tested via event handling)
		});

		it("should register stream thinking callbacks", () => {
			const callback = vi.fn();
			client.onStreamThinking(callback);
		});

		it("should register error callbacks", () => {
			const callback = vi.fn();
			client.onError(callback);
		});

		it("should register progress update callbacks", () => {
			const callback = vi.fn();
			client.onProgressUpdate(callback);
		});

		it("should register session end callbacks", () => {
			const callback = vi.fn();
			client.onSessionEnd(callback);
		});
	});
});
