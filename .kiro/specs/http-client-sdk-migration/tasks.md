# Implementation Plan: HTTP Client SDK Migration

## Overview

Complete migration from custom HTTP client implementations to `@opencode-ai/sdk/client`. This involves removing ~1100 lines of legacy code and creating a single, clean client implementation.

## Tasks

-   [x] 1. Install SDK client dependency

    -   Add `@opencode-ai/sdk` to package.json dependencies (provides access to `/client` submodule)
    -   Update package lock file
    -   _Requirements: 1.1, 1.4_

-   [x] 2. Remove legacy client files

    -   Delete `src/opencode-server/client.ts`
    -   Delete `src/opencode-server/sdk-client.ts`
    -   Delete `src/opencode-server/client-adapter.ts`
    -   Delete `src/opencode-server/sdk-types.ts`
    -   _Requirements: 2.1, 2.2, 2.3, 2.4_

-   [x] 3. Create new SDK client implementation

    -   [x] 3.1 Create basic client class structure

        -   Implement OpenCodeClient class with SDK client integration
        -   Add Obsidian fetch implementation with error handling
        -   Integrate with existing ErrorHandler system
        -   _Requirements: 1.1, 1.2, 3.2, 4.1_

    -   [x] 3.2 Implement session management methods

        -   Add createSession, sendMessage, abortSession methods
        -   _Requirements: 5.1_

    -   [x] 3.3 Implement health check functionality
        -   Add healthCheck method using SDK client
        -   _Requirements: 5.2_

-   [x] 4. Implement event handling system

    -   [x] 4.1 Create event callback registration methods

        -   Add onStreamToken, onStreamThinking, onError callback methods
        -   _Requirements: 3.3, 5.4_

    -   [x] 4.2 Implement SDK event translation
        -   Translate SDK client events to existing UI callback format
        -   Handle message.part.updated events for tokens and thinking content
        -   Handle session.idle events for completion
        -   Integrate error handling with ErrorHandler system
        -   _Requirements: 3.2, 3.3, 5.3_

-   [x] 5. Update main plugin integration

    -   [x] 5.1 Update main.ts to use new client

        -   Replace existing client initialization with OpenCodeClient
        -   Pass ErrorHandler instance to client constructor
        -   Update import statements
        -   _Requirements: 3.2, 4.3_

    -   [x] 5.2 Verify view layer compatibility
        -   Ensure existing view layer works with new client API
        -   _Requirements: 3.4, 5.5_

-   [x] 6. Checkpoint - Ensure all functionality works
    -   Ensure all tests pass, ask the user if questions arise.

## Notes

-   All tasks focus on core implementation to maintain existing functionality
-   The new client maintains the same public API for seamless integration
-   TypeScript types come directly from the SDK client module
-   No backward compatibility needed - this is a complete rewrite
