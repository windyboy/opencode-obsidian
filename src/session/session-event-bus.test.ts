import { describe, it, expect, beforeEach } from "vitest";
import {
	SessionEventBus,
	type PermissionRequestEvent,
} from "./session-event-bus";

describe("SessionEventBus - Permission Events", () => {
	let eventBus: SessionEventBus;

	beforeEach(() => {
		eventBus = new SessionEventBus();
	});

	describe("onPermissionRequest", () => {
		it("should register listener and receive emitted events", () => {
			const receivedEvents: PermissionRequestEvent[] = [];
			const listener = (event: PermissionRequestEvent) => {
				receivedEvents.push(event);
			};

			eventBus.onPermissionRequest(listener);

			const testEvent: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/path.md",
			};

			eventBus.emitPermissionRequest(testEvent);

			expect(receivedEvents).toHaveLength(1);
			expect(receivedEvents[0]).toEqual(testEvent);
		});

		it("should allow multiple listeners to receive the same event", () => {
			const receivedEvents1: PermissionRequestEvent[] = [];
			const receivedEvents2: PermissionRequestEvent[] = [];

			const listener1 = (event: PermissionRequestEvent) => {
				receivedEvents1.push(event);
			};
			const listener2 = (event: PermissionRequestEvent) => {
				receivedEvents2.push(event);
			};

			eventBus.onPermissionRequest(listener1);
			eventBus.onPermissionRequest(listener2);

			const testEvent: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "read",
				resourcePath: "/test/file.md",
				context: {
					toolName: "obsidian.read_note",
					args: { path: "/test/file.md" },
				},
			};

			eventBus.emitPermissionRequest(testEvent);

			expect(receivedEvents1).toHaveLength(1);
			expect(receivedEvents2).toHaveLength(1);
			expect(receivedEvents1[0]).toEqual(testEvent);
			expect(receivedEvents2[0]).toEqual(testEvent);
		});

		it("should remove listener when unsubscribe is called", () => {
			const receivedEvents: PermissionRequestEvent[] = [];
			const listener = (event: PermissionRequestEvent) => {
				receivedEvents.push(event);
			};

			const unsubscribe = eventBus.onPermissionRequest(listener);

			const testEvent1: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-1",
				operation: "write",
				resourcePath: "/test/path1.md",
			};

			eventBus.emitPermissionRequest(testEvent1);
			expect(receivedEvents).toHaveLength(1);

			// Unsubscribe
			unsubscribe();

			const testEvent2: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-2",
				operation: "write",
				resourcePath: "/test/path2.md",
			};

			eventBus.emitPermissionRequest(testEvent2);

			// Should still be 1, not 2
			expect(receivedEvents).toHaveLength(1);
			expect(receivedEvents[0]).toEqual(testEvent1);
		});

		it("should handle events with optional context fields", () => {
			const receivedEvents: PermissionRequestEvent[] = [];
			const listener = (event: PermissionRequestEvent) => {
				receivedEvents.push(event);
			};

			eventBus.onPermissionRequest(listener);

			const testEvent: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "modify",
				resourcePath: "/test/note.md",
				context: {
					toolName: "obsidian.update_note",
					args: { path: "/test/note.md", content: "new content" },
					preview: {
						originalContent: "old content",
						newContent: "new content",
						mode: "replace",
					},
				},
			};

			eventBus.emitPermissionRequest(testEvent);

			expect(receivedEvents).toHaveLength(1);
			expect(receivedEvents[0]).toEqual(testEvent);
			expect(receivedEvents[0]?.context?.toolName).toBe(
				"obsidian.update_note",
			);
			expect(receivedEvents[0]?.context?.preview?.originalContent).toBe(
				"old content",
			);
		});

		it("should handle events without context", () => {
			const receivedEvents: PermissionRequestEvent[] = [];
			const listener = (event: PermissionRequestEvent) => {
				receivedEvents.push(event);
			};

			eventBus.onPermissionRequest(listener);

			const testEvent: PermissionRequestEvent = {
				sessionId: "session-789",
				requestId: "req-101",
				operation: "delete",
				resourcePath: "/test/old-file.md",
			};

			eventBus.emitPermissionRequest(testEvent);

			expect(receivedEvents).toHaveLength(1);
			expect(receivedEvents[0]).toEqual(testEvent);
			expect(receivedEvents[0]?.context).toBeUndefined();
		});

		it("should not affect other event types", () => {
			const permissionEvents: PermissionRequestEvent[] = [];
			const sessionEndEvents: any[] = [];

			eventBus.onPermissionRequest((event) => {
				permissionEvents.push(event);
			});

			eventBus.onSessionEnd((event) => {
				sessionEndEvents.push(event);
			});

			const permissionEvent: PermissionRequestEvent = {
				sessionId: "session-123",
				requestId: "req-456",
				operation: "write",
				resourcePath: "/test/path.md",
			};

			eventBus.emitPermissionRequest(permissionEvent);

			expect(permissionEvents).toHaveLength(1);
			expect(sessionEndEvents).toHaveLength(0);

			eventBus.emitSessionEnd({ sessionId: "session-123" });

			expect(permissionEvents).toHaveLength(1);
			expect(sessionEndEvents).toHaveLength(1);
		});
	});

});
