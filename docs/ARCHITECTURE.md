# Architecture Decision Records

This document describes the architecture and key design decisions for the OpenCode Obsidian plugin.

## Table of Contents

- [Overview](#overview)
- [Core Architecture](#core-architecture)
- [Key Design Decisions](#key-design-decisions)
- [Module Responsibilities](#module-responsibilities)
- [Data Flow](#data-flow)

## Overview

The OpenCode Obsidian plugin is built with a modular architecture that separates concerns into distinct modules. The plugin follows TypeScript best practices with strong typing, dependency injection, and clear separation of responsibilities.

## Core Architecture

### Plugin Entry Point

**File**: `src/main.ts`

The `OpenCodeObsidianPlugin` class extends Obsidian's `Plugin` class and serves as the main entry point. It orchestrates:

- Plugin lifecycle management
- Settings loading and saving
- Component initialization (ProviderManager, ConfigLoader, HookRegistry, AgentResolver)
- View registration
- Command registration

### Core Modules

#### 1. Provider Management (`src/provider-manager.ts`)

**Responsibility**: Manage AI provider clients and model fetching

- **ProviderManager**: Centralized management of multiple AI providers
  - Client initialization and caching
  - Model fetching with throttling and caching
  - Provider switching
  - Factory method for client creation (eliminates duplication)

**Key Features**:
- LRU-based model list caching (30s duration)
- Throttling for model fetching (2s minimum interval)
- Support for built-in providers (Anthropic, OpenAI, Google, ZenMux) and compatible providers

#### 2. AI Client (`src/embedded-ai-client.ts`)

**Responsibility**: Direct interaction with AI provider APIs

- **EmbeddedAIClient**: Unified client interface for all AI providers
  - Streaming response handling
  - Session management with LRU cache
  - Type-safe event handling for Anthropic SDK
  - Support for multiple providers via unified interface

**Key Features**:
- LRU session cache (max 50 sessions, 30min idle timeout)
- Periodic cleanup of inactive sessions (5min interval)
- Type-safe Anthropic stream event handling
- Modular event handlers for maintainability

#### 3. Agent Resolution (`src/agent/agent-resolver.ts`)

**Responsibility**: Resolve and merge agent configurations

- **AgentResolver**: Encapsulates agent lookup, skill merging, and instruction integration
  - Agent configuration lookup
  - Skill merging into prompts
  - Instruction integration from config loader
  - Model and tool override handling

**Key Features**:
- Clean separation of agent resolution logic
- Skill merging with formatted sections
- Instruction integration from cached config loader

#### 4. Configuration Loading (`src/config-loader.ts`)

**Responsibility**: Load and parse configuration files from vault

- **ConfigLoader**: Manages configuration file loading and parsing
  - Priority-based config file lookup
  - Agent and skill file loading from `.opencode/` directory
  - Instruction file loading with glob pattern support
  - Security validations (file path, size, JSON structure)

**Key Features**:
- Configuration file priority array (no nested if-else)
- js-yaml for robust YAML frontmatter parsing
- File path validation (prevents path traversal)
- File size limits (config: 1MB, agents/skills: 5MB, instructions: 10MB)
- JSON structure validation (depth, complexity, string length)

#### 5. Error Handling (`src/utils/error-handler.ts`)

**Responsibility**: Unified error handling across the application

- **ErrorHandler**: Centralized error handling system
  - Consistent error logging
  - User notification with severity levels
  - Error collection for reporting
  - Function wrapping for automatic error handling

**Key Features**:
- Severity levels (Critical, Error, Warning, Info)
- Context-aware error messages
- Configurable notification callbacks
- Optional error collection for debugging

#### 6. Input Validation (`src/utils/validators.ts`)

**Responsibility**: Validate configuration, agent, and provider inputs

- Comprehensive validation functions for:
  - OpenCodeConfig
  - Provider configurations
  - Agent frontmatter and structures
  - Skill frontmatter and structures

**Key Features**:
- Type-safe validation with detailed error messages
- URL format validation
- Color hex validation
- Model format validation
- Provider ID format validation

## Key Design Decisions

### ADR-1: Unified Error Handling System

**Decision**: Implement a centralized ErrorHandler class instead of scattered console.error calls

**Rationale**:
- Consistent error reporting across the application
- Easier to change error handling behavior globally
- Better user experience with contextual error messages
- Enables error collection for debugging

**Implementation**: `src/utils/error-handler.ts`

### ADR-2: Agent Resolution Extraction

**Decision**: Extract agent resolution logic into a separate AgentResolver class

**Rationale**:
- Removed 51 lines of nested logic from main.ts
- Improved testability (unit tests added)
- Clear separation of concerns
- Easier to extend with new agent features

**Implementation**: `src/agent/agent-resolver.ts`

### ADR-3: Provider Client Factory Method

**Decision**: Create a centralized `createProviderClient` factory method in ProviderManager

**Rationale**:
- Eliminated 8 instances of duplicate EmbeddedAIClient creation code
- Single source of truth for client creation
- Easier to maintain and extend
- Consistent error handling

**Implementation**: `src/provider-manager.ts`

### ADR-4: LRU Session Cache

**Decision**: Implement LRU cache for session management instead of using external library

**Rationale**:
- Lightweight solution for simple requirements
- No external dependencies (important for Obsidian plugin size)
- O(1) access and update operations
- Sufficient for session management use case

**Implementation**: `src/embedded-ai-client.ts`

### ADR-5: Incremental DOM Updates

**Decision**: Replace full re-renders with incremental DOM updates

**Rationale**:
- Better performance (reduces unnecessary DOM operations)
- Smoother user experience
- Only update changed parts of UI
- Reduces flickering and layout shifts

**Implementation**: `src/opencode-obsidian-view.ts`

### ADR-6: Debounce and Throttle Utilities

**Decision**: Implement custom debounce/throttle utilities instead of using lodash

**Rationale**:
- No external dependencies
- TypeScript-native with proper typing
- Supports both sync and async functions
- Sufficient for use cases (input field saving, model fetching)

**Implementation**: `src/utils/debounce-throttle.ts`

### ADR-7: js-yaml Library

**Decision**: Use js-yaml library instead of custom YAML parser

**Rationale**:
- Supports full YAML 1.1 specification
- Better error handling
- Handles complex nested structures
- Security: safe by default (prevents code execution)

**Implementation**: `src/config-loader.ts`

### ADR-8: Configuration Constants File

**Decision**: Extract all magic numbers to a central constants file

**Rationale**:
- Single source of truth for configuration values
- Easier to adjust thresholds and limits
- Self-documenting code
- Better maintainability

**Implementation**: `src/utils/constants.ts`

### ADR-9: Security Validations

**Decision**: Add comprehensive security validations for file loading

**Rationale**:
- Prevents path traversal attacks
- Prevents DoS attacks via large files
- Prevents DoS attacks via deep JSON structures
- Protects user data and system resources

**Implementation**: `src/config-loader.ts` with validations

### ADR-10: Type-Safe Event Handling

**Decision**: Define explicit types for Anthropic SDK events instead of using `any`

**Rationale**:
- Better IDE support and autocomplete
- Catch type errors at compile time
- Self-documenting code
- Easier refactoring

**Implementation**: `src/embedded-ai-client.ts` with `AnthropicEventTypes` namespace

## Module Responsibilities

### Main Plugin (`src/main.ts`)
- Plugin lifecycle (onload, onunload)
- Settings management
- Component orchestration
- Command registration

### View Component (`src/opencode-obsidian-view.ts`)
- UI rendering and updates
- User interaction handling
- Conversation management
- Incremental DOM updates

### Provider Manager (`src/provider-manager.ts`)
- Provider client management
- Model list fetching (with caching/throttling)
- Provider switching
- Client factory

### AI Client (`src/embedded-ai-client.ts`)
- Direct API communication
- Streaming response handling
- Session management (LRU cache)
- Provider-specific implementations

### Agent Resolver (`src/agent/agent-resolver.ts`)
- Agent lookup and resolution
- Skill merging
- Instruction integration
- Model/tool override handling

### Config Loader (`src/config-loader.ts`)
- Configuration file loading
- Agent/skill file parsing
- Instruction file loading
- Security validations

### Error Handler (`src/utils/error-handler.ts`)
- Error logging
- User notifications
- Error collection
- Function wrapping

### Validators (`src/utils/validators.ts`)
- Input validation
- Type checking
- Format validation
- Security checks

### Constants (`src/utils/constants.ts`)
- Configuration constants
- Threshold values
- Size limits
- Time intervals

### Hooks (`src/hooks/`)
- Hook registration and execution
- Event-driven architecture
- Extensibility mechanism

### Context Management (`src/context/`)
- Token estimation
- Context compaction
- Preemptive compaction
- Full threshold detection

### Session Management (`src/session/`)
- Session storage
- Auto-save mechanism
- Session cleanup

### TODO Management (`src/todo/`)
- TODO extraction
- TODO continuation
- User interrupt handling

## Data Flow

### Message Sending Flow

1. User types message in view
2. View calls `plugin.sendPrompt()`
3. `sendPrompt()` uses `AgentResolver` to resolve agent config
4. `AgentResolver`:
   - Looks up agent by ID
   - Merges skills into system prompt
   - Merges instructions from config loader
   - Returns resolved config
5. `sendPrompt()` calls `ProviderManager.sendPrompt()`
6. `ProviderManager` gets or creates client for provider
7. `EmbeddedAIClient.sendPrompt()`:
   - Creates or retrieves session (LRU cache)
   - Sends request to AI provider API
   - Streams responses back
   - Handles events with type-safe handlers
8. View receives chunks and updates UI incrementally
9. Hooks are executed at various points for extensibility

### Configuration Loading Flow

1. Plugin loads settings from Obsidian
2. If `.opencode/` directory exists:
   - `ConfigLoader.loadConfig()` loads config.json (with priority lookup)
   - `ConfigLoader.loadAgents()` loads agent files from `.opencode/agent/`
   - `ConfigLoader.loadSkills()` loads skill files from `.opencode/skill/`
   - `ConfigLoader.loadInstructions()` loads instruction files (supports glob patterns)
3. All loaded data is validated using validators
4. Data is stored in plugin settings and used by AgentResolver

### Error Handling Flow

1. Error occurs in any module
2. Module calls `ErrorHandler.handleError()` with:
   - Error instance
   - Context (module, function, operation, metadata)
   - Severity level
3. ErrorHandler:
   - Logs to console (if enabled)
   - Collects error (if enabled)
   - Shows user notification (if enabled and severity warrants)
4. Error is handled gracefully, user sees friendly message

## Testing Strategy

- **Unit Tests**: Core business logic (ErrorHandler, AgentResolver) - using Vitest
- **Integration Tests**: Configuration loading and validation
- **E2E Tests**: Not implemented (would require Obsidian environment)

## Future Considerations

- MCP (Model Context Protocol) integration (placeholder implemented)
- LSP (Language Server Protocol) integration (placeholder implemented)
- Additional AI providers as they become available
- Enhanced caching strategies
- Performance monitoring and metrics
