import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionManager } from "./session-manager";
import type { OpenCodeServerClient } from "../../opencode-server/client";
import type { SessionListItem, Message } from "../../types";
import { ErrorHandler } from "../../utils/error-handler";

describe("SessionManager", () => {
	let mockClient: OpenCodeServerClient;
	let errorHandler: ErrorHandler;
	let sessionManager: SessionManager;

	beforeEach(() => {
		// Create real ErrorHandler instance
		errorHandler = new ErrorHandler();
		vi.spyOn(errorHandler, "handleError");

		// Mock OpenCodeServerClient
		mockClient = {
			listSessions: vi.fn(),
			createSession: vi.fn(),
			getSessionMessages: vi.fn(),
			updateSessionTitle: vi.fn(),
			deleteSession: vi.fn(),
			hasFeature: vi.fn(),
			getConfig: vi.fn().mockReturnValue({ url: "http://localhost:4096" }),
		} as unknown as OpenCodeServerClient;

		sessionManager = new SessionManager(mockClient, errorHandler);
	});

	describe("listSessions", () => {
		it("should return sessions from server", async () => {
			const mockSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Test Session 1",
					lastUpdated: 1000,
					messageCount: 5,
					isActive: false,
				},
				{
					id: "session-2",
					title: "Test Session 2",
					lastUpdated: 2000,
					messageCount: 3,
					isActive: true,
				},
			];

			vi.mocked(mockClient.listSessions).mockResolvedValue(mockSessions);

			const result = await sessionManager.listSessions();

			expect(result).toEqual(mockSessions);
			expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
		});

		it("should cache sessions and return from cache on subsequent calls", async () => {
			const mockSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Test Session",
					lastUpdated: 1000,
					messageCount: 5,
					isActive: false,
				},
			];

			vi.mocked(mockClient.listSessions).mockResolvedValue(mockSessions);

			// First call - should fetch from server
			const result1 = await sessionManager.listSessions();
			expect(result1).toEqual(mockSessions);
			expect(mockClient.listSessions).toHaveBeenCalledTimes(1);

			// Second call - should return from cache
			const result2 = await sessionManager.listSessions();
			expect(result2).toEqual(mockSessions);
			expect(mockClient.listSessions).toHaveBeenCalledTimes(1); // Still 1, not called again
		});

		it("should bypass cache when forceRefresh is true", async () => {
			const mockSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Test Session",
					lastUpdated: 1000,
					messageCount: 5,
					isActive: false,
				},
			];

			vi.mocked(mockClient.listSessions).mockResolvedValue(mockSessions);

			// First call
			await sessionManager.listSessions();
			expect(mockClient.listSessions).toHaveBeenCalledTimes(1);

			// Second call with forceRefresh
			await sessionManager.listSessions(true);
			expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
		});

		it("should switch to local-only mode and return empty array on error", async () => {
			const error = new Error("Network error");
			vi.mocked(mockClient.listSessions).mockRejectedValue(error);

			const result = await sessionManager.listSessions();
			
			expect(result).toEqual([]);
			expect(sessionManager.isLocalOnlyMode()).toBe(true);
			expect(errorHandler.handleError).toHaveBeenCalled();
		});

		it("should return empty array when server returns empty list", async () => {
			vi.mocked(mockClient.listSessions).mockResolvedValue([]);

			const result = await sessionManager.listSessions();

			expect(result).toEqual([]);
			expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
		});
	});

	describe("createSession", () => {
		it("should create session on server and return session ID", async () => {
			const sessionId = "new-session-id";
			vi.mocked(mockClient.createSession).mockResolvedValue(sessionId);

			const result = await sessionManager.createSession("Test Session");

			expect(result).toBe(sessionId);
			expect(mockClient.createSession).toHaveBeenCalledWith("Test Session");
		});

		it("should create session without title", async () => {
			const sessionId = "new-session-id";
			vi.mocked(mockClient.createSession).mockResolvedValue(sessionId);

			const result = await sessionManager.createSession();

			expect(result).toBe(sessionId);
			expect(mockClient.createSession).toHaveBeenCalledWith(undefined);
		});

		it("should invalidate cache after creating session", async () => {
			const mockSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Old Session",
					lastUpdated: 1000,
					messageCount: 5,
					isActive: false,
				},
			];

			const newSessionId = "new-session-id";
			vi.mocked(mockClient.listSessions).mockResolvedValue(mockSessions);
			vi.mocked(mockClient.createSession).mockResolvedValue(newSessionId);

			// Populate cache
			await sessionManager.listSessions();
			expect(mockClient.listSessions).toHaveBeenCalledTimes(1);

			// Create new session
			await sessionManager.createSession("New Session");

			// Next listSessions should fetch from server again (cache invalidated)
			await sessionManager.listSessions();
			expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
		});

		it("should handle errors and call error handler", async () => {
			const error = new Error("Server error");
			vi.mocked(mockClient.createSession).mockRejectedValue(error);

			await expect(sessionManager.createSession("Test")).rejects.toThrow("Server error");
			expect(errorHandler.handleError).toHaveBeenCalled();
		});
	});

	describe("loadSessionMessages", () => {
		it("should fetch and return messages from server", async () => {
			const mockMessages: Message[] = [
				{
					id: "msg-1",
					role: "user",
					content: "Hello",
					timestamp: 1000,
				},
				{
					id: "msg-2",
					role: "assistant",
					content: "Hi there!",
					timestamp: 2000,
				},
			];

			vi.mocked(mockClient.getSessionMessages).mockResolvedValue(mockMessages);

			const result = await sessionManager.loadSessionMessages("session-1");

			expect(result).toEqual(mockMessages);
			expect(mockClient.getSessionMessages).toHaveBeenCalledWith("session-1");
		});

		it("should return empty array when session has no messages", async () => {
			vi.mocked(mockClient.getSessionMessages).mockResolvedValue([]);

			const result = await sessionManager.loadSessionMessages("session-1");

			expect(result).toEqual([]);
		});

		it("should return empty array on error and call error handler", async () => {
			const error = new Error("Session not found");
			vi.mocked(mockClient.getSessionMessages).mockRejectedValue(error);

			const result = await sessionManager.loadSessionMessages("invalid-id");
			
			expect(result).toEqual([]);
			expect(errorHandler.handleError).toHaveBeenCalled();
		});

		it("should preserve message order from server", async () => {
			const mockMessages: Message[] = [
				{
					id: "msg-1",
					role: "user",
					content: "First",
					timestamp: 1000,
				},
				{
					id: "msg-2",
					role: "assistant",
					content: "Second",
					timestamp: 2000,
				},
				{
					id: "msg-3",
					role: "user",
					content: "Third",
					timestamp: 3000,
				},
			];

			vi.mocked(mockClient.getSessionMessages).mockResolvedValue(mockMessages);

			const result = await sessionManager.loadSessionMessages("session-1");

			expect(result).toHaveLength(3);
			expect(result[0]?.content).toBe("First");
			expect(result[1]?.content).toBe("Second");
			expect(result[2]?.content).toBe("Third");
		});
	});

	describe("updateSessionTitle", () => {
		it("should update session title on server", async () => {
			vi.mocked(mockClient.updateSessionTitle).mockResolvedValue(undefined);

			await sessionManager.updateSessionTitle("session-1", "New Title");

			expect(mockClient.updateSessionTitle).toHaveBeenCalledWith(
				"session-1",
				"New Title",
			);
		});

		it("should invalidate cache after updating title", async () => {
			const mockSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Old Title",
					lastUpdated: 1000,
					messageCount: 5,
					isActive: false,
				},
			];

			vi.mocked(mockClient.listSessions).mockResolvedValue(mockSessions);
			vi.mocked(mockClient.updateSessionTitle).mockResolvedValue(undefined);

			// Populate cache
			await sessionManager.listSessions();
			expect(mockClient.listSessions).toHaveBeenCalledTimes(1);

			// Update title
			await sessionManager.updateSessionTitle("session-1", "New Title");

			// Next listSessions should fetch from server again (cache invalidated)
			await sessionManager.listSessions();
			expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
		});

		it("should silently handle errors and call error handler", async () => {
			const error = new Error("Session not found");
			vi.mocked(mockClient.updateSessionTitle).mockRejectedValue(error);

			await sessionManager.updateSessionTitle("invalid-id", "New Title");
			
			expect(errorHandler.handleError).toHaveBeenCalled();
		});
	});

	describe("deleteSession", () => {
		it("should delete session from server", async () => {
			vi.mocked(mockClient.deleteSession).mockResolvedValue(undefined);

			await sessionManager.deleteSession("session-1");

			expect(mockClient.deleteSession).toHaveBeenCalledWith("session-1");
		});

		it("should invalidate cache after deleting session", async () => {
			const mockSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Session 1",
					lastUpdated: 1000,
					messageCount: 5,
					isActive: false,
				},
			];

			vi.mocked(mockClient.listSessions).mockResolvedValue(mockSessions);
			vi.mocked(mockClient.deleteSession).mockResolvedValue(undefined);

			// Populate cache
			await sessionManager.listSessions();
			expect(mockClient.listSessions).toHaveBeenCalledTimes(1);

			// Delete session
			await sessionManager.deleteSession("session-1");

			// Next listSessions should fetch from server again (cache invalidated)
			await sessionManager.listSessions();
			expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
		});

		it("should silently handle errors and call error handler", async () => {
			const error = new Error("Session not found");
			vi.mocked(mockClient.deleteSession).mockRejectedValue(error);

			await sessionManager.deleteSession("invalid-id");
			
			expect(errorHandler.handleError).toHaveBeenCalledWith(
				error,
				expect.objectContaining({
					module: "SessionManager",
					function: "deleteSession",
					operation: "Deleting session",
					metadata: { sessionId: "invalid-id" },
				}),
				expect.any(String),
			);
		});
	});

	describe("cache management", () => {
		it("should expire cache after TTL (5 minutes)", async () => {
			const mockSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Test Session",
					lastUpdated: 1000,
					messageCount: 5,
					isActive: false,
				},
			];

			vi.mocked(mockClient.listSessions).mockResolvedValue(mockSessions);

			// First call - populate cache
			await sessionManager.listSessions();
			expect(mockClient.listSessions).toHaveBeenCalledTimes(1);

			// Mock time passing (5 minutes + 1ms)
			const originalDateNow = Date.now;
			const startTime = originalDateNow();
			Date.now = vi.fn(() => startTime + 5 * 60 * 1000 + 1);

			// Second call - cache should be expired
			await sessionManager.listSessions();
			expect(mockClient.listSessions).toHaveBeenCalledTimes(2);

			// Restore Date.now
			Date.now = originalDateNow;
		});

		it("should use cache within TTL period", async () => {
			const mockSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Test Session",
					lastUpdated: 1000,
					messageCount: 5,
					isActive: false,
				},
			];

			vi.mocked(mockClient.listSessions).mockResolvedValue(mockSessions);

			// First call - populate cache
			await sessionManager.listSessions();
			expect(mockClient.listSessions).toHaveBeenCalledTimes(1);

			// Mock time passing (4 minutes - still within TTL)
			const originalDateNow = Date.now;
			const startTime = originalDateNow();
			Date.now = vi.fn(() => startTime + 4 * 60 * 1000);

			// Second call - cache should still be valid
			await sessionManager.listSessions();
			expect(mockClient.listSessions).toHaveBeenCalledTimes(1); // Still 1

			// Restore Date.now
			Date.now = originalDateNow;
		});

		it("should clear cache manually with clearCache", async () => {
			const mockSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Test Session",
					lastUpdated: 1000,
					messageCount: 5,
					isActive: false,
				},
			];

			vi.mocked(mockClient.listSessions).mockResolvedValue(mockSessions);

			// Populate cache
			await sessionManager.listSessions();
			expect(mockClient.listSessions).toHaveBeenCalledTimes(1);

			// Clear cache manually
			sessionManager.clearCache();

			// Next call should fetch from server
			await sessionManager.listSessions();
			expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
		});
	});

	describe("error handling", () => {
		it("should return empty array on 404 error", async () => {
			const error = Object.assign(new Error("Not found"), { status: 404 });
			vi.mocked(mockClient.getSessionMessages).mockRejectedValue(error);

			const result = await sessionManager.loadSessionMessages("invalid-id");
			
			expect(result).toEqual([]);
			expect(errorHandler.handleError).toHaveBeenCalled();
		});

		it("should switch to local-only mode on 500 error", async () => {
			const error = Object.assign(new Error("Server error"), { status: 500 });
			vi.mocked(mockClient.listSessions).mockRejectedValue(error);

			const result = await sessionManager.listSessions();
			
			expect(result).toEqual([]);
			expect(sessionManager.isLocalOnlyMode()).toBe(true);
			expect(errorHandler.handleError).toHaveBeenCalled();
		});

		it("should handle network failures", async () => {
			const error = new Error("Network request failed");
			vi.mocked(mockClient.createSession).mockRejectedValue(error);

			await expect(sessionManager.createSession("Test")).rejects.toThrow(
				"Error during creating session",
			);
			expect(errorHandler.handleError).toHaveBeenCalled();
		});
	});

	describe("feature detection and compatibility", () => {
		it("should detect when all core features are available", async () => {
			vi.mocked(mockClient.hasFeature).mockResolvedValue(true);

			const result = await sessionManager.checkFeatureAvailability();

			expect(result).toBe(true);
			expect(sessionManager.isLocalOnlyMode()).toBe(false);
			expect(mockClient.hasFeature).toHaveBeenCalledWith("session.list");
			expect(mockClient.hasFeature).toHaveBeenCalledWith("session.create");
			expect(mockClient.hasFeature).toHaveBeenCalledWith("session.get");
			expect(mockClient.hasFeature).toHaveBeenCalledWith("session.messages");
		});

		it("should switch to local-only mode when core features are missing", async () => {
			vi.mocked(mockClient.hasFeature).mockImplementation(async (feature: string) => {
				// Only session.list is missing
				return feature !== "session.list";
			});

			const result = await sessionManager.checkFeatureAvailability();

			expect(result).toBe(false);
			expect(sessionManager.isLocalOnlyMode()).toBe(true);
		});

		it("should return empty array in local-only mode for listSessions", async () => {
			vi.mocked(mockClient.hasFeature).mockResolvedValue(false);
			await sessionManager.checkFeatureAvailability();

			const result = await sessionManager.listSessions();

			expect(result).toEqual([]);
			expect(mockClient.listSessions).not.toHaveBeenCalled();
		});

		it("should throw error in local-only mode for createSession", async () => {
			vi.mocked(mockClient.hasFeature).mockResolvedValue(false);
			await sessionManager.checkFeatureAvailability();

			await expect(sessionManager.createSession("Test")).rejects.toThrow(
				"Session creation is not available",
			);
			expect(mockClient.createSession).not.toHaveBeenCalled();
		});

		it("should return empty array in local-only mode for loadSessionMessages", async () => {
			vi.mocked(mockClient.hasFeature).mockResolvedValue(false);
			await sessionManager.checkFeatureAvailability();

			const result = await sessionManager.loadSessionMessages("session-1");

			expect(result).toEqual([]);
			expect(mockClient.getSessionMessages).not.toHaveBeenCalled();
		});

		it("should silently ignore updateSessionTitle in local-only mode", async () => {
			vi.mocked(mockClient.hasFeature).mockResolvedValue(false);
			await sessionManager.checkFeatureAvailability();

			await sessionManager.updateSessionTitle("session-1", "New Title");

			expect(mockClient.updateSessionTitle).not.toHaveBeenCalled();
		});

		it("should silently ignore deleteSession in local-only mode", async () => {
			vi.mocked(mockClient.hasFeature).mockResolvedValue(false);
			await sessionManager.checkFeatureAvailability();

			await sessionManager.deleteSession("session-1");

			expect(mockClient.deleteSession).not.toHaveBeenCalled();
		});

		it("should get missing core features", async () => {
			vi.mocked(mockClient.hasFeature).mockImplementation(async (feature: string) => {
				// session.list and session.create are missing
				return feature !== "session.list" && feature !== "session.create";
			});

			const missing = await sessionManager.getMissingCoreFeatures();

			expect(missing).toEqual(["session.list", "session.create"]);
		});

		it("should generate user-friendly error message for missing features", async () => {
			vi.mocked(mockClient.hasFeature).mockImplementation(async (feature: string) => {
				return feature !== "session.list";
			});

			const errorMessage = await sessionManager.getFeatureErrorMessage();

			expect(errorMessage).toContain("Session management is not available");
			expect(errorMessage).toContain("session.list");
			expect(errorMessage).toContain("OpenCode Server version 1.0.0 or later");
		});

		it("should return empty error message when all features are available", async () => {
			vi.mocked(mockClient.hasFeature).mockResolvedValue(true);

			const errorMessage = await sessionManager.getFeatureErrorMessage();

			expect(errorMessage).toBe("");
		});

		it("should switch to local-only mode on feature detection error", async () => {
			vi.mocked(mockClient.hasFeature).mockRejectedValue(new Error("Network error"));

			const result = await sessionManager.checkFeatureAvailability();

			expect(result).toBe(false);
			expect(sessionManager.isLocalOnlyMode()).toBe(true);
			expect(errorHandler.handleError).toHaveBeenCalled();
		});

		it("should switch to local-only mode when listSessions fails", async () => {
			vi.mocked(mockClient.listSessions).mockRejectedValue(new Error("Server error"));

			const result = await sessionManager.listSessions();

			expect(result).toEqual([]);
			expect(sessionManager.isLocalOnlyMode()).toBe(true);
			expect(errorHandler.handleError).toHaveBeenCalled();
		});
	});
});
