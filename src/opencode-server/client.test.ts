/**
 * Comprehensive tests for OpenCode Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
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
import { requestUrl } from "obsidian";

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
			await vi.runAllTimersAsync();

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

		it("should block concurrent prompts until session is idle", async () => {
			mockSDKClient.session.get.mockResolvedValue({
				data: { id: "session-123", info: { id: "session-123" } },
				error: null,
			});
			mockSDKClient.session.prompt.mockResolvedValue({
				data: {},
				error: null,
			});

			await client.sendMessage("session-123", "Hello");
			await expect(
				client.sendMessage("session-123", "Again"),
			).rejects.toThrow("already in progress");

			mockSDKClient.event.subscribe.mockResolvedValue({
				data: {
					stream: createMockStream([
						{
							type: "session.idle",
							properties: { sessionId: "session-123" },
						},
					]),
				},
				error: null,
			});

			await client.connect();
			await vi.runAllTimersAsync();

			await expect(
				client.sendMessage("session-123", "Again"),
			).resolves.toBeUndefined();
		});
	});

	describe("URL normalization", () => {
		beforeEach(() => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096" },
				errorHandler,
			);
		});

		it("should normalize URL with http scheme", () => {
			const result = (client as any).normalizeServerUrl("http://example.com");
			expect(result).toBe("http://example.com");
		});

		it("should normalize URL with https scheme", () => {
			const result = (client as any).normalizeServerUrl("https://example.com");
			expect(result).toBe("https://example.com");
		});

		it("should add http scheme if missing", () => {
			const result = (client as any).normalizeServerUrl("example.com:4096");
			expect(result).toBe("http://example.com:4096");
		});

		it("should remove trailing slashes", () => {
			const result = (client as any).normalizeServerUrl(
				"http://example.com///",
			);
			expect(result).toBe("http://example.com");
		});

		it("should trim whitespace", () => {
			const result = (client as any).normalizeServerUrl(
				"  http://example.com  ",
			);
			expect(result).toBe("http://example.com");
		});
	});

	describe("Request URL resolution", () => {
		beforeEach(() => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096" },
				errorHandler,
			);
		});

		it("should resolve absolute URL", () => {
			const result = (client as any).resolveRequestUrl(
				"http://example.com/api",
			);
			expect(result).toBe("http://example.com/api");
		});

		it("should resolve relative URL using base", () => {
			const result = (client as any).resolveRequestUrl("/api/session");
			expect(result).toContain("/api/session");
			expect(result).toContain("127.0.0.1:4096");
		});

		it("should resolve URL object", () => {
			const url = new URL("http://example.com/path");
			const result = (client as any).resolveRequestUrl(url);
			expect(result).toBe("http://example.com/path");
		});

		it("should throw for empty URL", () => {
			expect(() => {
				(client as any).resolveRequestUrl("");
			}).toThrow("OpenCode Server request URL is empty");
		});

		it("should throw for invalid URL", () => {
			expect(() => {
				(client as any).resolveRequestUrl({ url: null });
			}).toThrow("OpenCode Server request URL is invalid");
		});
	});

	describe("Build request options", () => {
		beforeEach(() => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096" },
				errorHandler,
			);
		});

		it("should build request options from string URL", async () => {
			const options = await (client as any).buildRequestOptions(
				"http://example.com/api",
				{ method: "POST", headers: { "Content-Type": "application/json" } },
			);
			expect(options.resolvedUrl).toBe("http://example.com/api");
			expect(options.method).toBe("POST");
			// Headers are case-insensitive, so check both possible keys
			expect(
				options.headers["Content-Type"] || options.headers["content-type"],
			).toBe("application/json");
		});

		it("should extract content type from headers", async () => {
			const options = await (client as any).buildRequestOptions(
				"http://example.com",
				{ headers: { "content-type": "application/json" } },
			);
			expect(options.contentType).toBe("application/json");
		});

		it("should calculate body length", async () => {
			const options = await (client as any).buildRequestOptions(
				"http://example.com",
				{ body: "test body" },
			);
			expect(options.bodyLength).toBe(9);
		});
	});

	describe("Obsidian fetch implementation", () => {
		beforeEach(() => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096", requestTimeoutMs: 1000 },
				errorHandler,
			);
		});

		it("should create fetch that uses requestUrl", async () => {
			const mockResponse = {
				status: 200,
				headers: {},
				text: "response text",
				json: null,
			};
			vi.mocked(requestUrl).mockResolvedValue(mockResponse as any);

			const fetchImpl = (client as any).createObsidianFetch();
			const response = await fetchImpl("http://example.com/api");

			expect(requestUrl).toHaveBeenCalled();
			expect(response.status).toBe(200);
		});

		it("should handle timeout", async () => {
			// Create a client with very short timeout for testing
			const testClient = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096", requestTimeoutMs: 100 },
				errorHandler,
			);

		// Mock requestUrl to delay response longer than timeout
		vi.mocked(requestUrl).mockImplementation(
			() =>
				new Promise((resolve) => {
					// Delay longer than timeout (100ms)
					setTimeout(() => resolve({ status: 200 } as any), 200);
				}) as any,
		);

			const fetchImpl = (testClient as any).createObsidianFetch();
			const fetchPromise = fetchImpl("http://example.com/api");
			const assertion = expect(fetchPromise).rejects.toThrow(
				"Unable to connect to OpenCode Server",
			);

			// Advance timers to trigger timeout (100ms) before request resolves (200ms)
			vi.advanceTimersByTime(150);
			await vi.runAllTimersAsync();

			// The promise should reject with timeout error
			await assertion;
		});

		it("should use longer timeout for message endpoints", async () => {
			const mockResponse = {
				status: 200,
				headers: {},
				text: "ok",
				json: null,
			};
			vi.mocked(requestUrl).mockResolvedValue(mockResponse as any);

			const fetchImpl = (client as any).createObsidianFetch();
			await fetchImpl("http://example.com/message");

			// Verify timeout was applied (message endpoint should use 60s minimum)
			expect(requestUrl).toHaveBeenCalled();
		});

		it("should handle JSON parse errors gracefully", async () => {
			const jsonError = new Error("Response is not valid JSON");
			vi.mocked(requestUrl).mockRejectedValue(jsonError);

			const fetchImpl = (client as any).createObsidianFetch();
			await expect(fetchImpl("http://example.com/health")).rejects.toThrow(
				"not valid JSON",
			);
		});

		it("should convert response to standard Response object", async () => {
			const mockResponse = {
				status: 201,
				headers: { "content-type": "application/json" },
				text: '{"key":"value"}',
				json: null,
			};
			vi.mocked(requestUrl).mockResolvedValue(mockResponse as any);

			const fetchImpl = (client as any).createObsidianFetch();
			const response = await fetchImpl("http://example.com/api");

			expect(response.status).toBe(201);
			expect(response.statusText).toBe("201");
		});

		it("should handle response with json property", async () => {
			const mockResponse = {
				status: 200,
				headers: {},
				text: undefined,
				json: { key: "value" },
			};
			vi.mocked(requestUrl).mockResolvedValue(mockResponse as any);

			const fetchImpl = (client as any).createObsidianFetch();
			const response = await fetchImpl("http://example.com/api");
			const text = await response.text();

			expect(text).toBe('{"key":"value"}');
		});
	});

	describe("System message building", () => {
		beforeEach(() => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096" },
				errorHandler,
			);
		});

		it("should build system message with agent", () => {
			const message = (client as any).buildSystemMessage(
				undefined,
				"agent1",
				undefined,
			);
			expect(message).toContain("Agent: agent1");
		});

		it("should build system message with instructions", () => {
			const message = (client as any).buildSystemMessage(
				undefined,
				undefined,
				["inst1", "inst2"],
			);
			expect(message).toContain("Instructions: inst1, inst2");
		});

		it("should build system message with context", () => {
			const context = {
				currentNote: "note.md",
				selection: "selected",
				links: ["link1"],
				tags: ["tag1"],
			};
			const message = (client as any).buildSystemMessage(context);
			expect(message).toContain("Current note: note.md");
			expect(message).toContain("Selection: selected");
			expect(message).toContain("Links: link1");
			expect(message).toContain("Tags: tag1");
		});

		it("should return null for empty message", () => {
			const message = (client as any).buildSystemMessage();
			expect(message).toBeNull();
		});

		it("should build complete system message", () => {
			const context = { currentNote: "test.md" };
			const message = (client as any).buildSystemMessage(
				context,
				"agent1",
				["inst1"],
			);
			expect(message).toContain("Agent: agent1");
			expect(message).toContain("Instructions: inst1");
			expect(message).toContain("Current note: test.md");
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

	describe("Event handling (detailed)", () => {
		beforeEach(() => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096" },
				errorHandler,
			);
		});

		describe("Event callback registration", () => {
		it("should register stream token callbacks", () => {
			const callback = vi.fn();
			client.onStreamToken(callback);

			// Simulate event handling
			const mockEvent = {
				type: "message.part.updated",
				sessionId: "test-session",
				data: {
					part: { type: "text", text: "Hello" },
				},
			};

			// Access private method for testing
			(client as any).handleSDKEvent(mockEvent);

			expect(callback).toHaveBeenCalledWith(
				"test-session",
				"Hello",
				false,
			);
		});

		it("should register stream thinking callbacks", () => {
			const callback = vi.fn();
			client.onStreamThinking(callback);

			// Simulate thinking event
			const mockEvent = {
				type: "message.part.updated",
				sessionId: "test-session",
				data: {
					part: { type: "reasoning", text: "Thinking..." },
				},
			};

			(client as any).handleSDKEvent(mockEvent);

			expect(callback).toHaveBeenCalledWith(
				"test-session",
				"Thinking...",
			);
		});

		it("should register error callbacks", () => {
			const callback = vi.fn();
			client.onError(callback);

			const testError = new Error("Test error");
			(client as any).handleSDKError(testError);

			expect(callback).toHaveBeenCalledWith(testError);
		});

		it("should handle session idle events", () => {
			const callback = vi.fn();
			client.onStreamToken(callback);

			const mockEvent = {
				type: "session.idle",
				sessionId: "test-session",
			};

			(client as any).handleSDKEvent(mockEvent);

			expect(callback).toHaveBeenCalledWith("test-session", "", true);
		});
	});

	describe("Event translation", () => {
		it("should handle message.part.updated events", () => {
			const tokenCallback = vi.fn();
			const thinkingCallback = vi.fn();

			client.onStreamToken(tokenCallback);
			client.onStreamThinking(thinkingCallback);

			// Text part event
			const textEvent = {
				type: "message.part.updated",
				sessionId: "test-session",
				data: {
					part: { type: "text", text: "Response text" },
				},
			};

			(client as any).handleSDKEvent(textEvent);
			expect(tokenCallback).toHaveBeenCalledWith(
				"test-session",
				"Response text",
				false,
			);

			// Reasoning part event
			const reasoningEvent = {
				type: "message.part.updated",
				sessionId: "test-session",
				data: {
					part: { type: "reasoning", text: "Reasoning content" },
				},
			};

			(client as any).handleSDKEvent(reasoningEvent);
			expect(thinkingCallback).toHaveBeenCalledWith(
				"test-session",
				"Reasoning content",
			);
		});

		it("should handle assistant message events", () => {
			const tokenCallback = vi.fn();
			client.onStreamToken(tokenCallback);

			const assistantEvent = {
				role: "assistant",
				sessionID: "test-session",
				parts: [{ type: "text", text: "Assistant response" }],
			};

			(client as any).handleSDKEvent(assistantEvent);
			expect(tokenCallback).toHaveBeenCalledWith(
				"test-session",
				"Assistant response",
				false,
			);
		});

		it("should handle session ended events", () => {
			const sessionEndCallback = vi.fn();
			client.onSessionEnd(sessionEndCallback);

			const endEvent = {
				type: "session.ended",
				sessionId: "test-session",
				data: { reason: "completed" },
			};

			(client as any).handleSDKEvent(endEvent);
			expect(sessionEndCallback).toHaveBeenCalledWith(
				"test-session",
				"completed",
			);
		});

		it("should handle permission.request events with all fields", () => {
			const permissionCallback = vi.fn();
			client.onPermissionRequest(permissionCallback);

			const permissionEvent = {
				type: "permission.request",
				sessionId: "test-session",
				properties: {
					requestId: "req-123",
					operation: "write",
					resourcePath: "/path/to/file.md",
					context: {
						toolName: "obsidian.write_file",
						args: { path: "/path/to/file.md", content: "test" },
						preview: { newContent: "test content" },
					},
				},
			};

			(client as any).handleSDKEvent(permissionEvent);
			expect(permissionCallback).toHaveBeenCalledWith(
				"test-session",
				"req-123",
				"write",
				"/path/to/file.md",
				{
					toolName: "obsidian.write_file",
					args: { path: "/path/to/file.md", content: "test" },
					preview: { newContent: "test content" },
				},
			);
		});

		it("should handle permission.request events from data field", () => {
			const permissionCallback = vi.fn();
			client.onPermissionRequest(permissionCallback);

			const permissionEvent = {
				type: "permission.request",
				sessionId: "test-session",
				data: {
					requestId: "req-456",
					operation: "read",
					resourcePath: "/notes/test.md",
				},
			};

			(client as any).handleSDKEvent(permissionEvent);
			expect(permissionCallback).toHaveBeenCalledWith(
				"test-session",
				"req-456",
				"read",
				"/notes/test.md",
				undefined,
			);
		});

		it("should log warning for malformed permission.request events", () => {
			const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			const permissionCallback = vi.fn();
			client.onPermissionRequest(permissionCallback);

			// Missing requestId
			const malformedEvent1 = {
				type: "permission.request",
				sessionId: "test-session",
				properties: {
					operation: "write",
					resourcePath: "/path/to/file.md",
				},
			};

			(client as any).handleSDKEvent(malformedEvent1);
			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining("Malformed permission.request event"),
				expect.any(Object),
			);
			expect(permissionCallback).not.toHaveBeenCalled();

			// Missing operation
			const malformedEvent2 = {
				type: "permission.request",
				sessionId: "test-session",
				properties: {
					requestId: "req-789",
					resourcePath: "/path/to/file.md",
				},
			};

			(client as any).handleSDKEvent(malformedEvent2);
			expect(permissionCallback).not.toHaveBeenCalled();

			// Missing resourcePath
			const malformedEvent3 = {
				type: "permission.request",
				sessionId: "test-session",
				properties: {
					requestId: "req-789",
					operation: "write",
				},
			};

			(client as any).handleSDKEvent(malformedEvent3);
			expect(permissionCallback).not.toHaveBeenCalled();

			consoleWarnSpy.mockRestore();
		});

		/**
		 * **Validates: Requirements 1.3**
		 *
		 * Property: For any permission.request event with missing required fields,
		 * no modal is shown (callback not invoked) and a warning is logged.
		 */
		it("Property 2: Malformed event handling - events with missing fields are denied and logged", async () => {
			// Generator for malformed permission events
			// Each event is missing at least one required field (requestId, operation, or resourcePath)
			const malformedEventArb = fc.record({
				type: fc.constant("permission.request"),
				sessionId: fc.string({ minLength: 1, maxLength: 50 }),
				properties: fc.oneof(
					// Missing requestId
					fc.record({
						operation: fc.string({ minLength: 1, maxLength: 20 }),
						resourcePath: fc.string({ minLength: 1, maxLength: 100 }),
						context: fc.option(fc.object(), { nil: undefined }),
					}),
					// Missing operation
					fc.record({
						requestId: fc.string({ minLength: 1, maxLength: 50 }),
						resourcePath: fc.string({ minLength: 1, maxLength: 100 }),
						context: fc.option(fc.object(), { nil: undefined }),
					}),
					// Missing resourcePath
					fc.record({
						requestId: fc.string({ minLength: 1, maxLength: 50 }),
						operation: fc.string({ minLength: 1, maxLength: 20 }),
						context: fc.option(fc.object(), { nil: undefined }),
					}),
					// Missing all fields
					fc.record({
						context: fc.option(fc.object(), { nil: undefined }),
					}),
					// Empty strings (also invalid)
					fc.record({
						requestId: fc.constant(""),
						operation: fc.string({ minLength: 1, maxLength: 20 }),
						resourcePath: fc.string({ minLength: 1, maxLength: 100 }),
					}),
					fc.record({
						requestId: fc.string({ minLength: 1, maxLength: 50 }),
						operation: fc.constant(""),
						resourcePath: fc.string({ minLength: 1, maxLength: 100 }),
					}),
					fc.record({
						requestId: fc.string({ minLength: 1, maxLength: 50 }),
						operation: fc.string({ minLength: 1, maxLength: 20 }),
						resourcePath: fc.constant(""),
					}),
				),
			});

			await fc.assert(
				fc.asyncProperty(malformedEventArb, async (event) => {
					// Setup
					const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
					const permissionCallback = vi.fn();
					client.onPermissionRequest(permissionCallback);

					// Execute
					(client as any).handleSDKEvent(event);

					// Verify: No callback invoked (no modal shown)
					expect(permissionCallback).not.toHaveBeenCalled();

					// Verify: Warning logged
					expect(consoleWarnSpy).toHaveBeenCalledWith(
						expect.stringContaining("Malformed permission.request event"),
						expect.any(Object),
					);

					// Cleanup
					consoleWarnSpy.mockRestore();
				}),
				{ numRuns: 100 }, // Run 100+ iterations as specified
			);
		});
	});

	describe("Error handling", () => {
		it("should handle callback errors gracefully", () => {
			const faultyCallback = vi.fn(() => {
				throw new Error("Callback error");
			});
			const goodCallback = vi.fn();

			client.onStreamToken(faultyCallback);
			client.onStreamToken(goodCallback);

			const mockEvent = {
				type: "message.part.updated",
				sessionId: "test-session",
				data: {
					part: { type: "text", text: "Test" },
				},
			};

			// Should not throw and should still call good callback
			expect(() => {
				(client as any).handleSDKEvent(mockEvent);
			}).not.toThrow();

			expect(goodCallback).toHaveBeenCalledWith(
				"test-session",
				"Test",
				false,
			);
		});
	});

	describe("Session forking", () => {
		beforeEach(() => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096" },
				errorHandler,
			);
		});

		it("should fork session successfully with message ID and title", async () => {
			const mockForkedSession = {
				id: "forked-session-123",
				info: { id: "forked-session-123" },
			};
			mockSDKClient.session.fork = vi.fn().mockResolvedValue({
				data: mockForkedSession,
				error: null,
			});

			const forkedSessionId = await client.forkSession(
				"parent-session-123",
				"message-456",
				"Fork of Test Session",
			);

			expect(forkedSessionId).toBe("forked-session-123");
			expect(mockSDKClient.session.fork).toHaveBeenCalledWith({
				path: { id: "parent-session-123" },
				body: {
					messageID: "message-456",
					title: "Fork of Test Session",
				},
			});
		});

		it("should fork session without message ID", async () => {
			const mockForkedSession = {
				id: "forked-session-456",
				info: { id: "forked-session-456" },
			};
			mockSDKClient.session.fork = vi.fn().mockResolvedValue({
				data: mockForkedSession,
				error: null,
			});

			const forkedSessionId = await client.forkSession(
				"parent-session-123",
				undefined,
				"Fork Title",
			);

			expect(forkedSessionId).toBe("forked-session-456");
			expect(mockSDKClient.session.fork).toHaveBeenCalledWith({
				path: { id: "parent-session-123" },
				body: {
					title: "Fork Title",
				},
			});
		});

		it("should fork session without title", async () => {
			const mockForkedSession = {
				id: "forked-session-789",
				info: { id: "forked-session-789" },
			};
			mockSDKClient.session.fork = vi.fn().mockResolvedValue({
				data: mockForkedSession,
				error: null,
			});

			const forkedSessionId = await client.forkSession(
				"parent-session-123",
				"message-456",
			);

			expect(forkedSessionId).toBe("forked-session-789");
			expect(mockSDKClient.session.fork).toHaveBeenCalledWith({
				path: { id: "parent-session-123" },
				body: {
					messageID: "message-456",
				},
			});
		});

		it("should fork session with neither message ID nor title", async () => {
			const mockForkedSession = {
				id: "forked-session-abc",
				info: { id: "forked-session-abc" },
			};
			mockSDKClient.session.fork = vi.fn().mockResolvedValue({
				data: mockForkedSession,
				error: null,
			});

			const forkedSessionId = await client.forkSession("parent-session-123");

			expect(forkedSessionId).toBe("forked-session-abc");
			expect(mockSDKClient.session.fork).toHaveBeenCalledWith({
				path: { id: "parent-session-123" },
				body: {},
			});
		});

		it("should cache forked session after successful fork", async () => {
			const mockForkedSession = {
				id: "forked-session-123",
				info: { id: "forked-session-123" },
			};
			mockSDKClient.session.fork = vi.fn().mockResolvedValue({
				data: mockForkedSession,
				error: null,
			});
			mockSDKClient.session.get = vi.fn();

			await client.forkSession("parent-session-123");

			// Verify session is cached by checking ensureSession doesn't call get
			const exists = await client.ensureSession("forked-session-123");
			expect(exists).toBe(true);
			expect(mockSDKClient.session.get).not.toHaveBeenCalled();
		});

		it("should handle fork error from server", async () => {
			mockSDKClient.session.fork = vi.fn().mockResolvedValue({
				data: null,
				error: "Server error during fork",
			});

			await expect(
				client.forkSession("parent-session-123"),
			).rejects.toThrow("Failed to fork session");
		});

		it("should handle 404 error when parent session not found", async () => {
			const error404 = new Error("Not found");
			(error404 as any).status = 404;
			mockSDKClient.session.fork = vi.fn().mockRejectedValue(error404);

			await expect(
				client.forkSession("non-existent-session"),
			).rejects.toThrow("Session non-existent-session not found");
		});

		it("should handle 500 error during fork", async () => {
			const error500 = new Error("Internal server error");
			(error500 as any).status = 500;
			mockSDKClient.session.fork = vi.fn().mockRejectedValue(error500);

			await expect(
				client.forkSession("parent-session-123"),
			).rejects.toThrow("Server error during forking session");
		});

		it("should handle missing session ID in fork response", async () => {
			mockSDKClient.session.fork = vi.fn().mockResolvedValue({
				data: { info: {} },
				error: null,
			});

			await expect(
				client.forkSession("parent-session-123"),
			).rejects.toThrow(
				"OpenCode Server fork response did not include a session id",
			);
		});

		it("should handle missing data in fork response", async () => {
			mockSDKClient.session.fork = vi.fn().mockResolvedValue({
				data: null,
				error: null,
			});

			await expect(
				client.forkSession("parent-session-123"),
			).rejects.toThrow("OpenCode Server session.fork returned no data");
		});
	});

	describe("Session ID extraction", () => {
		it("should extract session ID from session object with id field", () => {
			const session = { id: "test-session-id" };
			const result = (client as any).extractSessionId(session);
			expect(result).toBe("test-session-id");
		});

		it("should extract session ID from session object with sessionID field", () => {
			const session = { sessionID: "test-session-id-2" };
			const result = (client as any).extractSessionId(session);
			expect(result).toBe("test-session-id-2");
		});

		it("should extract session ID from session object with sessionId field", () => {
			const session = { sessionId: "test-session-id-3" };
			const result = (client as any).extractSessionId(session);
			expect(result).toBe("test-session-id-3");
		});

		it("should extract session ID from session object with nested info", () => {
			const session = { info: { id: "nested-session-id" } };
			const result = (client as any).extractSessionId(session);
			expect(result).toBe("nested-session-id");
		});

		it("should return null if session ID not found", () => {
			const session = {};
			const result = (client as any).extractSessionId(session);
			expect(result).toBeNull();
		});

		it("should extract session ID from event with sessionId field", () => {
			const event = { sessionId: "event-session-id" };
			const result = (client as any).extractSessionIdFromEvent(event);
			expect(result).toBe("event-session-id");
		});

		it("should extract session ID from event with sessionID field", () => {
			const event = { sessionID: "event-session-id-2" };
			const result = (client as any).extractSessionIdFromEvent(event);
			expect(result).toBe("event-session-id-2");
		});

		it("should extract session ID from event with properties.sessionId", () => {
			const event = { properties: { sessionId: "prop-session-id" } };
			const result = (client as any).extractSessionIdFromEvent(event);
			expect(result).toBe("prop-session-id");
		});

		it("should extract session ID from event with properties.part.sessionId", () => {
			const event = {
				properties: { part: { sessionId: "part-session-id" } },
			};
			const result = (client as any).extractSessionIdFromEvent(event);
			expect(result).toBe("part-session-id");
		});

		it("should return null if event session ID not found", () => {
			const event = {};
			const result = (client as any).extractSessionIdFromEvent(event);
			expect(result).toBeNull();
		});
	});

	describe("Error enhancement detection", () => {
		it("should detect enhanced error with connection message", () => {
			const error = new Error(
				"Unable to connect to OpenCode Server at http://127.0.0.1:4096",
			);
			const result = (client as any).isEnhancedError(error);
			expect(result).toBe(true);
		});

		it("should not detect regular error as enhanced", () => {
			const error = new Error("Session not found");
			const result = (client as any).isEnhancedError(error);
			expect(result).toBe(false);
		});

		it("should not detect error without message as enhanced", () => {
			const error = new Error();
			const result = (client as any).isEnhancedError(error);
			expect(result).toBe(false);
		});
	});

	describe("URL resolution", () => {
		it("should resolve string URL with scheme", () => {
			const url = "http://example.com/path";
			const result = (client as any).resolveRequestUrl(url);
			expect(result).toBe("http://example.com/path");
		});

		it("should resolve string URL without scheme using config URL", () => {
			const url = "/api/path";
			const result = (client as any).resolveRequestUrl(url);
			expect(result).toContain("/api/path");
			expect(result).toContain("127.0.0.1:4096");
		});

		it("should resolve URL object", () => {
			const url = new URL("http://example.com/path");
			const result = (client as any).resolveRequestUrl(url);
			expect(result).toBe("http://example.com/path");
		});

		it("should throw error for empty string URL", () => {
			expect(() => {
				(client as any).resolveRequestUrl("");
			}).toThrow("OpenCode Server request URL is empty");
		});

		it("should throw error for invalid URL object", () => {
			const invalidUrl = { url: null };
			expect(() => {
				(client as any).resolveRequestUrl(invalidUrl);
			}).toThrow("OpenCode Server request URL is invalid");
		});
	});

	describe("Health check", () => {
		it("should return true for successful health check", async () => {
			vi.mocked(requestUrl).mockResolvedValueOnce({
				status: 200,
				headers: {},
				json: {},
				text: "",
			} as any);

			const result = await client.healthCheck();
			expect(result).toBe(true);
		});

		it("should return false for failed health check", async () => {
			vi.mocked(requestUrl).mockResolvedValueOnce({
				status: 500,
				headers: {},
				json: {},
				text: "",
			} as any);

			const result = await client.healthCheck();
			expect(result).toBe(false);
		});

		it("should return false and handle errors", async () => {
			vi.mocked(requestUrl).mockRejectedValueOnce(
				new Error("Network error"),
			);

			const result = await client.healthCheck();
			expect(result).toBe(false);
		});

		it("should handle JSON parse errors from HTML response", async () => {
			const jsonError = new Error("Response is not valid JSON");
			vi.mocked(requestUrl).mockRejectedValue(jsonError);

			const result = await client.healthCheck();
			expect(result).toBe(false);
		});
	});

	describe("List agents", () => {
		beforeEach(() => {
			client = new OpenCodeServerClient(
				{ url: "http://127.0.0.1:4096" },
				errorHandler,
			);
		});

		it("should list agents successfully", async () => {
			const mockAgents = [
				{
					id: "assistant",
					name: "Assistant",
					description: "General purpose assistant",
					systemPrompt: "You are a helpful assistant",
				},
				{
					id: "bootstrap",
					name: "Bootstrap",
					description: "Bootstrap agent",
					systemPrompt: "Bootstrap prompt",
					model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
					tools: { "*": true },
					skills: ["skill1"],
					color: "#38A3EE",
					hidden: false,
					mode: "primary",
				},
			];

			mockSDKClient.app.agents.mockResolvedValue({
				data: mockAgents,
				error: null,
			});

			const agents = await client.listAgents();

			expect(agents).toHaveLength(2);
			expect(agents[0]).toEqual({
				id: "assistant",
				name: "Assistant",
				description: "General purpose assistant",
				systemPrompt: "You are a helpful assistant",
				model: undefined,
				tools: undefined,
				skills: undefined,
				color: undefined,
				hidden: undefined,
				mode: undefined,
			});
			expect(agents[1]).toEqual({
				id: "bootstrap",
				name: "Bootstrap",
				description: "Bootstrap agent",
				systemPrompt: "Bootstrap prompt",
				model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
				tools: { "*": true },
				skills: ["skill1"],
				color: "#38A3EE",
				hidden: false,
				mode: "primary",
			});
		});

		it("should handle error response from server", async () => {
			mockSDKClient.app.agents.mockResolvedValue({
				data: null,
				error: "Server error",
			});

			await expect(client.listAgents()).rejects.toThrow(
				"Failed to list agents: Server error",
			);
		});

		it("should handle missing data in response", async () => {
			mockSDKClient.app.agents.mockResolvedValue({
				data: null,
				error: null,
			});

			await expect(client.listAgents()).rejects.toThrow(
				"Failed to list agents: Unknown error",
			);
		});

		it("should handle network errors", async () => {
			mockSDKClient.app.agents.mockRejectedValue(
				new Error("Network error"),
			);

			await expect(client.listAgents()).rejects.toThrow("Network error");
		});

		it("should map agent fields correctly", async () => {
			const mockAgents = [
				{
					id: "test-agent",
					name: "Test Agent",
					description: "Test description",
					systemPrompt: "Test prompt",
				},
			];

			mockSDKClient.app.agents.mockResolvedValue({
				data: mockAgents,
				error: null,
			});

			const agents = await client.listAgents();

			expect(agents.length).toBe(1);
			expect(agents[0]?.id).toBe("test-agent");
			expect(agents[0]?.name).toBe("Test Agent");
			expect(agents[0]?.description).toBe("Test description");
			expect(agents[0]?.systemPrompt).toBe("Test prompt");
		});
	});
	});
});
