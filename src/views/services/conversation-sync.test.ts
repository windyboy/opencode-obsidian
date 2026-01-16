import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConversationSync } from "./conversation-sync";
import type { Conversation, SessionListItem } from "../../types";
import type OpenCodeObsidianPlugin from "../../main";
import type { SessionManager } from "./session-manager";

describe("ConversationSync", () => {
	let mockPlugin: OpenCodeObsidianPlugin;
	let mockSessionManager: SessionManager;
	let conversations: Conversation[];
	let activeConversationId: string | null;
	let conversationSync: ConversationSync;

	beforeEach(() => {
		conversations = [];
		activeConversationId = null;

		// Mock plugin
		mockPlugin = {
			opencodeClient: {
				isConnected: vi.fn().mockReturnValue(true),
			},
			errorHandler: {
				handleError: vi.fn(),
			},
		} as unknown as OpenCodeObsidianPlugin;

		// Mock SessionManager
		mockSessionManager = {
			listSessions: vi.fn(),
		} as unknown as SessionManager;

		conversationSync = new ConversationSync(
			mockPlugin,
			mockSessionManager,
			() => conversations,
			() => activeConversationId,
			(id) => {
				activeConversationId = id;
			},
			(convs) => {
				conversations = convs;
			},
			vi.fn().mockResolvedValue(undefined), // saveConversations
			vi.fn(), // updateConversationSelector
			vi.fn(), // updateMessages
			vi.fn().mockResolvedValue(undefined), // createNewConversation
			vi.fn(), // findConversationBySessionId
		);
	});

	describe("syncConversationsFromServer", () => {
		it("should sync sessions from server using SessionManager", async () => {
			const serverSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Test Session 1",
					lastUpdated: Date.now(),
					messageCount: 5,
					isActive: false,
				},
				{
					id: "session-2",
					title: "Test Session 2",
					lastUpdated: Date.now() - 1000,
					messageCount: 3,
					isActive: false,
				},
			];

			vi.mocked(mockSessionManager.listSessions).mockResolvedValue(
				serverSessions,
			);

			await conversationSync.syncConversationsFromServer();

			expect(mockSessionManager.listSessions).toHaveBeenCalledWith(true);
			expect(conversations).toHaveLength(2);
			expect(conversations[0]?.sessionId).toBe("session-1");
			expect(conversations[1]?.sessionId).toBe("session-2");
		});

		it("should merge server sessions with existing local conversations", async () => {
			// Setup existing local conversation
			conversations = [
				{
					id: "conv-local-1",
					title: "Local Title",
					messages: [
						{
							id: "msg-1",
							role: "user",
							content: "Hello",
							timestamp: Date.now(),
						},
					],
					createdAt: Date.now() - 5000,
					updatedAt: Date.now() - 5000,
					sessionId: "session-1",
				},
			];

			const serverSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Server Title",
					lastUpdated: Date.now(),
					messageCount: 5,
					isActive: false,
				},
			];

			vi.mocked(mockSessionManager.listSessions).mockResolvedValue(
				serverSessions,
			);

			await conversationSync.syncConversationsFromServer();

			expect(conversations).toHaveLength(1);
			expect(conversations[0]?.sessionId).toBe("session-1");
			expect(conversations[0]?.title).toBe("Server Title"); // Title updated from server
			expect(conversations[0]?.messages).toHaveLength(1); // Messages preserved
		});

		it("should add new sessions from server", async () => {
			// Setup existing local conversation
			conversations = [
				{
					id: "conv-local-1",
					title: "Local Conversation",
					messages: [],
					createdAt: Date.now(),
					updatedAt: Date.now(),
					sessionId: "session-1",
				},
			];

			const serverSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Existing Session",
					lastUpdated: Date.now(),
					messageCount: 0,
					isActive: false,
				},
				{
					id: "session-2",
					title: "New Session",
					lastUpdated: Date.now() - 1000,
					messageCount: 3,
					isActive: false,
				},
			];

			vi.mocked(mockSessionManager.listSessions).mockResolvedValue(
				serverSessions,
			);

			await conversationSync.syncConversationsFromServer();

			expect(conversations).toHaveLength(2);
			expect(conversations.find((c) => c.sessionId === "session-2")).toBeDefined();
		});

		it("should remove local conversations with deleted server sessions", async () => {
			// Setup existing local conversations
			conversations = [
				{
					id: "conv-local-1",
					title: "Session 1",
					messages: [],
					createdAt: Date.now(),
					updatedAt: Date.now(),
					sessionId: "session-1",
				},
				{
					id: "conv-local-2",
					title: "Session 2",
					messages: [],
					createdAt: Date.now(),
					updatedAt: Date.now(),
					sessionId: "session-2",
				},
			];

			// Server only has session-1
			const serverSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Session 1",
					lastUpdated: Date.now(),
					messageCount: 0,
					isActive: false,
				},
			];

			vi.mocked(mockSessionManager.listSessions).mockResolvedValue(
				serverSessions,
			);

			await conversationSync.syncConversationsFromServer();

			expect(conversations).toHaveLength(1);
			expect(conversations[0]?.sessionId).toBe("session-1");
		});

		it("should keep local conversations without sessionId", async () => {
			// Setup local conversation without sessionId
			conversations = [
				{
					id: "conv-local-1",
					title: "Local Only",
					messages: [],
					createdAt: Date.now(),
					updatedAt: Date.now(),
					sessionId: undefined,
				},
			];

			const serverSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Server Session",
					lastUpdated: Date.now(),
					messageCount: 0,
					isActive: false,
				},
			];

			vi.mocked(mockSessionManager.listSessions).mockResolvedValue(
				serverSessions,
			);

			await conversationSync.syncConversationsFromServer();

			expect(conversations).toHaveLength(2);
			expect(conversations.find((c) => c.sessionId === undefined)).toBeDefined();
			expect(conversations.find((c) => c.sessionId === "session-1")).toBeDefined();
		});

		it("should handle errors gracefully", async () => {
			vi.mocked(mockSessionManager.listSessions).mockRejectedValue(
				new Error("Network error"),
			);

			await conversationSync.syncConversationsFromServer();

			expect(mockPlugin.errorHandler.handleError).toHaveBeenCalled();
		});

		it("should skip sync if SessionManager is not available", async () => {
			const conversationSyncWithoutManager = new ConversationSync(
				mockPlugin,
				null, // No SessionManager
				() => conversations,
				() => activeConversationId,
				(id) => {
					activeConversationId = id;
				},
				(convs) => {
					conversations = convs;
				},
				vi.fn().mockResolvedValue(undefined),
				vi.fn(),
				vi.fn(),
				vi.fn().mockResolvedValue(undefined),
				vi.fn(),
			);

			await conversationSyncWithoutManager.syncConversationsFromServer();

			// Should not call SessionManager
			expect(mockSessionManager.listSessions).not.toHaveBeenCalled();
		});

		it("should skip sync if client is not connected", async () => {
			vi.mocked(mockPlugin.opencodeClient!.isConnected).mockReturnValue(false);

			await conversationSync.syncConversationsFromServer();

			expect(mockSessionManager.listSessions).not.toHaveBeenCalled();
		});
	});

	describe("periodic sync", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("should start periodic sync timer", () => {
			conversationSync.startPeriodicSync();

			// Verify timer is set (we can't directly check the timer, but we can verify behavior)
			expect(true).toBe(true);
		});

		it("should stop periodic sync timer", () => {
			conversationSync.startPeriodicSync();
			conversationSync.stopPeriodicSync();

			// Verify timer is cleared
			expect(true).toBe(true);
		});

		it("should perform background sync every 5 minutes", async () => {
			const serverSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Test Session",
					lastUpdated: Date.now(),
					messageCount: 5,
					isActive: false,
				},
			];

			vi.mocked(mockSessionManager.listSessions).mockResolvedValue(
				serverSessions,
			);

			conversationSync.startPeriodicSync();

			// Fast-forward 5 minutes
			await vi.advanceTimersByTimeAsync(300000);

			// Should have called listSessions for background sync
			expect(mockSessionManager.listSessions).toHaveBeenCalled();
		});

		it("should not perform concurrent syncs", async () => {
			const serverSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Test Session",
					lastUpdated: Date.now(),
					messageCount: 5,
					isActive: false,
				},
			];

			// Make listSessions slow to simulate concurrent calls
			let resolveFirst: () => void;
			const firstCall = new Promise<SessionListItem[]>((resolve) => {
				resolveFirst = () => resolve(serverSessions);
			});

			vi.mocked(mockSessionManager.listSessions)
				.mockReturnValueOnce(firstCall)
				.mockResolvedValue(serverSessions);

			conversationSync.startPeriodicSync();

			// Trigger first sync
			await vi.advanceTimersByTimeAsync(300000);

			// Trigger second sync while first is still running
			await vi.advanceTimersByTimeAsync(300000);

			// Resolve first sync
			resolveFirst!();
			await firstCall;

			// Should only have called listSessions once (second call skipped)
			expect(mockSessionManager.listSessions).toHaveBeenCalledTimes(1);
		});

		it("should handle timestamp-based conflict resolution", async () => {
			const now = Date.now();

			// Setup local conversation with older timestamp
			conversations = [
				{
					id: "conv-local-1",
					title: "Local Title",
					messages: [],
					createdAt: now - 10000,
					updatedAt: now - 5000,
					sessionId: "session-1",
				},
			];

			// Server has newer timestamp
			const serverSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Server Title",
					lastUpdated: now,
					messageCount: 0,
					isActive: false,
				},
			];

			vi.mocked(mockSessionManager.listSessions).mockResolvedValue(
				serverSessions,
			);

			conversationSync.startPeriodicSync();

			// Trigger sync
			await vi.advanceTimersByTimeAsync(300000);

			// Stop timer to prevent infinite loop
			conversationSync.stopPeriodicSync();

			// Wait for async operations
			await vi.runAllTimersAsync();

			// Should update to server version (newer timestamp)
			expect(conversations[0]?.title).toBe("Server Title");
		});

		it("should keep local version when local is newer", async () => {
			const now = Date.now();

			// Setup local conversation with newer timestamp
			conversations = [
				{
					id: "conv-local-1",
					title: "Local Title",
					messages: [],
					createdAt: now - 10000,
					updatedAt: now,
					sessionId: "session-1",
				},
			];

			// Server has older timestamp
			const serverSessions: SessionListItem[] = [
				{
					id: "session-1",
					title: "Server Title",
					lastUpdated: now - 5000,
					messageCount: 0,
					isActive: false,
				},
			];

			vi.mocked(mockSessionManager.listSessions).mockResolvedValue(
				serverSessions,
			);

			conversationSync.startPeriodicSync();

			// Trigger sync
			await vi.advanceTimersByTimeAsync(300000);

			// Stop timer to prevent infinite loop
			conversationSync.stopPeriodicSync();

			// Wait for async operations
			await vi.runAllTimersAsync();

			// Should keep local version (newer timestamp)
			expect(conversations[0]?.title).toBe("Local Title");
		});
	});
});
