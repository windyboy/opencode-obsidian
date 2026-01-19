import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { PermissionCoordinator } from "./permission-coordinator";
import { SessionEventBus, type PermissionRequestEvent } from "../../session/session-event-bus";
import { ErrorHandler, ErrorSeverity } from "../../utils/error-handler";
import { ToolPermission } from "./types";
import { OpenCodeServerClient } from "../../client/client";
import type { PermissionManager } from "./permission-manager";
import { AuditLogger } from "./audit-logger";

describe("PermissionCoordinator - handleRequest", () => {
	let coordinator: PermissionCoordinator;
	let mockClient: {
		respondToPermission: Mock<(sessionId: string, requestId: string, approved: boolean, reason?: string) => Promise<void>>;
	};
	let eventBus: SessionEventBus;
	let mockPermissionManager: any;
	let mockAuditLogger: {
		log: Mock<(entry: any) => Promise<void>>;
	};
	let errorHandler: ErrorHandler;

	beforeEach(() => {
		// Create real event bus
		eventBus = new SessionEventBus();

		// Create real error handler
		errorHandler = new ErrorHandler({ logToConsole: false });

		// Mock client
		const respondToPermission = vi.fn().mockResolvedValue(undefined);
		mockClient = {
			respondToPermission,
		};

		// Mock permission manager
		mockPermissionManager = {
			validatePath: vi.fn().mockResolvedValue({ allowed: true, secrets: false }),
			getPermissionLevel: vi.fn().mockReturnValue(ToolPermission.ScopedWrite),
		} as unknown as PermissionManager;

		// Mock audit logger
		const log = vi.fn().mockResolvedValue(undefined);
		mockAuditLogger = {
			log,
		};

		// Create coordinator
		coordinator = new PermissionCoordinator(
			mockClient as unknown as OpenCodeServerClient,
			eventBus,
			mockPermissionManager,
			mockAuditLogger as unknown as AuditLogger,
			errorHandler
		);
	});

	describe("request logging", () => {
		it("should log request to audit logger when received", async () => {
			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/note.md",
				context: {
					toolName: "obsidian.update_note",
					args: { path: "/test/note.md", content: "new content" },
				},
			};

			eventBus.emitPermissionRequest(event);

			// Wait for async handling
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(mockAuditLogger.log).toHaveBeenCalled();
			const logCall = vi.mocked(mockAuditLogger.log).mock.calls[0]?.[0];
			expect(logCall).toBeDefined();
			expect(logCall.sessionId).toBe("session-123");
			expect(logCall.callId).toBe("req-456");
			expect(logCall.toolName).toBe("obsidian.update_note");
			expect(logCall.input).toEqual({
				operation: "write",
				resourcePath: "/test/note.md",
				context: event.context,
			});
			expect(logCall.requiredApproval).toBe(true);
			expect(logCall.isError).toBe(false);
		});

		it("should use default tool name when context is missing", async () => {
			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "read",
				resourcePath: "/test/note.md",
			};

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			expect(mockAuditLogger.log).toHaveBeenCalled();
			const logCall = (mockAuditLogger.log as any).mock.calls[0]?.[0];
			expect(logCall.toolName).toBe("server.operation");
		});
	});

	describe("plugin permission validation", () => {
		it("should validate path with permission manager", async () => {
			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/note.md",
			};

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			expect(mockPermissionManager.validatePath).toHaveBeenCalledWith(
				"/test/note.md",
				"write"
			);
		});

		it("should map operation 'read' to 'read' operation type", async () => {
			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "read",
				resourcePath: "/test/note.md",
			};

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			expect(mockPermissionManager.validatePath).toHaveBeenCalledWith(
				"/test/note.md",
				"read"
			);
		});

		it("should map operation 'create' to 'create' operation type", async () => {
			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "create",
				resourcePath: "/test/new-note.md",
			};

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			expect(mockPermissionManager.validatePath).toHaveBeenCalledWith(
				"/test/new-note.md",
				"create"
			);
		});

		it("should map operation 'modify' to 'modify' operation type", async () => {
			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "modify",
				resourcePath: "/test/note.md",
			};

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			expect(mockPermissionManager.validatePath).toHaveBeenCalledWith(
				"/test/note.md",
				"modify"
			);
		});

		it("should map operation 'delete' to 'delete' operation type", async () => {
			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "delete",
				resourcePath: "/test/old-note.md",
			};

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			expect(mockPermissionManager.validatePath).toHaveBeenCalledWith(
				"/test/old-note.md",
				"delete"
			);
		});

		it("should map operation 'get' to 'read' operation type", async () => {
			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "get_note",
				resourcePath: "/test/note.md",
			};

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			expect(mockPermissionManager.validatePath).toHaveBeenCalledWith(
				"/test/note.md",
				"read"
			);
		});

		it("should map operation 'update' to 'modify' operation type", async () => {
			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "update_note",
				resourcePath: "/test/note.md",
			};

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			expect(mockPermissionManager.validatePath).toHaveBeenCalledWith(
				"/test/note.md",
				"modify"
			);
		});

		it("should default to 'write' for unknown operations", async () => {
			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "unknown_operation",
				resourcePath: "/test/note.md",
			};

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			expect(mockPermissionManager.validatePath).toHaveBeenCalledWith(
				"/test/note.md",
				"write"
			);
		});
	});

	describe("auto-deny when plugin denies", () => {
		it("should auto-deny request when plugin denies", async () => {
			mockPermissionManager.validatePath.mockResolvedValue({
				allowed: false,
				reason: "Path not in allowed scope",
				secrets: false,
			});

			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/forbidden/note.md",
			};

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			expect(mockClient.respondToPermission).toHaveBeenCalledWith(
				"session-123",
				"req-456",
				false,
				"Plugin denied: Path not in allowed scope"
			);
		});

		it("should log denial to audit logger", async () => {
			mockPermissionManager.validatePath.mockResolvedValue({
				allowed: false,
				reason: "Read-only mode",
				secrets: false,
			});

			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/note.md",
			};

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			// Should have 2 log calls: initial request + denial
			expect(mockAuditLogger.log).toHaveBeenCalledTimes(2);
			const denialLog = (mockAuditLogger.log as any).mock.calls[1]?.[0];
			expect(denialLog.approved).toBe(false);
			expect(denialLog.output.reason).toContain("Plugin denied");
		});

		it("should not show modal when plugin denies", async () => {
			mockPermissionManager.validatePath.mockResolvedValue({
				allowed: false,
				reason: "Permission denied",
				secrets: false,
			});

			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/note.md",
			};

			// Spy on console.debug to verify showModal is not called
			const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			// showModal logs to console.debug, so it should not be called
			expect(consoleSpy).not.toHaveBeenCalledWith(
				expect.stringContaining("showModal called"),
				expect.anything()
			);

			consoleSpy.mockRestore();
		});
	});

	describe("show modal when plugin allows", () => {
		it("should throw error if app is not set", async () => {
			mockPermissionManager.validatePath.mockResolvedValue({
				allowed: true,
				secrets: false,
			});

			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/note.md",
			};

			const errorSpy = vi.spyOn(errorHandler, "handleError");

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			// Should handle error and auto-deny
			expect(errorSpy).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({
					module: "PermissionCoordinator",
					function: "handleRequest",
				}),
				ErrorSeverity.Error
			);

			expect(mockClient.respondToPermission).toHaveBeenCalledWith(
				"session-123",
				"req-456",
				false,
				"Internal error"
			);
		});
	});

	describe("error handling", () => {
		it("should handle errors with ErrorHandler", async () => {
			mockAuditLogger.log.mockRejectedValue(new Error("Audit log failed"));

			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/note.md",
			};

			const errorSpy = vi.spyOn(errorHandler, "handleError");

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			expect(errorSpy).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({
					module: "PermissionCoordinator",
					function: "handleRequest",
				}),
				ErrorSeverity.Error
			);
		});

		it("should auto-deny request on error", async () => {
			mockPermissionManager.validatePath.mockRejectedValue(
				new Error("Validation failed")
			);

			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/note.md",
			};

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			expect(mockClient.respondToPermission).toHaveBeenCalledWith(
				"session-123",
				"req-456",
				false,
				"Internal error"
			);
		});

		it("should handle errors in denyRequest gracefully", async () => {
			mockPermissionManager.validatePath.mockResolvedValue({
				allowed: false,
				reason: "Denied",
				secrets: false,
			});
			mockClient.respondToPermission.mockRejectedValue(
				new Error("Network error")
			);

			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/note.md",
			};

			const errorSpy = vi.spyOn(errorHandler, "handleError");

			eventBus.emitPermissionRequest(event);

			await new Promise(resolve => setTimeout(resolve, 10));

			// Should handle error with Warning severity
			expect(errorSpy).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({
					module: "PermissionCoordinator",
					function: "denyRequest",
				}),
				ErrorSeverity.Warning
			);
		});
	});

