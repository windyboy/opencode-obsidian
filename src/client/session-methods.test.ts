import { describe, it, expect, beforeEach, vi } from "vitest";
import { OpenCodeServerClient } from "./client";
import { ErrorHandler } from "../utils/error-handler";
import type { OpenCodeServerConfig } from "./types";

describe("OpenCodeServerClient - Session Methods", () => {
	let client: OpenCodeServerClient;
	let errorHandler: ErrorHandler;
	let mockSdkClient: any;

	beforeEach(() => {
		errorHandler = new ErrorHandler();
		const config: OpenCodeServerConfig = {
			url: "http://localhost:4096",
			requestTimeoutMs: 10000,
		};

		client = new OpenCodeServerClient(config, errorHandler);

		// Mock the SDK client
		mockSdkClient = {
			session: {
				list: vi.fn(),
				messages: vi.fn(),
				update: vi.fn(),
				delete: vi.fn(),
			},
		};

		// Replace the SDK client with our mock
		(client as any).sdkClient = mockSdkClient;
	});

	describe("listSessions", () => {
		it("should list sessions successfully", async () => {
			const mockSessions = [
				{
					id: "session-1",
					title: "Test Session 1",
					time: { created: 1000, updated: 2000 },
				},
				{
					id: "session-2",
					title: "Test Session 2",
					time: { created: 1500, updated: 2500 },
				},
			];

			mockSdkClient.session.list.mockResolvedValue({
				data: mockSessions,
				error: null,
			});

			const sessions = await client.listSessions();

			expect(sessions).toHaveLength(2);
			expect(sessions[0]).toMatchObject({
				id: "session-1",
				title: "Test Session 1",
				lastUpdated: 2000,
				messageCount: 0,
				isActive: false,
			});
			expect(sessions[1]).toMatchObject({
				id: "session-2",
				title: "Test Session 2",
				lastUpdated: 2500,
				messageCount: 0,
				isActive: false,
			});
		});

		it("should handle error response", async () => {
			mockSdkClient.session.list.mockResolvedValue({
				data: null,
				error: "Server error",
			});

			await expect(client.listSessions()).rejects.toThrow(
				"Failed to list sessions: Server error",
			);
		});

		it("should handle 404 error", async () => {
			const error = new Error("Not found");
			(error as any).status = 404;
			mockSdkClient.session.list.mockRejectedValue(error);

			await expect(client.listSessions()).rejects.toThrow(
				"Resource not found during listing sessions",
			);
		});

		it("should handle 500 error", async () => {
			const error = new Error("Internal server error");
			(error as any).status = 500;
			mockSdkClient.session.list.mockRejectedValue(error);

			await expect(client.listSessions()).rejects.toThrow(
				"Server error during listing sessions",
			);
		});
	});

	describe("getSessionMessages", () => {
		it("should get session messages successfully", async () => {
			const mockMessages = [
				{
					info: {
						id: "msg-1",
						role: "user",
						time: { created: 1000 },
					},
					parts: [{ type: "text", text: "Hello" }],
				},
				{
					info: {
						id: "msg-2",
						role: "assistant",
						time: { created: 2000 },
					},
					parts: [{ type: "text", text: "Hi there!" }],
				},
			];

			mockSdkClient.session.messages.mockResolvedValue({
				data: mockMessages,
				error: null,
			});

			const messages = await client.getSessionMessages("session-1");

			expect(messages).toHaveLength(2);
			expect(messages[0]).toMatchObject({
				id: "msg-1",
				role: "user",
				content: "Hello",
				timestamp: 1000,
			});
			expect(messages[1]).toMatchObject({
				id: "msg-2",
				role: "assistant",
				content: "Hi there!",
				timestamp: 2000,
			});
		});

		it("should handle 404 error for non-existent session", async () => {
			const error = new Error("Not found");
			(error as any).status = 404;
			mockSdkClient.session.messages.mockRejectedValue(error);

			await expect(
				client.getSessionMessages("non-existent"),
			).rejects.toThrow("Session non-existent not found");
		});
	});

	describe("updateSessionTitle", () => {
		it("should update session title successfully", async () => {
			mockSdkClient.session.update.mockResolvedValue({
				data: { id: "session-1", title: "New Title" },
				error: null,
			});

			await expect(
				client.updateSessionTitle("session-1", "New Title"),
			).resolves.toBeUndefined();
		});

		it("should handle 404 error for non-existent session", async () => {
			const error = new Error("Not found");
			(error as any).status = 404;
			mockSdkClient.session.update.mockRejectedValue(error);

			await expect(
				client.updateSessionTitle("non-existent", "New Title"),
			).rejects.toThrow("Session non-existent not found");
		});

		it("should handle 500 error", async () => {
			const error = new Error("Internal server error");
			(error as any).status = 500;
			mockSdkClient.session.update.mockRejectedValue(error);

			await expect(
				client.updateSessionTitle("session-1", "New Title"),
			).rejects.toThrow("Server error during updating session title");
		});
	});

	describe("deleteSession", () => {
		it("should delete session successfully", async () => {
			mockSdkClient.session.delete.mockResolvedValue({
				data: true,
				error: null,
			});

			await expect(
				client.deleteSession("session-1"),
			).resolves.toBeUndefined();
		});

		it("should handle 404 error and clean up local state", async () => {
			const error = new Error("Not found");
			(error as any).status = 404;
			mockSdkClient.session.delete.mockRejectedValue(error);

			// Add session to local cache first
			(client as any).sessions.set("session-1", { id: "session-1" });
			(client as any).currentSessionId = "session-1";

			await expect(client.deleteSession("session-1")).rejects.toThrow(
				"Session session-1 not found",
			);

			// Verify local state was cleaned up despite error
			expect((client as any).sessions.has("session-1")).toBe(false);
			expect((client as any).currentSessionId).toBe(null);
		});

		it("should handle 500 error", async () => {
			const error = new Error("Internal server error");
			(error as any).status = 500;
			mockSdkClient.session.delete.mockRejectedValue(error);

			await expect(client.deleteSession("session-1")).rejects.toThrow(
				"Server error during deleting session",
			);
		});
	});
});
