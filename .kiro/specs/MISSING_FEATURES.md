# OpenCode Obsidian Plugin - Missing Features Inventory

**Date**: 2026-01-16  
**Status**: Planning  
**Reference**: [OpenCode Server API Documentation](https://dev.opencode.ai/docs/server/)

---

## Overview

This document catalogs all missing features in the OpenCode Obsidian plugin compared to the full OpenCode Server API. Each feature area is marked with priority and implementation status.

---

## Feature Areas

### 1. Session Management (Critical Priority)

**Status**: 🟡 Partially Implemented  
**Spec**: `session-management-enhancement/requirements.md`

#### Implemented
- ✅ Create session
- ✅ Send message (synchronous)
- ✅ Abort session

#### Missing
- ❌ List all sessions (`GET /session`)
- ❌ Get session details (`GET /session/:id`)
- ❌ Delete session (`DELETE /session/:id`)
- ❌ Update session (`PATCH /session/:id`)
- ❌ Get session children (`GET /session/:id/children`)
- ❌ Get session status (`GET /session/status`)
- ❌ Fork session (`POST /session/:id/fork`)
- ❌ Share session (`POST /session/:id/share`, `DELETE /session/:id/share`)
- ❌ Get session diff (`GET /session/:id/diff`)
- ❌ Summarize session (`POST /session/:id/summarize`)
- ❌ Revert messages (`POST /session/:id/revert`, `POST /session/:id/unrevert`)
- ❌ Initialize session (`POST /session/:id/init`)
- ❌ Get todo list (`GET /session/:id/todo`)

---

### 2. Message Management (High Priority)

**Status**: 🔴 Not Implemented  
**Spec**: TBD

#### Missing
- ❌ List messages (`GET /session/:id/message`)
- ❌ Get message details (`GET /session/:id/message/:messageID`)
- ❌ Send async message (`POST /session/:id/prompt_async`)
- ❌ Execute shell command (`POST /session/:id/shell`)

**Impact**: Cannot view message history, cannot send long-running async messages

---

### 3. Provider & Model Selection (Medium Priority)

**Status**: 🔴 Not Implemented  
**Spec**: TBD

#### Missing
- ❌ List providers (`GET /config/providers`)
- ❌ Get provider auth methods (`GET /provider/auth`)
- ❌ OAuth authorization (`POST /provider/{id}/oauth/authorize`)
- ❌ OAuth callback (`POST /provider/{id}/oauth/callback`)
- ❌ Set auth credentials (`PUT /auth/:id`)

**Impact**: Cannot select AI provider/model in plugin, must configure via CLI

**Note**: OAuth flow is complex and low priority. Focus on provider listing first.

---

### 4. File Search & Navigation (High Priority)

**Status**: 🔴 Not Implemented  
**Spec**: TBD

#### Missing
- ❌ Search text in files (`GET /find?pattern=<pat>`)
- ❌ Find files by name (`GET /find/file?query=<q>`)
- ❌ Find symbols (`GET /find/symbol?query=<q>`)
- ❌ List files (`GET /file?path=<path>`)
- ❌ Read file content (`GET /file/content?path=<p>`)
- ❌ Get file status (`GET /file/status`)

**Impact**: Cannot search codebase through OpenCode, must use Obsidian tools

**Note**: Plugin has Obsidian tools for file operations, but direct API is more efficient

---

### 5. Agent Management (High Priority)

**Status**: 🔴 Not Implemented  
**Spec**: TBD

#### Missing
- ❌ List agents (`GET /agent`)

**Impact**: Agent list is hardcoded, cannot dynamically discover new agents

---

### 6. Permission Integration (Critical Priority)

**Status**: 🔴 Not Implemented  
**Spec**: TBD

#### Missing
- ❌ Respond to permission requests (`POST /session/:id/permissions/:permissionID`)

**Impact**: Two separate permission systems (plugin vs server) may conflict

**Note**: Plugin has its own `PermissionManager`, needs integration with server

---

### 7. Project & Path Management (Medium Priority)

**Status**: 🔴 Not Implemented  
**Spec**: TBD

#### Missing
- ❌ List projects (`GET /project`)
- ❌ Get current project (`GET /project/current`)
- ❌ Get current path (`GET /path`)
- ❌ Get VCS info (`GET /vcs`)

**Impact**: Cannot get project context information

---

### 8. Configuration Management (Medium Priority)

**Status**: 🔴 Not Implemented  
**Spec**: TBD

#### Missing
- ❌ Get config (`GET /config`)
- ❌ Update config (`PATCH /config`)

**Impact**: Cannot dynamically read or update OpenCode configuration

---

### 9. LSP/Formatter/MCP Status (Low Priority)

**Status**: 🔴 Not Implemented  
**Spec**: TBD

#### Missing
- ❌ Get LSP status (`GET /lsp`)
- ❌ Get formatter status (`GET /formatter`)
- ❌ Get MCP status (`GET /mcp`)
- ❌ Add MCP server (`POST /mcp`)

**Impact**: Cannot query or manage language servers

---

### 10. Tool Management (Low Priority - Experimental)

**Status**: 🔴 Not Implemented  
**Spec**: TBD

#### Missing
- ❌ List tool IDs (`GET /experimental/tool/ids`)
- ❌ Get tool schemas (`GET /experimental/tool?provider=<p>&model=<m>`)

**Impact**: Cannot query available tools dynamically

---

### 11. TUI Control (Low Priority - Not Applicable)

**Status**: 🔴 Not Implemented  
**Spec**: N/A

#### Missing
- ❌ All TUI control endpoints (`POST /tui/*`)

**Impact**: None (Obsidian plugin doesn't need to control TUI)

**Note**: Out of scope for Obsidian plugin

---

### 12. Instance Management (Low Priority)

**Status**: 🔴 Not Implemented  
**Spec**: TBD

#### Missing
- ❌ Dispose instance (`POST /instance/dispose`)

**Impact**: Cannot manually release server instance

---

### 13. Logging (Low Priority)

**Status**: 🔴 Not Implemented  
**Spec**: TBD

#### Missing
- ❌ Write log entry (`POST /log`)

**Impact**: Cannot send logs to OpenCode Server

---

## Implementation Roadmap

### Phase 1: Core Features (Weeks 1-3)
1. ✅ Session Management - Basic CRUD
2. ✅ Message History
3. ✅ Permission Integration
4. ✅ Agent Management

### Phase 2: Advanced Session Features (Weeks 4-6)
5. ✅ Session Fork/Revert
6. ✅ Session Diff Viewer
7. ✅ Provider Selection

### Phase 3: Search & Navigation (Weeks 7-9)
8. ✅ File Search
9. ✅ Symbol Search
10. ✅ Project Info

### Phase 4: Polish & Optimization (Weeks 10+)
11. ✅ Performance optimization
12. ✅ Error handling improvements
13. ✅ UI/UX enhancements

---

## Priority Legend

- 🔴 **Critical**: Blocks core functionality, implement immediately
- 🟡 **High**: Important for user experience, implement soon
- 🟢 **Medium**: Nice to have, implement when time allows
- ⚪ **Low**: Optional or not applicable, defer or skip

---

## Notes

1. **Official SDK**: Plugin uses `@opencode-ai/sdk` which provides all these APIs. Implementation is mostly about UI and state management.

2. **Obsidian Tools**: Plugin has its own tool system for vault operations. Some features (like file operations) are available through tools but not direct API calls.

3. **Permission Systems**: Need to reconcile plugin's `PermissionManager` with server's permission system.

4. **OAuth Complexity**: Provider OAuth flow is complex and may be better handled via CLI/config files.

---

**Document Version**: 1.0  
**Last Updated**: 2026-01-16  
**Maintainer**: Development Team