describe("PermissionCoordinator - modal display and queueing", () => {
	let coordinator: PermissionCoordinator;
	let mockClient: any;
	let eventBus: SessionEventBus;
	let mockPermissionManager: any;
	let mockAuditLogger: any;
	let errorHandler: ErrorHandler;
	let mockApp: any;

	beforeEach(() => {
		// Create real event bus
		eventBus = new SessionEventBus();

		// Create real error handler
		errorHandler = new ErrorHandler({ logToConsole: false });

		// Mock client
		mockClient = {
			respondToPermission: vi.fn().mockResolvedValue(undefined),
		} as unknown as OpenCodeServerClient;

		// Mock permission manager
		mockPermissionManager = {
			validatePath: vi.fn().mockResolvedValue({ allowed: true, secrets: false }),
			getPermissionLevel: vi.fn().mockReturnValue(ToolPermission.ScopedWrite),
		} as unknown as PermissionManager;

		// Mock audit logger
		mockAuditLogger = {
			log: vi.fn().mockResolvedValue(undefined),
		} as unknown as AuditLogger;

		// Mock Obsidian App
		mockApp = {
			workspace: {},
		};

		// Create coordinator
		coordinator = new PermissionCoordinator(
			mockClient,
			eventBus,
			mockPermissionManager,
			mockAuditLogger,
			errorHandler
		);
		coordinator.setApp(mockApp);
	});

	describe("modal display", () => {
		it("should create and open modal when plugin allows", async () => {
			vi.useFakeTimers();

			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/note.md",
				context: {
					toolName: "obsidian.update_note",
					args: { path: "/test/note.md", content: "new content" },
					preview: { newContent: "new content" },
				},
			};

			eventBus.emitPermissionRequest(event);

			await vi.advanceTimersByTimeAsync(10);
			await vi.advanceTimersByTimeAsync(60000);

			// Modal should be created (we can't easily test modal.open() without full Obsidian mock)
			// But we can verify no errors occurred
			expect(mockAuditLogger.log).toHaveBeenCalled();

			vi.useRealTimers();
		});

		it("should set timeout when showing modal", async () => {
			vi.useFakeTimers();

			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/note.md",
			};

			eventBus.emitPermissionRequest(event);

			await vi.advanceTimersByTimeAsync(10);

			// Fast forward to timeout (60 seconds)
			await vi.advanceTimersByTimeAsync(60000);

			// Should auto-deny on timeout
			expect(mockClient.respondToPermission).toHaveBeenCalledWith(
				"session-123",
				"req-456",
				false,
				"Request timed out"
			);

			vi.useRealTimers();
		});
	});

	describe("request queueing", () => {
		it("should queue second request when modal is open", async () => {
			vi.useFakeTimers();

			const event1: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-1",
				operation: "write",
				resourcePath: "/test/note1.md",
			};

			const event2: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-2",
				operation: "write",
				resourcePath: "/test/note2.md",
			};

			// Emit first request
			eventBus.emitPermissionRequest(event1);
			await vi.advanceTimersByTimeAsync(10);

			// Emit second request while first modal is open
			eventBus.emitPermissionRequest(event2);
			await vi.advanceTimersByTimeAsync(10);

			// Only first request should be processed initially
			// Second should be queued (we can verify by checking timeout behavior)

			// Fast forward first request timeout
			await vi.advanceTimersByTimeAsync(60000);

			// First request should timeout
			expect(mockClient.respondToPermission).toHaveBeenCalledWith(
				"session-123",
				"req-1",
				false,
				"Request timed out"
			);

			// Second request should now be processed
			await vi.advanceTimersByTimeAsync(10);

			// Fast forward second request timeout
			await vi.advanceTimersByTimeAsync(60000);

			// Second request should also timeout
			expect(mockClient.respondToPermission).toHaveBeenCalledWith(
				"session-123",
				"req-2",
				false,
				"Request timed out"
			);

			vi.useRealTimers();
		});

		it("should process queued requests in FIFO order", async () => {
			vi.useFakeTimers();

			const events = [
				{
					sessionId: "session-123",
					requestId: "req-1",
					operation: "write",
					resourcePath: "/test/note1.md",
				},
				{
					sessionId: "session-123",
					requestId: "req-2",
					operation: "write",
					resourcePath: "/test/note2.md",
				},
				{
					sessionId: "session-123",
					requestId: "req-3",
					operation: "write",
					resourcePath: "/test/note3.md",
				},
			];

			// Emit all requests
			for (const event of events) {
				eventBus.emitPermissionRequest(event);
				await vi.advanceTimersByTimeAsync(10);
			}

			// Process each request by timing out
			for (let i = 0; i < events.length; i++) {
				await vi.advanceTimersByTimeAsync(60000);
				await vi.advanceTimersByTimeAsync(10);

				const event = events[i];
				if (event) {
					expect(mockClient.respondToPermission).toHaveBeenCalledWith(
						"session-123",
						event.requestId,
						false,
						"Request timed out"
					);
				}
			}

			vi.useRealTimers();
		});
	});

	describe("timeout handling", () => {
		it("should auto-deny request after 60 seconds", async () => {
			vi.useFakeTimers();

			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/note.md",
			};

			eventBus.emitPermissionRequest(event);
			await vi.advanceTimersByTimeAsync(10);

			// Fast forward to timeout
			await vi.advanceTimersByTimeAsync(60000);

			expect(mockClient.respondToPermission).toHaveBeenCalledWith(
				"session-123",
				"req-456",
				false,
				"Request timed out"
			);

			vi.useRealTimers();
		});

		it("should log timeout denial to audit logger", async () => {
			vi.useFakeTimers();

			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/note.md",
			};

			eventBus.emitPermissionRequest(event);
			await vi.advanceTimersByTimeAsync(10);

			// Clear previous log calls
			(mockAuditLogger.log as any).mockClear();

			// Fast forward to timeout
			await vi.advanceTimersByTimeAsync(60000);

			// Should log denial
			expect(mockAuditLogger.log).toHaveBeenCalled();
			const denialLog = (mockAuditLogger.log as any).mock.calls[0]?.[0];
			expect(denialLog.approved).toBe(false);
			expect(denialLog.output.reason).toBe("Request timed out");

			vi.useRealTimers();
		});

		it("should process next queued request after timeout", async () => {
			vi.useFakeTimers();

			const event1: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-1",
				operation: "write",
				resourcePath: "/test/note1.md",
			};

			const event2: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-2",
				operation: "write",
				resourcePath: "/test/note2.md",
			};

			// Emit both requests
			eventBus.emitPermissionRequest(event1);
			await vi.advanceTimersByTimeAsync(10);
			eventBus.emitPermissionRequest(event2);
			await vi.advanceTimersByTimeAsync(10);

			// Timeout first request
			await vi.advanceTimersByTimeAsync(60000);

			expect(mockClient.respondToPermission).toHaveBeenCalledWith(
				"session-123",
				"req-1",
				false,
				"Request timed out"
			);

			// Second request should now be processed
			await vi.advanceTimersByTimeAsync(10);
			await vi.advanceTimersByTimeAsync(60000);

			expect(mockClient.respondToPermission).toHaveBeenCalledWith(
				"session-123",
				"req-2",
				false,
				"Request timed out"
			);

			vi.useRealTimers();
		});
	});


	describe("session cleanup", () => {
		it("should deny all pending requests when session ends", async () => {
			vi.useFakeTimers();

			const events = [
				{
					sessionId: "session-123",
					requestId: "req-1",
					operation: "write",
					resourcePath: "/test/note1.md",
				},
				{
					sessionId: "session-123",
					requestId: "req-2",
					operation: "write",
					resourcePath: "/test/note2.md",
				},
			];

			// Emit requests
			for (const event of events) {
				eventBus.emitPermissionRequest(event);
				await vi.advanceTimersByTimeAsync(10);
			}

			// Clear previous calls (from initial request logging)
			(mockClient.respondToPermission as any).mockClear();

			// End session
			eventBus.emitSessionEnd({ sessionId: "session-123" });
			await vi.advanceTimersByTimeAsync(10);

			// Both requests should be denied with "Session ended"
			expect(mockClient.respondToPermission).toHaveBeenCalledWith(
				"session-123",
				"req-1",
				false,
				"Session ended"
			);
			expect(mockClient.respondToPermission).toHaveBeenCalledWith(
				"session-123",
				"req-2",
				false,
				"Session ended"
			);

			vi.useRealTimers();
		});

		it("should remove requests from queue when session ends", async () => {
			vi.useFakeTimers();

			const event1: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-1",
				operation: "write",
				resourcePath: "/test/note1.md",
			};

			const event2: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-2",
				operation: "write",
				resourcePath: "/test/note2.md",
			};

			// Emit both requests (second will be queued)
			eventBus.emitPermissionRequest(event1);
			await vi.advanceTimersByTimeAsync(10);
			eventBus.emitPermissionRequest(event2);
			await vi.advanceTimersByTimeAsync(10);

			// Clear previous calls
			(mockClient.respondToPermission as any).mockClear();

			// End session
			eventBus.emitSessionEnd({ sessionId: "session-123" });
			await vi.advanceTimersByTimeAsync(10);

			// Both should be denied
			expect(mockClient.respondToPermission).toHaveBeenCalledTimes(2);

			// Fast forward past timeout - no additional calls should be made
			(mockClient.respondToPermission as any).mockClear();
			await vi.advanceTimersByTimeAsync(60000);

			expect(mockClient.respondToPermission).not.toHaveBeenCalled();

			vi.useRealTimers();
		});

		it("should not affect requests from other sessions", async () => {
			vi.useFakeTimers();

			const event1: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-1",
				operation: "write",
				resourcePath: "/test/note1.md",
			};

			const event2: PermissionRequestEvent = {
				sessionId: "session-456",
				requestId: "req-2",
				operation: "write",
				resourcePath: "/test/note2.md",
			};

			// Emit requests from different sessions
			eventBus.emitPermissionRequest(event1);
			await vi.advanceTimersByTimeAsync(10);
			eventBus.emitPermissionRequest(event2);
			await vi.advanceTimersByTimeAsync(10);

			// Clear previous calls
			(mockClient.respondToPermission as any).mockClear();

			// End only session-123
			eventBus.emitSessionEnd({ sessionId: "session-123" });
			await vi.advanceTimersByTimeAsync(10);

			// Only req-1 should be denied with "Session ended"
			expect(mockClient.respondToPermission).toHaveBeenCalledWith(
				"session-123",
				"req-1",
				false,
				"Session ended"
			);

			// req-2 should not be affected yet (check call count)
			const callsForReq2 = (mockClient.respondToPermission as any).mock.calls.filter(
				(call: any[]) => call[0] === "session-456" && call[1] === "req-2"
			);
			expect(callsForReq2).toHaveLength(0);

			// Clear calls
			(mockClient.respondToPermission as any).mockClear();

			// Fast forward to timeout for req-2
			await vi.advanceTimersByTimeAsync(60000);

			// req-2 should timeout normally
			expect(mockClient.respondToPermission).toHaveBeenCalledWith(
				"session-456",
				"req-2",
				false,
				"Request timed out"
			);

			vi.useRealTimers();
		});

		it("should clear timeouts when session ends", async () => {
			vi.useFakeTimers();

			const event: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/note.md",
			};

			eventBus.emitPermissionRequest(event);
			await vi.advanceTimersByTimeAsync(10);

			// Clear previous calls
			(mockClient.respondToPermission as any).mockClear();

			// End session
			eventBus.emitSessionEnd({ sessionId: "session-123" });
			await vi.advanceTimersByTimeAsync(10);

			// Should be denied with "Session ended"
			expect(mockClient.respondToPermission).toHaveBeenCalledWith(
				"session-123",
				"req-456",
				false,
				"Session ended"
			);

			(mockClient.respondToPermission as any).mockClear();

			// Fast forward past timeout - should not trigger timeout handler
			await vi.advanceTimersByTimeAsync(60000);

			expect(mockClient.respondToPermission).not.toHaveBeenCalled();

			vi.useRealTimers();
		});
	});
});
});
