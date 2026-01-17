# Requirements: Agent Dynamic List

## Overview

Enable the plugin to dynamically load agents from OpenCode Server instead of using a hardcoded list. This allows new agents to appear automatically without plugin updates.

## Glossary

- **Agent**: AI assistant configuration from OpenCode Server
- **OpenCode_Client**: SDK wrapper in `src/opencode-server/client.ts`
- **Settings_Page**: Plugin settings UI in `src/settings.ts`

## Requirements

### 1. Fetch Agents from Server

**User Story:** Fetch available agents from OpenCode Server to keep the list synchronized.

**Acceptance Criteria:**

1.1 OpenCode_Client provides `listAgents()` method that calls `sdkClient.app.agents()`

1.2 Returns agent list with id, name, description on success

1.3 Throws error on failure (handled by ErrorHandler)

### 2. Load Agents on Startup

**User Story:** Automatically load agents when plugin starts.

**Acceptance Criteria:**

2.1 Plugin fetches agents during initialization (non-blocking)

2.2 Stores agents in settings on success

2.3 Falls back to hardcoded list on failure (with warning log)

### 3. Manual Refresh

**User Story:** Manually refresh agent list from settings without restarting.

**Acceptance Criteria:**

3.1 Settings page shows "Refresh agents" button

3.2 Button fetches latest agents and updates dropdown

3.3 Shows success/error notice to user

3.4 Button disabled during loading

### 4. Error Handling

**User Story:** Handle server errors gracefully without breaking the plugin.

**Acceptance Criteria:**

4.1 Use ErrorHandler for all fetch failures

4.2 Fallback to hardcoded agents when server unavailable

4.3 Display user-friendly error messages (sentence case)

### 5. Display in Settings

**User Story:** See all available agents in settings dropdown.

**Acceptance Criteria:**

5.1 Display all agents in dropdown with name and description

5.2 Update dropdown when list refreshes

5.3 Preserve selected agent if still available, otherwise select first agent

## Constraints

- Use existing `@opencode-ai/sdk` client (no new dependencies)
- Follow existing error handling patterns with ErrorHandler
- Maintain backward compatibility
- Non-blocking plugin initialization

## Out of Scope

- Agent creation/modification through plugin UI
- Custom agent file loading (existing functionality)
- Multi-server agent aggregation

