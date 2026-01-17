import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConversationManager } from "./conversation-manager";
import type { Conversation } from "../../types";
import type OpenCodeObsidianPlugin from "../../main";
import type { SessionManager } from "./session-manager";
import { Notice } from "obsidian";

// Mock Obsidian Notice
vi.mock("obsidian", () => ({
	Notice: vi.fn(),
}));

describe("ConversationManager - forkConversation", () => {
	let conversationManager: ConversationManager;
	let mockPlugin: any;
	let mockSessionManager: any;
	let conversations: Conversation[];
	let activeConversationId: string | null;
	let saveCallbackCalled: boolean;
	let updateConversationSelectorCalled: boolean;
	let updateMessagesCalled: boolean;
	let isLoading: boolean;

	beforeEach(() => {
		// Reset state
		conversations = [];
		activeConversationId = null;
		saveCallbackCalled = false;
		updateConversationSelectorCalled = false;
		updateMessagesCalled = false;
		isLoading = false;

		// Mock plugin
		mockPlugin = {
			opencodeClient: {
				isConnected: vi.fn().mockReturnValue(true),
			},
			errorHandler: {
				handleError: vi.fn(),
			},
			loadData: vi.fn().mockResolvedValue(null),
			saveData: vi.fn().mockResolvedValue(undefined),
		};

		// Mock session manager
		mockSessionManager = {
			forkSessionWithRetry: vi.fn(),
			loadSessionMessagesWithRetry: vi.fn().mockResolvedValue([]),
			setOnSessionNotFoundCallback: vi.fn(),
		};

		// Create conversation manager
		conversationManager = new ConversationManager(
			mockPlugin as OpenCodeObsidianPlugin,
			() => conversations,
			() => activeConversationId,
			(id: string | null) => {
				activeConversationId = id;
			},
			(convs: Conversation[]) => {
				conversations = convs;
			},
			async () => {
				saveCallbackCalled = true;
			},
			() => {
				updateConversationSelectorCalled = true;
			},
			() => {
				updateMessagesCalled = true;
			},
			mockSessionManager as SessionManager,
			(loading: boolean) => {
				isLoading = loading;
			},
		);
	});

	it("should fork conversation with correct title", async () => {
		// Setup parent conversation
		const parentConversation: Conversation = {
			id: "conv-1",
			title: "Parent Chat",
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			sessionId: "session-1",
		};
		conversations = [parentConversation];

		// Mock fork session response
		mockSessionManager.forkSessionWithRetry.mockResolvedValue("forked-session-1");

		// Fork conversation
		const forkedId = await conversationManager.forkConversation("conv-1");

		// Verify fork was called with correct parameters
		expect(mockSessionManager.forkSessionWithRetry).toHaveBeenCalledWith(
			"session-1",
			undefined,
			"Fork of Parent Chat",
		);

		// Verify new conversation was created
		expect(conversations.length).toBe(2);
		const forkedConv = conversations[0];
		expect(forkedConv?.title).toBe("Fork of Parent Chat");
		expect(forkedConv?.sessionId).toBe("forked-session-1");

		// Verify active conversation switched
		expect(activeConversationId).toBe(forkedId);

		// Verify messages were loaded
		expect(mockSessionManager.loadSessionMessagesWithRetry).toHaveBeenCalledWith("forked-session-1");

		// Verify success notice
		expect(Notice).toHaveBeenCalledWith("Session forked successfully");
	});

	it("should fork conversation from specific message", async () => {
		// Setup parent conversation
		const parentConversation: Conversation = {
			id: "conv-1",
			title: "Parent Chat",
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			sessionId: "session-1",
		};
		conversations = [parentConversation];

		// Mock fork session response
		mockSessionManager.forkSessionWithRetry.mockResolvedValue("forked-session-1");

		// Fork conversation from specific message
		await conversationManager.forkConversation("conv-1", "message-5");

		// Verify fork was called with message ID
		expect(mockSessionManager.forkSessionWithRetry).toHaveBeenCalledWith(
			"session-1",
			"message-5",
			"Fork of Parent Chat",
		);
	});

	it("should throw error if conversation not found", async () => {
		conversations = [];

		await expect(
			conversationManager.forkConversation("non-existent"),
		).rejects.toThrow("Conversation not found: non-existent");
	});

	it("should throw error if conversation has no sessionId", async () => {
		const localConversation: Conversation = {
			id: "conv-1",
			title: "Local Chat",
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			// No sessionId
		};
		conversations = [localConversation];

		await expect(
			conversationManager.forkConversation("conv-1"),
		).rejects.toThrow("Cannot fork conversation without sessionId: conv-1");
	});

	it("should throw error if client not connected", async () => {
		const parentConversation: Conversation = {
			id: "conv-1",
			title: "Parent Chat",
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			sessionId: "session-1",
		};
		conversations = [parentConversation];

		// Mock client not connected
		mockPlugin.opencodeClient.isConnected.mockReturnValue(false);

		await expect(
			conversationManager.forkConversation("conv-1"),
		).rejects.toThrow("OpenCode client not connected");
	});

	it("should handle fork failure and show error notice", async () => {
		const parentConversation: Conversation = {
			id: "conv-1",
			title: "Parent Chat",
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			sessionId: "session-1",
		};
		conversations = [parentConversation];

		// Mock fork failure
		const forkError = new Error("Fork failed");
		mockSessionManager.forkSessionWithRetry.mockRejectedValue(forkError);

		await expect(
			conversationManager.forkConversation("conv-1"),
		).rejects.toThrow("Fork failed");

		// Verify error was handled
		expect(mockPlugin.errorHandler.handleError).toHaveBeenCalled();

		// Verify error notice
		expect(Notice).toHaveBeenCalledWith("Failed to fork session");
	});

	it("should set loading state during fork operation", async () => {
		const parentConversation: Conversation = {
			id: "conv-1",
			title: "Parent Chat",
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			sessionId: "session-1",
		};
		conversations = [parentConversation];

		mockSessionManager.forkSessionWithRetry.mockResolvedValue("forked-session-1");

		await conversationManager.forkConversation("conv-1");

		// Loading state should be false after completion
		expect(isLoading).toBe(false);
	});
});
