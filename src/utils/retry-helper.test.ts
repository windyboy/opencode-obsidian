/**
 * Tests for RetryHelper
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RetryHelper, DEFAULT_RETRY_CONFIG } from "./retry-helper";
import { isRetryableError } from "./error-messages";

describe("RetryHelper", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("withRetry", () => {
		it("should succeed on first attempt", async () => {
			const operation = vi.fn().mockResolvedValue("success");
			const result = await RetryHelper.withRetry(operation);

			expect(result).toBe("success");
			expect(operation).toHaveBeenCalledTimes(1);
		});

		it("should retry on failure and succeed", async () => {
			const operation = vi.fn()
				.mockRejectedValueOnce(new Error("network error"))
				.mockResolvedValueOnce("success");

			const promise = RetryHelper.withRetry(operation, { maxAttempts: 2 });

			// Advance timers to allow retry delay (1000ms for first retry)
			await vi.advanceTimersByTimeAsync(1000);
			// Wait for promise to resolve
			const result = await promise;

			expect(result).toBe("success");
			expect(operation).toHaveBeenCalledTimes(2);
		});

		it("should throw after max attempts", async () => {
			const error = new Error("network error");
			const operation = vi.fn().mockRejectedValue(error);

			const promise = RetryHelper.withRetry(operation, { maxAttempts: 3 });
			const rejection = expect(promise).rejects.toBe(error);

			// Advance timers to allow all retries (1000 + 2000 + 4000 = 7000ms)
			await vi.advanceTimersByTimeAsync(8000);

			await rejection;
			expect(operation).toHaveBeenCalledTimes(3);
		});

		it("should use exponential backoff", async () => {
			const operation = vi.fn()
				.mockRejectedValueOnce(new Error("network error"))
				.mockRejectedValueOnce(new Error("network error"))
				.mockResolvedValueOnce("success");

			const promise = RetryHelper.withRetry(operation, {
				maxAttempts: 3,
				delayMs: 1000,
				backoffMultiplier: 2,
			});

			// First retry after 1000ms
			await vi.advanceTimersByTimeAsync(1000);
			// Second retry after 2000ms (1000 * 2)
			await vi.advanceTimersByTimeAsync(2000);
			// Wait for promise to resolve
			const result = await promise;
			expect(result).toBe("success");
		});

		it("should not retry non-retryable errors", async () => {
			// 404 errors are not retryable by default
			const error = new Error("404 Not Found");
			const operation = vi.fn().mockRejectedValue(error);

			const promise = RetryHelper.withRetry(operation, { maxAttempts: 3 });

			await expect(promise).rejects.toThrow("404 Not Found");
			expect(operation).toHaveBeenCalledTimes(1); // Should not retry
		});

		it("should use custom retryable error function", async () => {
			const error = new Error("Custom error");
			const operation = vi.fn()
				.mockRejectedValueOnce(error)
				.mockResolvedValueOnce("success");

			const customRetryable = vi.fn().mockReturnValue(true);

			const promise = RetryHelper.withRetry(operation, {
				maxAttempts: 2,
				retryableErrors: customRetryable,
			});

			await vi.advanceTimersByTimeAsync(1000);
			const result = await promise;

			expect(result).toBe("success");
			expect(customRetryable).toHaveBeenCalledWith(error, null);
		});

		it("should log retry attempts when operation name is provided", async () => {
			const consoleDebugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

			const operation = vi.fn()
				.mockRejectedValueOnce(new Error("network error"))
				.mockResolvedValueOnce("success");

			const promise = RetryHelper.withRetry(operation, {
				maxAttempts: 2,
				operationName: "test operation",
			});

			await vi.advanceTimersByTimeAsync(1000);
			await promise;

			expect(consoleDebugSpy).toHaveBeenCalledWith(
				expect.stringContaining("Retrying test operation"),
			);

			consoleDebugSpy.mockRestore();
		});

		it("should handle non-Error objects", async () => {
			// Non-Error objects are not retryable by default (no network error keywords)
			const operation = vi.fn().mockRejectedValue("string error");

			const promise = RetryHelper.withRetry(operation, { maxAttempts: 2 });

			await expect(promise).rejects.toThrow("string error");
			expect(operation).toHaveBeenCalledTimes(1); // Should not retry
		});

		it("should use default config when no config provided", async () => {
			const operation = vi.fn().mockResolvedValue("success");
			const result = await RetryHelper.withRetry(operation);

			expect(result).toBe("success");
			// Should use default maxAttempts (3)
			expect(operation).toHaveBeenCalledTimes(1);
		});

		it("should merge partial config with defaults", async () => {
			const operation = vi.fn().mockResolvedValue("success");
			const result = await RetryHelper.withRetry(operation, {
				delayMs: 500,
			});

			expect(result).toBe("success");
			// Should use custom delayMs but default maxAttempts
			expect(operation).toHaveBeenCalledTimes(1);
		});
	});

	describe("DEFAULT_RETRY_CONFIG", () => {
		it("should have correct default values", () => {
			expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(3);
			expect(DEFAULT_RETRY_CONFIG.delayMs).toBe(1000);
			expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
		});
	});
});
