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
});
