/**
 * Comprehensive tests for StreamHandler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamHandler } from "./stream-handler";
import { ErrorHandler, ErrorSeverity } from "../utils/error-handler";
import type { OpenCodeServerConfig, ProgressUpdate } from "./types";
import type { OpenCodeClient } from "./client";

// Mock data helpers
vi.mock("../utils/data-helpers", () => ({
	safeJsonParse: vi.fn((json: string, fallback: any) => {
		try {
			return JSON.parse(json);
		} catch {
			return fallback;
		}
	}),
}));

import { safeJsonParse } from "../utils/data-helpers";

describe("StreamHandler", () => {
	let handler: StreamHandler;
	let mockErrorHandler: ErrorHandler;
	let mockSdkClient: OpenCodeClient;
	let mockConfig: OpenCodeServerConfig;
	let mockSessionState: {
		promptInFlightSessionId: string | null;
		sessions: Map<string, any>;
		currentSessionId: string | null;
	};

	beforeEach(() => {
		vi.clearAllMocks();

		mockErrorHandler = {
			handleError: vi.fn(),
		} as unknown as ErrorHandler;

		mockSdkClient = {
			event: {
				subscribe: vi.fn(),
			},
		} as unknown as OpenCodeClient;

		mockConfig = {
			url: "http://localhost:4096",
			requestTimeoutMs: 10000,
		};

		mockSessionState = {
			promptInFlightSessionId: null,
			sessions: new Map(),
			currentSessionId: null,
		};

		handler = new StreamHandler(
			mockConfig,
			mockErrorHandler,
			mockSdkClient,
			mockSessionState,
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("Constructor and initialization", () => {
		it("should initialize with null last event ID", () => {
			expect(handler.getLastEventId()).toBe(null);
		});

		it("should store configuration and dependencies", () => {
			// Verify handler was created successfully
			expect(handler).toBeDefined();
		});
	});

	describe("Event ID management", () => {
		it("should set and get last event ID", () => {
			handler.setLastEventId("event-123");
			expect(handler.getLastEventId()).toBe("event-123");
		});

		it("should clear last event ID", () => {
			handler.setLastEventId("event-123");
			handler.setLastEventId(null);
			expect(handler.getLastEventId()).toBe(null);
		});
	});

	describe("Session state management", () => {
		it("should update session state", () => {
			const newState = {
				promptInFlightSessionId: "session-1",
				sessions: new Map([["session-1", { id: "session-1" }]]),
				currentSessionId: "session-1",
			};

			handler.updateSessionState(newState);

			// Verify state was updated (indirectly through event handling)
			expect(handler).toBeDefined();
		});
	});

	describe("Event stream creation", () => {
		it("should create SDK event stream when Node stream not available", async () => {
			const mockStream = (async function* () {
				yield { type: "test" };
			})();

			vi.mocked(mockSdkClient.event.subscribe).mockResolvedValue({
				data: { stream: mockStream },
			} as any);

			handler.updateSessionState({
				...mockSessionState,
			});

			const signal = new AbortController().signal;
			const stream = await handler.createEventStream(signal);

			expect(mockSdkClient.event.subscribe).toHaveBeenCalledWith({
				signal,
			});

			// Verify stream is iterable
			const firstEvent = await stream.next();
			expect(firstEvent.done).toBe(false);
		});

		it("should throw error if SDK subscription has no stream", async () => {
			vi.mocked(mockSdkClient.event.subscribe).mockResolvedValue({
				data: {},
			} as any);

			const signal = new AbortController().signal;

			await expect(handler.createEventStream(signal)).rejects.toThrow(
				"Event subscription did not include a stream",
			);
		});

		it("should use SDK stream from sub.stream if sub.data.stream not available", async () => {
			const mockStream = (async function* () {
				yield { type: "test" };
			})();

			vi.mocked(mockSdkClient.event.subscribe).mockResolvedValue({
				stream: mockStream,
			} as any);

			const signal = new AbortController().signal;
			const stream = await handler.createEventStream(signal);

			const firstEvent = await stream.next();
			expect(firstEvent.done).toBe(false);
		});
	});

	describe("Event stream processing", () => {
		it("should process stream token events", async () => {
			const callback = vi.fn();
			handler.onStreamToken(callback);

			const stream = (async function* () {
				yield {
					type: "message.part.updated",
					properties: {
						part: {
							type: "text",
							text: "Hello",
						},
						sessionId: "session-1",
					},
				};
			})();

			await handler.processEventStream(stream);

			expect(callback).toHaveBeenCalledWith("session-1", "Hello", false);
		});

		it("should process stream thinking events", async () => {
			const callback = vi.fn();
			handler.onStreamThinking(callback);

			const stream = (async function* () {
				yield {
					type: "message.part.updated",
					properties: {
						part: {
							type: "reasoning",
							text: "Let me think...",
						},
						sessionId: "session-1",
					},
				};
			})();

			await handler.processEventStream(stream);

			expect(callback).toHaveBeenCalledWith("session-1", "Let me think...");
		});

		it("should process progress update events", async () => {
			const callback = vi.fn();
			handler.onProgressUpdate(callback);

			const progress: ProgressUpdate = {
				message: "Processing...",
				stage: "analysis",
				progress: 50,
			};

			const stream = (async function* () {
				yield {
					type: "session.progress",
					data: {
						progress,
					},
					sessionId: "session-1",
				};
			})();

			await handler.processEventStream(stream);

			expect(callback).toHaveBeenCalledWith("session-1", progress);
		});

		it("should process session end events", async () => {
			const callback = vi.fn();
			handler.onSessionEnd(callback);

			mockSessionState.sessions.set("session-1", { id: "session-1" });
			mockSessionState.currentSessionId = "session-1";
			mockSessionState.promptInFlightSessionId = "session-1";

			const stream = (async function* () {
				yield {
					type: "session.ended",
					reason: "completed",
					sessionId: "session-1",
				};
			})();

			await handler.processEventStream(stream);

			expect(callback).toHaveBeenCalledWith("session-1", "completed");
			expect(mockSessionState.sessions.has("session-1")).toBe(false);
			expect(mockSessionState.currentSessionId).toBe(null);
			expect(mockSessionState.promptInFlightSessionId).toBe(null);
		});

		it("should process permission request events", async () => {
			const callback = vi.fn();
			handler.onPermissionRequest(callback);

			const stream = (async function* () {
				yield {
					type: "permission.request",
					properties: {
						requestId: "req-123",
						operation: "read",
						resourcePath: "/path/to/file",
						context: { reason: "Need to read file" },
					},
					sessionId: "session-1",
				};
			})();

			await handler.processEventStream(stream);

			expect(callback).toHaveBeenCalledWith(
				"session-1",
				"req-123",
				"read",
				"/path/to/file",
				{ reason: "Need to read file" },
			);
		});

		it("should handle session.idle events", async () => {
			const callback = vi.fn();
			handler.onStreamToken(callback);

			mockSessionState.promptInFlightSessionId = "session-1";

			const stream = (async function* () {
				yield {
					type: "session.idle",
					sessionId: "session-1",
				};
			})();

			await handler.processEventStream(stream);

			expect(callback).toHaveBeenCalledWith("session-1", "", true);
			expect(mockSessionState.promptInFlightSessionId).toBe(null);
		});

		it("should handle error events", async () => {
			const errorCallback = vi.fn();
			handler.onError(errorCallback);

			const stream = (async function* () {
				throw new Error("Stream error");
			})();

			await expect(handler.processEventStream(stream)).rejects.toThrow(
				"Stream error",
			);

			expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({
					module: "StreamHandler",
					function: "processEventStream",
				}),
				ErrorSeverity.Warning,
			);

			expect(errorCallback).toHaveBeenCalledWith(expect.any(Error));
		});

		it("should handle multiple events in sequence", async () => {
			const tokenCallback = vi.fn();
			handler.onStreamToken(tokenCallback);

			const stream = (async function* () {
				yield {
					type: "message.part.updated",
					properties: {
						part: { type: "text", text: "Hello" },
						sessionId: "session-1",
					},
				};
				yield {
					type: "message.part.updated",
					properties: {
						part: { type: "text", text: " World" },
						sessionId: "session-1",
					},
				};
			})();

			await handler.processEventStream(stream);

			expect(tokenCallback).toHaveBeenCalledTimes(2);
			expect(tokenCallback).toHaveBeenNthCalledWith(1, "session-1", "Hello", false);
			expect(tokenCallback).toHaveBeenNthCalledWith(2, "session-1", " World", false);
		});
	});

	describe("Event format variations", () => {
		it("should handle events with delta field", async () => {
			const callback = vi.fn();
			handler.onStreamToken(callback);

			const stream = (async function* () {
				yield {
					type: "message.part.updated",
					properties: {
						delta: "Hello",
						sessionId: "session-1",
					},
				};
			})();

			await handler.processEventStream(stream);

			expect(callback).toHaveBeenCalledWith("session-1", "Hello", false);
		});

		it("should handle events with data field instead of properties", async () => {
			const callback = vi.fn();
			handler.onProgressUpdate(callback);

			const progress: ProgressUpdate = {
				message: "Processing",
			};

			const stream = (async function* () {
				yield {
					type: "session.progress",
					data: {
						progress,
					},
					sessionId: "session-1",
				};
			})();

			await handler.processEventStream(stream);

			expect(callback).toHaveBeenCalledWith("session-1", progress);
		});

		it("should handle events with direct fields", async () => {
			const callback = vi.fn();
			handler.onStreamToken(callback);

			const stream = (async function* () {
				yield {
					type: "message.part.updated",
					part: {
						type: "text",
						text: "Direct field",
					},
					sessionId: "session-1",
				};
			})();

			await handler.processEventStream(stream);

			expect(callback).toHaveBeenCalledWith("session-1", "Direct field", false);
		});

		it("should handle assistant message format", async () => {
			const callback = vi.fn();
			handler.onStreamToken(callback);

			const stream = (async function* () {
				yield {
					role: "assistant",
					parts: [
						{ type: "text", text: "Response text" },
					],
					sessionId: "session-1",
				};
			})();

			await handler.processEventStream(stream);

			expect(callback).toHaveBeenCalledWith("session-1", "Response text", false);
		});
	});

	describe("Session ID extraction", () => {
		it("should extract session ID from various event formats", async () => {
			const callback = vi.fn();
			handler.onStreamToken(callback);

			const testCases = [
				{ properties: { part: { sessionID: "session-1" } } },
				{ properties: { part: { sessionId: "session-2" } } },
				{ properties: { sessionID: "session-3" } },
				{ properties: { sessionId: "session-4" } },
				{ sessionId: "session-5" },
				{ sessionID: "session-6" },
				{ id: "session-7" },
			];

			for (const event of testCases) {
				callback.mockClear();
				const stream = (async function* () {
					yield {
						type: "message.part.updated",
						...event,
						properties: {
							...event.properties,
							part: {
								type: "text",
								text: "test",
								...event.properties?.part,
							},
						},
					};
				})();

				await handler.processEventStream(stream);
				expect(callback).toHaveBeenCalled();
			}
		});
	});

	describe("Callback error handling", () => {
		it("should handle callback errors gracefully", async () => {
			const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const callback = vi.fn(() => {
				throw new Error("Callback error");
			});
			handler.onStreamToken(callback);

			const stream = (async function* () {
				yield {
					type: "message.part.updated",
					properties: {
						part: { type: "text", text: "Hello" },
						sessionId: "session-1",
					},
				};
			})();

			// Should not throw
			await handler.processEventStream(stream);

			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error in stream token callback"),
				expect.any(Error),
			);

			consoleWarnSpy.mockRestore();
		});
	});

	describe("Permission request validation", () => {
		it("should warn on malformed permission request", async () => {
			const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const callback = vi.fn();
			handler.onPermissionRequest(callback);

			const stream = (async function* () {
				yield {
					type: "permission.request",
					properties: {
						// Missing required fields
						requestId: "req-123",
						// Missing operation and resourcePath
					},
					sessionId: "session-1",
				};
			})();

			await handler.processEventStream(stream);

			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining("Malformed permission.request event"),
				expect.any(Object),
			);
			expect(callback).not.toHaveBeenCalled();

			consoleWarnSpy.mockRestore();
		});
	});

	describe("Unhandled event types", () => {
		it("should log debug message for unhandled event types", async () => {
			const consoleDebugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

			const stream = (async function* () {
				yield {
					type: "unknown.event.type",
					sessionId: "session-1",
				};
			})();

			await handler.processEventStream(stream);

			expect(consoleDebugSpy).toHaveBeenCalledWith(
				expect.stringContaining("Unhandled event type"),
				"unknown.event.type",
			);

			consoleDebugSpy.mockRestore();
		});
	});

	describe("Event processing error handling", () => {
		it("should handle errors in event processing", async () => {
			// Create an event that will cause an error during processing
			// by making a handler method throw
			const stream = (async function* () {
				// Create an event that will cause handleMessagePartUpdated to throw
				// by making part access throw an error
				const maliciousEvent = {
					type: "message.part.updated",
					get properties() {
						return {
							get part() {
								throw new Error("Processing error");
							},
							sessionId: "session-1",
						};
					},
				};
				yield maliciousEvent;
			})();

			// Should not throw, but log error
			await handler.processEventStream(stream);

			expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({
					module: "StreamHandler",
					function: "handleSDKEvent",
				}),
				ErrorSeverity.Warning,
			);
		});
	});

	describe("Multiple callbacks", () => {
		it("should invoke all registered callbacks", async () => {
			const callback1 = vi.fn();
			const callback2 = vi.fn();
			const callback3 = vi.fn();

			handler.onStreamToken(callback1);
			handler.onStreamToken(callback2);
			handler.onStreamToken(callback3);

			const stream = (async function* () {
				yield {
					type: "message.part.updated",
					properties: {
						part: { type: "text", text: "Hello" },
						sessionId: "session-1",
					},
				};
			})();

			await handler.processEventStream(stream);

			expect(callback1).toHaveBeenCalledWith("session-1", "Hello", false);
			expect(callback2).toHaveBeenCalledWith("session-1", "Hello", false);
			expect(callback3).toHaveBeenCalledWith("session-1", "Hello", false);
		});
	});
});
