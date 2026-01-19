import { requestUrl } from "obsidian";
import type { HealthCheckResult } from "../client/types";
import { ErrorHandler, ErrorSeverity } from "./error-handler";

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
	/** Server base URL */
	url: string;
	/** Check sessions endpoint in addition to health endpoint */
	checkSessionsEndpoint?: boolean;
	/** Request timeout in milliseconds */
	timeoutMs?: number;
	/** Whether to use Obsidian's requestUrl (vs fetch) */
	useRequestUrl?: boolean;
}

/**
 * Perform health check on OpenCode Server
 * Supports both Obsidian's requestUrl and standard fetch API
 */
export async function performHealthCheck(
	config: HealthCheckConfig,
	errorHandler?: ErrorHandler
): Promise<HealthCheckResult> {
	const {
		url,
		checkSessionsEndpoint = false,
		timeoutMs = 2000,
		useRequestUrl = false
	} = config;

	const checkedEndpoints: string[] = ["/health"];

	try {
		if (useRequestUrl) {
			// Use Obsidian's requestUrl (for plugin context)
			return await performRequestUrlHealthCheck(url, checkedEndpoints, errorHandler);
		} else {
			// Use standard fetch (for server management context)
			return await performFetchHealthCheck(
				url,
				checkedEndpoints,
				checkSessionsEndpoint,
				timeoutMs,
				errorHandler
			);
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		
		if (errorHandler) {
			errorHandler.handleError(
				error,
				{
					module: "HealthCheck",
					function: "performHealthCheck",
					operation: "Health check",
					metadata: { serverUrl: url }
				},
				ErrorSeverity.Warning
			);
		}

		return {
			isHealthy: false,
			error: errorMessage,
			checkedEndpoints
		};
	}
}

/**
 * Health check using Obsidian's requestUrl
 * Handles JSON parsing errors gracefully (health endpoint may return HTML)
 */
async function performRequestUrlHealthCheck(
	baseUrl: string,
	checkedEndpoints: string[],
	errorHandler?: ErrorHandler
): Promise<HealthCheckResult> {
	try {
		const healthUrl = `${baseUrl}/health`;
		const response = await requestUrl({
			url: healthUrl,
			method: "GET",
			contentType: "text/plain",
		});

		const isHealthy = response.status >= 200 && response.status < 300;
		
		if (!isHealthy && errorHandler) {
			errorHandler.handleError(
				new Error(`Health check returned status ${response.status}`),
				{
					module: "HealthCheck",
					function: "performRequestUrlHealthCheck",
					operation: "Health check response",
					metadata: { url: healthUrl, status: response.status }
				},
				ErrorSeverity.Warning
			);
		}

		return {
			isHealthy,
			statusCode: response.status,
			checkedEndpoints
		};
	} catch (requestError) {
		const errorMessage = requestError instanceof Error 
			? requestError.message 
			: String(requestError);
		
		const isJsonParseError = errorMessage.includes("not valid JSON") ||
			errorMessage.includes("Unexpected token");

		if (isJsonParseError) {
			// JSON parse errors are expected for /health endpoint that returns HTML
			// Treat as unhealthy without logging error
			return {
				isHealthy: false,
				error: errorMessage,
				checkedEndpoints
			};
		}

		if (errorHandler) {
			errorHandler.handleError(
				requestError,
				{
					module: "HealthCheck",
					function: "performRequestUrlHealthCheck",
					operation: "Health check request",
					metadata: { url: `${baseUrl}/health` }
				},
				ErrorSeverity.Warning
			);
		}

		return {
			isHealthy: false,
			error: errorMessage,
			checkedEndpoints
		};
	}
}

/**
 * Health check using standard fetch API
 * Includes optional sessions endpoint validation
 */
async function performFetchHealthCheck(
	baseUrl: string,
	checkedEndpoints: string[],
	checkSessionsEndpoint: boolean,
	timeoutMs: number,
	errorHandler?: ErrorHandler
): Promise<HealthCheckResult> {
	try {
		// 1. Basic health check
		const healthResponse = await fetch(`${baseUrl}/health`, {
			method: "GET",
			signal: AbortSignal.timeout(timeoutMs),
		});

		if (!healthResponse.ok) {
			return {
				isHealthy: false,
				statusCode: healthResponse.status,
				error: `Health endpoint returned ${healthResponse.status}`,
				checkedEndpoints
			};
		}

		// 2. Validate sessions endpoint (optional, avoid over-checking)
		if (checkSessionsEndpoint) {
			checkedEndpoints.push("/sessions");
			try {
				const sessionsResponse = await fetch(`${baseUrl}/sessions`, {
					method: "GET",
					signal: AbortSignal.timeout(timeoutMs),
				});

				if (!sessionsResponse.ok) {
					return {
						isHealthy: false,
						statusCode: sessionsResponse.status,
						error: "Sessions endpoint not responding",
						checkedEndpoints
					};
				}
			} catch (sessionError) {
				// If /sessions check fails, log warning but still consider health check passed
				if (errorHandler) {
					errorHandler.handleError(
						new Error(`Sessions endpoint check failed: ${sessionError instanceof Error ? sessionError.message : "Unknown error"}`),
						{ module: "HealthCheck", function: "performFetchHealthCheck" },
						ErrorSeverity.Warning
					);
				}
			}
		}

		return {
			isHealthy: true,
			statusCode: healthResponse.status,
			checkedEndpoints
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		throw error; // Re-throw for outer handler
	}
}
