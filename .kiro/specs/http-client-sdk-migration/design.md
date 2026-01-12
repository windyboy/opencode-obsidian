# Design Document: OpenCode SDK Client Migration

## Overview

Complete migration from custom HTTP client implementations to `@opencode-ai/sdk/client`. This removes all legacy code (~1100 lines) and creates a single, clean client implementation.

## Architecture

### Single Client Implementation

Replace 4 existing files with 1 new file:

**Remove:**

-   `client.ts` (custom HTTP + SSE)
-   `sdk-client.ts` (partial SDK wrapper)
-   `client-adapter.ts` (compatibility bridge)
-   `sdk-types.ts` (custom types)

**Create:**

-   `client.ts` (SDK client wrapper)

### Core Implementation

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk/client";
import type { Session, Message } from "@opencode-ai/sdk/client";
import { ErrorHandler, ErrorSeverity } from "../utils/error-handler";

export class OpenCodeClient {
	private sdkClient: ReturnType<typeof createOpencodeClient>;
	private errorHandler: ErrorHandler;
	private streamTokenCallbacks: Array<
		(sessionId: string, token: string, done: boolean) => void
	> = [];
	private streamThinkingCallbacks: Array<
		(sessionId: string, content: string) => void
	> = [];
	private errorCallbacks: Array<(error: Error) => void> = [];

	constructor(config: { baseUrl: string }, errorHandler: ErrorHandler) {
		this.errorHandler = errorHandler;
		this.sdkClient = createOpencodeClient({
			baseUrl: config.baseUrl,
			fetch: this.createObsidianFetch(),
		});
	}

	// Session operations
	async createSession(title?: string): Promise<string>;
	async sendMessage(sessionId: string, message: string): Promise<void>;
	async abortSession(sessionId: string): Promise<void>;

	// Health check
	async healthCheck(): Promise<boolean>;

	// Event callbacks (maintain existing API)
	onStreamToken(
		callback: (sessionId: string, token: string, done: boolean) => void,
	): void;
	onStreamThinking(
		callback: (sessionId: string, content: string) => void,
	): void;
	onError(callback: (error: Error) => void): void;
}
```

### Obsidian Integration

```typescript
private createObsidianFetch(): typeof fetch {
  return async (url: string | URL, init?: RequestInit) => {
    try {
      const response = await requestUrl({
        url: url.toString(),
        method: init?.method || "GET",
        headers: init?.headers as Record<string, string>,
        body: init?.body ? String(init.body) : undefined,
      });

      return new Response(response.text || JSON.stringify(response.json), {
        status: response.status,
        headers: new Headers(response.headers || {}),
      });
    } catch (error) {
      this.errorHandler.handleError(error, {
        module: "OpenCodeClient",
        function: "createObsidianFetch",
        operation: "HTTP request"
      }, ErrorSeverity.Error);
      throw error;
    }
  };
}
```

## Event Handling

SDK client events → existing UI callbacks:

```typescript
private async subscribeToEvents(): Promise<void> {
  try {
    await this.sdkClient.event.subscribe({
      onMessage: (event) => {
        if (event.type === "message.part.updated") {
          const sessionId = event.sessionId || event.id;
          const token = event.data.delta || event.data.part.text || "";

          if (event.data.part.type === "text") {
            this.streamTokenCallbacks.forEach(cb => cb(sessionId, token, false));
          } else if (event.data.part.type === "reasoning") {
            this.streamThinkingCallbacks.forEach(cb => cb(sessionId, token));
          }
        }

        if (event.type === "session.idle") {
          const sessionId = event.sessionId || event.id;
          this.streamTokenCallbacks.forEach(cb => cb(sessionId, "", true));
        }
      },
      onError: (error) => {
        this.errorHandler.handleError(error, {
          module: "OpenCodeClient",
          function: "subscribeToEvents",
          operation: "Event subscription"
        }, ErrorSeverity.Error);
        this.errorCallbacks.forEach(cb => cb(error));
      }
    });
  } catch (error) {
    this.errorHandler.handleError(error, {
      module: "OpenCodeClient",
      function: "subscribeToEvents",
      operation: "Event subscription setup"
    }, ErrorSeverity.Error);
    throw error;
  }
}
```

## Integration Points

### Main Plugin

```typescript
// Replace existing client initialization
this.opencodeClient = new OpenCodeClient(
	{ baseUrl: this.settings.opencodeServer.url },
	this.errorHandler,
);
```

### View Layer

No changes needed - same public API maintained.

## Benefits

-   **-1000+ lines**: Remove all custom HTTP/SSE code
-   **Official SDK**: Full support and automatic updates
-   **Type Safety**: Complete TypeScript integration
-   **Zero Adapters**: Direct SDK usage
-   **Same API**: No UI layer changes needed
