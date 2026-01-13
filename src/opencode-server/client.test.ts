/**
 * Tests for OpenCode Client event handling
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ErrorHandler } from "../utils/error-handler";

// Mock the SDK client
const mockSDKClient = {
	event: {
		subscribe: vi.fn(),
	},
	session: {
		create: vi.fn(),
		prompt: vi.fn(),
		abort: vi.fn(),
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

describe("OpenCodeServerClient Event Handling", () => {
	let client: OpenCodeServerClient;
	let errorHandler: ErrorHandler;

	beforeEach(() => {
		vi.clearAllMocks();
		errorHandler = new ErrorHandler({
			showUserNotifications: false,
			logToConsole: false,
			collectErrors: false,
		});

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
			const { requestUrl } = await import("obsidian");
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
			const { requestUrl } = await import("obsidian");
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
			const { requestUrl } = await import("obsidian");
			vi.mocked(requestUrl).mockRejectedValueOnce(
				new Error("Network error"),
			);

			const result = await client.healthCheck();
			expect(result).toBe(false);
		});
	});
});
