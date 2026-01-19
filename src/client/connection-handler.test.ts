/**
 * Comprehensive tests for ConnectionHandler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConnectionHandler } from "./connection-handler";
import { ErrorHandler, ErrorSeverity } from "../utils/error-handler";
import type {
	OpenCodeServerConfig,
	ConnectionState,
	ReconnectAttemptInfo,
	HealthCheckResult,
} from "./types";

// Mock health check utility
vi.mock("../utils/health-check", () => ({
	performHealthCheck: vi.fn(),
}));

import { performHealthCheck } from "../utils/health-check";

describe("ConnectionHandler", () => {
	let handler: ConnectionHandler;
	let mockErrorHandler: ErrorHandler;
	let mockConfig: OpenCodeServerConfig;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();

		mockErrorHandler = {
			handleError: vi.fn(),
		} as unknown as ErrorHandler;

		mockConfig = {
			url: "http://localhost:4096",
			requestTimeoutMs: 10000,
			autoReconnect: true,
			reconnectDelay: 1000,
			reconnectMaxAttempts: 3,
		};

		handler = new ConnectionHandler(mockConfig, mockErrorHandler);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("Constructor and initialization", () => {
		it("should initialize with disconnected state", () => {
			expect(handler.getConnectionState()).toBe("disconnected");
			expect(handler.isConnected()).toBe(false);
		});

		it("should initialize with null health status", () => {
			expect(handler.getHealthStatus()).toBe(null);
		});

		it("should store configuration", () => {
			const config = handler.getConfig();
			expect(config.url).toBe("http://localhost:4096");
			expect(config.requestTimeoutMs).toBe(10000);
		});
	});

	describe("Connection state management", () => {
		it("should set connection state to connecting", () => {
			handler.setConnectionState("connecting");
			expect(handler.getConnectionState()).toBe("connecting");
			expect(handler.isConnected()).toBe(false);
		});

		it("should set connection state to connected", () => {
			handler.setConnectionState("connected");
			expect(handler.getConnectionState()).toBe("connected");
			expect(handler.isConnected()).toBe(true);
		});

		it("should not notify listeners if state unchanged", () => {
			const callback = vi.fn();
			handler.onConnectionStateChange(callback);

			handler.setConnectionState("disconnected");
			handler.setConnectionState("disconnected"); // Same state

			expect(callback).toHaveBeenCalledTimes(0);
		});

		it("should notify listeners on state change", () => {
			const callback = vi.fn();
			handler.onConnectionStateChange(callback);

			handler.setConnectionState("connecting");
			expect(callback).toHaveBeenCalledWith("connecting", {
				error: null,
			});

			handler.setConnectionState("connected");
			expect(callback).toHaveBeenCalledWith("connected", {
				error: null,
			});
		});

		it("should store last connection error", () => {
			const error = new Error("Connection failed");
			handler.setConnectionState("error", { error });
			expect(handler.getLastConnectionError()).toBe(error);
		});

		it("should handle callback errors gracefully", () => {
			const callback = vi.fn(() => {
				throw new Error("Callback error");
			});
			handler.onConnectionStateChange(callback);

			handler.setConnectionState("connecting");

			expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({
					module: "ConnectionHandler",
					function: "setConnectionState",
				}),
				ErrorSeverity.Warning,
			);
		});
	});

	describe("Connection lifecycle", () => {
		it("should connect and set state to connecting", async () => {
			await handler.connect();
			expect(handler.getConnectionState()).toBe("connecting");
		});

		it("should not connect if already connected", async () => {
			handler.setConnectionState("connected");
			await handler.connect();
			expect(handler.getConnectionState()).toBe("connected");
		});

		it("should not connect if already connecting", async () => {
			handler.setConnectionState("connecting");
			await handler.connect();
			expect(handler.getConnectionState()).toBe("connecting");
		});

		it("should clear last connection error on connect", async () => {
			const error = new Error("Previous error");
			handler.setConnectionState("error", { error });
			expect(handler.getLastConnectionError()).toBe(error);

			await handler.connect();
			expect(handler.getLastConnectionError()).toBe(null);
		});

		it("should disconnect and clean up", async () => {
			handler.setConnectionState("connected");
			const abortController = handler.getEventStreamAbort();
			if (abortController) {
				const abortSpy = vi.spyOn(abortController, "abort");
				await handler.disconnect();
				expect(abortSpy).toHaveBeenCalled();
			}

			await handler.disconnect();
			expect(handler.getConnectionState()).toBe("disconnected");
			expect(handler.getEventStreamAbort()).toBe(null);
		});
	});

	describe("Health check", () => {
		it("should perform health check successfully", async () => {
			const mockResult: HealthCheckResult = {
				isHealthy: true,
				statusCode: 200,
				checkedEndpoints: ["/health"],
			};

			vi.mocked(performHealthCheck).mockResolvedValue(mockResult);

			const result = await handler.healthCheck();

			expect(result.isHealthy).toBe(true);
			expect(handler.getHealthStatus()).toBe(true);
			expect(performHealthCheck).toHaveBeenCalledWith(
				{
					url: "http://localhost:4096",
					useRequestUrl: true,
				},
				mockErrorHandler,
			);
		});

		it("should handle health check failure", async () => {
			const mockResult: HealthCheckResult = {
				isHealthy: false,
				error: "Connection refused",
				checkedEndpoints: ["/health"],
			};

			vi.mocked(performHealthCheck).mockResolvedValue(mockResult);

			const result = await handler.healthCheck();

			expect(result.isHealthy).toBe(false);
			expect(handler.getHealthStatus()).toBe(false);
		});

		it("should notify health status listeners", async () => {
			const callback = vi.fn();
			handler.onHealthStatusChange(callback);

			const mockResult: HealthCheckResult = {
				isHealthy: true,
				statusCode: 200,
			};
			vi.mocked(performHealthCheck).mockResolvedValue(mockResult);

			await handler.healthCheck();

			expect(callback).toHaveBeenCalledWith(true);
		});

		it("should not notify if health status unchanged", async () => {
			const callback = vi.fn();
			handler.onHealthStatusChange(callback);

			const mockResult: HealthCheckResult = {
				isHealthy: true,
				statusCode: 200,
			};
			vi.mocked(performHealthCheck).mockResolvedValue(mockResult);

			await handler.healthCheck();
			await handler.healthCheck(); // Same status

			expect(callback).toHaveBeenCalledTimes(1);
		});

		it("should handle callback errors in health status notification", async () => {
			const callback = vi.fn(() => {
				throw new Error("Callback error");
			});
			handler.onHealthStatusChange(callback);

			const mockResult: HealthCheckResult = {
				isHealthy: true,
				statusCode: 200,
			};
			vi.mocked(performHealthCheck).mockResolvedValue(mockResult);

			await handler.healthCheck();

			expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({
					module: "ConnectionHandler",
					function: "setHealthStatus",
				}),
				ErrorSeverity.Warning,
			);
		});
	});

	describe("Reconnection logic", () => {
		it("should calculate reconnect delay with exponential backoff", () => {
			const delay1 = handler.calculateReconnectDelay(1);
			const delay2 = handler.calculateReconnectDelay(2);
			const delay3 = handler.calculateReconnectDelay(3);

			expect(delay1).toBeGreaterThan(0);
			expect(delay2).toBeGreaterThan(delay1);
			expect(delay3).toBeGreaterThan(delay2);
		});

		it("should cap delay at max delay", () => {
			const maxDelay = 30000;
			const delay = handler.calculateReconnectDelay(100); // Very high attempt

			expect(delay).toBeLessThanOrEqual(maxDelay + maxDelay * 0.25); // Max delay + jitter
		});

		it("should include jitter in delay", () => {
			const delays: number[] = [];
			for (let i = 0; i < 10; i++) {
				delays.push(handler.calculateReconnectDelay(1));
			}

			// With jitter, delays should vary
			const uniqueDelays = new Set(delays);
			expect(uniqueDelays.size).toBeGreaterThan(1);
		});

		it("should respect max attempts when calculating delay", () => {
			handler.updateConfig({ reconnectMaxAttempts: 2 });
			const delay1 = handler.calculateReconnectDelay(1);
			const delay2 = handler.calculateReconnectDelay(2);
			const delay3 = handler.calculateReconnectDelay(3); // Should be capped at attempt 2

			expect(delay3).toBeLessThanOrEqual(delay2 * 1.5); // Should not exceed much
		});

		it("should allow unlimited attempts when maxAttempts is 0", () => {
			handler.updateConfig({ reconnectMaxAttempts: 0 });
			expect(handler.shouldReconnect(100)).toBe(true);
		});

		it("should stop reconnecting after max attempts", () => {
			handler.updateConfig({ reconnectMaxAttempts: 3 });
			expect(handler.shouldReconnect(1)).toBe(true);
			expect(handler.shouldReconnect(2)).toBe(true);
			expect(handler.shouldReconnect(3)).toBe(false); // attempt 3 >= maxAttempts 3
			expect(handler.shouldReconnect(4)).toBe(false);
		});

		it("should not reconnect if autoReconnect is disabled", () => {
			handler.updateConfig({ autoReconnect: false });
			expect(handler.shouldReconnect(1)).toBe(false);
		});

		it("should notify reconnect attempt listeners", () => {
			const callback = vi.fn();
			handler.onReconnectAttempt(callback);

			const info: ReconnectAttemptInfo = {
				attempt: 1,
				nextDelayMs: 1000,
				maxAttempts: 3,
			};

			handler.notifyReconnectAttempt(info);

			expect(callback).toHaveBeenCalledWith(info);
		});

		it("should handle callback errors in reconnect notification", () => {
			const callback = vi.fn(() => {
				throw new Error("Callback error");
			});
			handler.onReconnectAttempt(callback);

			const info: ReconnectAttemptInfo = {
				attempt: 1,
				nextDelayMs: 1000,
				maxAttempts: 3,
			};

			handler.notifyReconnectAttempt(info);

			expect(mockErrorHandler.handleError).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({
					module: "ConnectionHandler",
					function: "notifyReconnectAttempt",
				}),
				ErrorSeverity.Warning,
			);
		});
	});

	describe("Event loop", () => {
		it("should get event stream abort controller", () => {
			expect(handler.getEventStreamAbort()).toBe(null);

			// Create abort controller by starting event loop
			const createStream = vi.fn(async () => {
				async function* generator() {
					yield { type: "test" };
				}
				return generator();
			});
			const processStream = vi.fn(async () => {});

			handler.updateConfig({ autoReconnect: false });
			void handler.startEventLoop(createStream, processStream);

			// Abort controller should be created
			const abortController = handler.getEventStreamAbort();
			expect(abortController).not.toBe(null);
			expect(abortController?.signal).toBeDefined();

			// Clean up
			abortController?.abort();
		});

		it("should abort previous event stream when starting new one", async () => {
			const createStream1 = vi.fn(async () => {
				async function* generator() {
					yield { type: "test1" };
				}
				return generator();
			});
			const processStream1 = vi.fn(async () => {});

			handler.updateConfig({ autoReconnect: false });

			// Start first loop
			const promise1 = handler.startEventLoop(createStream1, processStream1);
			const abortController1 = handler.getEventStreamAbort();
			expect(abortController1).not.toBe(null);

			// Start second loop - should abort first
			const createStream2 = vi.fn(async () => {
				async function* generator() {
					yield { type: "test2" };
				}
				return generator();
			});
			const processStream2 = vi.fn(async () => {});

			const abortSpy = vi.spyOn(abortController1!, "abort");
			const promise2 = handler.startEventLoop(createStream2, processStream2);

			expect(abortSpy).toHaveBeenCalled();

			// Clean up
			await promise1.catch(() => {});
			await promise2.catch(() => {});
		});
	});

	describe("Configuration management", () => {
		it("should update configuration", () => {
			handler.updateConfig({ reconnectDelay: 2000 });
			const config = handler.getConfig();
			expect(config.reconnectDelay).toBe(2000);
			expect(config.url).toBe("http://localhost:4096"); // Other config preserved
		});

		it("should return copy of configuration", () => {
			const config1 = handler.getConfig();
			const config2 = handler.getConfig();
			expect(config1).not.toBe(config2); // Different objects
			expect(config1).toEqual(config2); // Same values
		});
	});

	describe("Callback subscription", () => {
		it("should unsubscribe connection state callback", () => {
			const callback = vi.fn();
			const unsubscribe = handler.onConnectionStateChange(callback);

			handler.setConnectionState("connecting");
			expect(callback).toHaveBeenCalledTimes(1);

			unsubscribe();
			handler.setConnectionState("connected");
			expect(callback).toHaveBeenCalledTimes(1); // Not called again
		});

		it("should unsubscribe health status callback", async () => {
			const callback = vi.fn();
			const unsubscribe = handler.onHealthStatusChange(callback);

			const mockResult: HealthCheckResult = {
				isHealthy: true,
				statusCode: 200,
			};
			vi.mocked(performHealthCheck).mockResolvedValue(mockResult);

			await handler.healthCheck();
			expect(callback).toHaveBeenCalledTimes(1);

			unsubscribe();

			const mockResult2: HealthCheckResult = {
				isHealthy: false,
				error: "Failed",
			};
			vi.mocked(performHealthCheck).mockResolvedValue(mockResult2);

			await handler.healthCheck();

			expect(callback).toHaveBeenCalledTimes(1); // Only first call
		});

		it("should unsubscribe reconnect attempt callback", () => {
			const callback = vi.fn();
			const unsubscribe = handler.onReconnectAttempt(callback);

			const info: ReconnectAttemptInfo = {
				attempt: 1,
				nextDelayMs: 1000,
				maxAttempts: 3,
			};

			handler.notifyReconnectAttempt(info);
			expect(callback).toHaveBeenCalledTimes(1);

			unsubscribe();
			handler.notifyReconnectAttempt(info);
			expect(callback).toHaveBeenCalledTimes(1); // Not called again
		});
	});
});
