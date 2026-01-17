# Requirements: Code Refactoring Large Files

## Overview

Refactor large files to improve maintainability. Several files exceed 20KB (largest: 63.62KB), making them hard to navigate and test. Break them into focused modules while keeping everything working.

## Glossary

- **OpenCode_Client**: SDK wrapper in `src/opencode-server/client.ts`
- **View_Component**: Main UI in `src/views/opencode-obsidian-view.ts`
- **Settings_Component**: Settings UI in `src/settings.ts`

## Requirements

### 1. Decompose OpenCode Client

**User Story:** Break down `client.ts` into smaller, focused modules.

**Acceptance Criteria:**

1.1 Split into modules under 15KB each

1.2 Extract connection management to separate file

1.3 Extract SSE streaming to separate file

1.4 Extract session operations to separate file

1.5 Keep existing public API unchanged

1.6 All tests pass without changes

### 2. Decompose View Component

**User Story:** Break down main view into smaller UI modules.

**Acceptance Criteria:**

2.1 Split into modules under 15KB each

2.2 Extract chat rendering to separate file

2.3 Extract input handling to separate file

2.4 Extract session UI to separate file

2.5 Keep existing public API unchanged

2.6 All tests pass without changes

### 3. Decompose Settings Component

**User Story:** Break down settings UI into smaller modules.

**Acceptance Criteria:**

3.1 Split into modules under 15KB each

3.2 Extract connection settings to separate file

3.3 Extract agent config to separate file

3.4 Keep existing public API unchanged

3.5 All tests pass without changes

### 4. Extract Common Utilities

**User Story:** Move duplicate code into shared utility files.

**Acceptance Criteria:**

4.1 Extract duplicate patterns into utility files

4.2 Create DOM helper utilities

4.3 Create data transformation utilities

4.4 Keep utilities as pure functions

4.5 Add unit tests for utilities

### 5. Maintain Backward Compatibility

**User Story:** Keep all public APIs unchanged.

**Acceptance Criteria:**

5.1 Preserve all public interfaces and method signatures

5.2 Re-export from original locations

5.3 No breaking changes to import paths

5.4 All tests pass without changes

### 6. Validate Success

**User Story:** Verify refactoring worked.

**Acceptance Criteria:**

6.1 No files exceed 15KB

6.2 All tests pass

6.3 TypeScript compiles

6.4 ESLint passes

6.5 Plugin builds and runs in Obsidian

## Constraints

- Keep all public APIs unchanged
- Follow existing code style (tabs, kebab-case files)
- Use existing ErrorHandler patterns
- No new features

## Out of Scope

- Adding new functionality
- Changing public APIs
- Performance optimizations
- Refactoring files already under 15KB
