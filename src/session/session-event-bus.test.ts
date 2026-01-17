import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
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

	describe("Property-based tests", () => {
		describe("Event flow integrity", () => {
			/**
			 * **Validates: Requirements 1.1, 1.2**
			 *
			 * Property: For any valid permission.request event, all registered listeners
			 * receive the event with complete data (sessionId, requestId, operation, resourcePath).
			 *
			 * This test generates random valid PermissionRequestEvent objects, registers
			 * multiple listeners, emits the event, and verifies all listeners received
			 * the complete event data.
			 */
			it("should deliver complete event data to all listeners", () => {
				// Generator for valid PermissionRequestEvent
				const permissionRequestArbitrary = fc.record({
					sessionId: fc.string({ minLength: 1, maxLength: 50 }),
					requestId: fc.string({ minLength: 1, maxLength: 50 }),
					operation: fc.oneof(
						fc.constant("read"),
						fc.constant("write"),
						fc.constant("create"),
						fc.constant("modify"),
						fc.constant("delete"),
					),
					resourcePath: fc.string({ minLength: 1, maxLength: 200 }),
					context: fc.option(
						fc.record({
							toolName: fc.option(fc.string({ minLength: 1, maxLength: 50 }), {
								nil: undefined,
							}),
							args: fc.option(fc.anything(), { nil: undefined }),
							preview: fc.option(
								fc.record({
									originalContent: fc.option(fc.string(), { nil: undefined }),
									newContent: fc.option(fc.string(), { nil: undefined }),
									mode: fc.option(fc.string(), { nil: undefined }),
								}),
								{ nil: undefined },
							),
						}),
						{ nil: undefined },
					),
				});

				// Property test
				fc.assert(
					fc.property(
						permissionRequestArbitrary,
						fc.integer({ min: 1, max: 10 }), // Number of listeners
						(event, listenerCount) => {
							const eventBus = new SessionEventBus();
							const receivedEvents: PermissionRequestEvent[][] = [];

							// Register multiple listeners
							for (let i = 0; i < listenerCount; i++) {
								const listenerEvents: PermissionRequestEvent[] = [];
								receivedEvents.push(listenerEvents);
								eventBus.onPermissionRequest((e) => {
									listenerEvents.push(e);
								});
							}

							// Emit event
							eventBus.emitPermissionRequest(event);

							// Verify all listeners received the event
							expect(receivedEvents).toHaveLength(listenerCount);

							for (const listenerEvents of receivedEvents) {
								// Each listener should have received exactly one event
								expect(listenerEvents).toHaveLength(1);

								const receivedEvent = listenerEvents[0];

								// Verify complete data integrity
								expect(receivedEvent).toBeDefined();
								expect(receivedEvent?.sessionId).toBe(event.sessionId);
								expect(receivedEvent?.requestId).toBe(event.requestId);
								expect(receivedEvent?.operation).toBe(event.operation);
								expect(receivedEvent?.resourcePath).toBe(event.resourcePath);

								// Verify context if present
								if (event.context !== undefined) {
									expect(receivedEvent?.context).toBeDefined();
									expect(receivedEvent?.context?.toolName).toBe(
										event.context.toolName,
									);
									expect(receivedEvent?.context?.args).toEqual(
										event.context.args,
									);
									if (
										event.context.preview !== undefined &&
										event.context.preview !== null
									) {
										expect(receivedEvent?.context?.preview).toBeDefined();
										expect(
											receivedEvent?.context?.preview?.originalContent,
										).toBe(event.context.preview.originalContent);
										expect(receivedEvent?.context?.preview?.newContent).toBe(
											event.context.preview.newContent,
										);
										expect(receivedEvent?.context?.preview?.mode).toBe(
											event.context.preview.mode,
										);
									}
								} else {
									expect(receivedEvent?.context).toBeUndefined();
								}
							}
						},
					),
					{ numRuns: 100 }, // Run 100+ iterations as specified
				);
			});
		});
	});
});
