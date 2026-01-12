# Requirements Document

## Introduction

This specification defines the requirements for a complete refactor from custom HTTP client implementation to the official OpenCode SDK client (`@opencode-ai/sdk/client`). This is a full rewrite with no backward compatibility requirements - the goal is to create a clean, modern implementation using the official SDK client module.

## Glossary

-   **OpenCode_SDK_Client**: The official `@opencode-ai/sdk/client` module and its `createOpencodeClient` function
-   **Legacy_Client**: The current custom client implementations (to be completely removed)
-   **SDK_Client**: The new client implementation using only the official SDK client module

## Requirements

### Requirement 1: Complete SDK Client Integration

**User Story:** As a developer, I want to use only the official OpenCode SDK client module, so that the codebase is modern and maintainable.

#### Acceptance Criteria

1. WHEN initializing the client, THE System SHALL use `createOpencodeClient` from `@opencode-ai/sdk/client`
2. WHEN making HTTP requests, THE System SHALL configure the SDK client with a custom fetch implementation using Obsidian's `requestUrl` API
3. WHEN handling events, THE System SHALL use the SDK client's native event subscription system
4. THE System SHALL use only SDK client types and interfaces from `@opencode-ai/sdk/client`
5. WHEN connecting to OpenCode Server, THE System SHALL rely entirely on SDK client's connection management

### Requirement 2: Complete Legacy Code Removal

**User Story:** As a maintainer, I want all custom client code removed, so that there is no technical debt or confusion.

#### Acceptance Criteria

1. THE System SHALL delete all existing client files: `client.ts`, `sdk-client.ts`, `client-adapter.ts`, and `sdk-types.ts`
2. THE System SHALL remove all custom HTTP request handling implementations
3. THE System SHALL remove all custom SSE (Server-Sent Events) handling code
4. THE System SHALL remove all adapter and compatibility layer code
5. THE System SHALL create a single new client implementation using only the SDK client module

### Requirement 3: Modern Obsidian Integration

**User Story:** As a plugin user, I want the new SDK client integration to work seamlessly with Obsidian, so that all functionality works correctly.

#### Acceptance Criteria

1. WHEN configuring the SDK client, THE System SHALL provide a custom fetch implementation that uses Obsidian's `requestUrl` API
2. WHEN handling errors, THE System SHALL integrate with the existing `ErrorHandler` system
3. WHEN processing events, THE System SHALL translate SDK client events to the UI callback system
4. THE System SHALL ensure tool execution and permission systems work with the new client
5. WHEN managing sessions, THE System SHALL maintain all current session management capabilities

### Requirement 4: Clean Architecture

**User Story:** As a future maintainer, I want a simple, clean codebase that follows modern patterns, so that it's easy to understand and extend.

#### Acceptance Criteria

1. THE System SHALL implement a single client class that wraps the official SDK client
2. THE System SHALL use only TypeScript types from the official SDK client module
3. THE System SHALL follow the existing codebase patterns and conventions
4. THE System SHALL maintain clear separation between client logic and UI logic
5. WHEN implementing the client, THE System SHALL use modern async/await patterns throughout

### Requirement 5: Feature Parity

**User Story:** As a plugin user, I want all current functionality to work exactly the same, so that I don't lose any capabilities.

#### Acceptance Criteria

1. THE System SHALL support all current session operations (create, send messages, abort)
2. THE System SHALL support health checks and server connectivity testing
3. THE System SHALL support real-time streaming of responses and thinking content
4. THE System SHALL support all current event callbacks (tokens, thinking, errors, progress)
5. THE System SHALL maintain connection state management with auto-reconnect capabilities
