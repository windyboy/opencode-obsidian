import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the SDK client
const mockSDKClient = {
	event: {
		subscribe: vi.fn(),
	},
	session: {
		create: vi.fn(),
		get: vi.fn(),
		prompt: vi.fn(),
		abort: vi.fn(),
	},
};

vi.mock("obsidian", () => ({
	requestUrl: vi.fn(),
}));

vi.mock("@opencode-ai/sdk/client", () => ({
	createOpencodeClient: vi.fn(() => mockSDKClient),
}));

import { ErrorHandler } from "../utils/error-handler";
import { OpenCodeServerClient } from "../client/client";
import { ConnectionManager } from "./connection-manager";

function createMockStream(events: any[]): AsyncGenerator<any, any, unknown> {
	return (async function* () {
		for (const event of events) {
			yield event;
		}
	})();
}

describe("ConnectionManager", () => {
	let errorHandler: ErrorHandler;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		errorHandler = new ErrorHandler({
			showUserNotifications: false,
			logToConsole: false,
			collectErrors: false,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("ensureConnected waits for connected state", async () => {
		mockSDKClient.event.subscribe.mockResolvedValue({
			data: { stream: createMockStream([]) },
			error: null,
		});

		const client = new OpenCodeServerClient(
			{ url: "http://127.0.0.1:4096", autoReconnect: false },
			errorHandler,
		);
		const manager = new ConnectionManager(client, errorHandler);

		const promise = manager.ensureConnected(1000);
		// Wait for async operations (use a small delay instead of runAllTimersAsync)
		await vi.advanceTimersByTimeAsync(100);
		await expect(promise).resolves.toBeUndefined();
		expect(manager.getDiagnostics().state).toBe("connected");

		await client.disconnect();
	});
});
