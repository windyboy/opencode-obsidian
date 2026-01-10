# OpenCode Server Plugin - Obsidian Bridge

This document describes the Obsidian Bridge plugin for OpenCode Server, which provides access to Obsidian vault operations through the OpenCode Server architecture.

## Overview

The Obsidian Bridge plugin enables OpenCode Server to interact with Obsidian vaults through a set of standardized tools. The plugin acts as a bridge between OpenCode Server (the agent runtime) and the Obsidian plugin (the tool executor).

## Architecture

```
OpenCode Server → WebSocket → Obsidian Plugin → Tool Executor → Vault Operations
```

The Obsidian plugin runs as a thin client that:
- Receives tool calls from OpenCode Server via WebSocket
- Executes operations on the local Obsidian vault
- Enforces permission checks and audit logging
- Sends results back to OpenCode Server

## Available Tools

### Read-Only Tools

#### 1. `obsidian.search_vault`

Search for notes in the vault by query string.

**Input:**
```typescript
{
  query: string              // Search query string
  limit?: number            // Maximum results (default: 20)
  includeContent?: boolean  // Include content snippets (default: false)
}
```

**Output:**
```typescript
{
  results: Array<{
    path: string
    title?: string
    content?: string        // If includeContent=true
    matchCount?: number
  }>
  totalMatches: number
}
```

**Example:**
```json
{
  "toolName": "obsidian.search_vault",
  "args": {
    "query": "project ideas",
    "limit": 10,
    "includeContent": true
  }
}
```

#### 2. `obsidian.read_note`

Read the content of a note file.

**Input:**
```typescript
{
  path: string  // Path to note file (relative to vault root)
}
```

**Output:**
```typescript
{
  path: string
  content: string
  exists: boolean
}
```

**Example:**
```json
{
  "toolName": "obsidian.read_note",
  "args": {
    "path": "Projects/Project1.md"
  }
}
```

#### 3. `obsidian.list_notes`

List notes in a folder (recursively by default).

**Input:**
```typescript
{
  folder?: string           // Folder path (default: "" for root)
  recursive?: boolean       // List recursively (default: true)
  includeFolders?: boolean  // Include folders in results (default: false)
}
```

**Output:**
```typescript
{
  files: Array<{
    path: string
    isFolder?: boolean
    size?: number           // File size in bytes
    modified?: number       // Last modification timestamp (ms)
  }>
  totalCount: number
}
```

**Example:**
```json
{
  "toolName": "obsidian.list_notes",
  "args": {
    "folder": "Projects",
    "recursive": true,
    "includeFolders": false
  }
}
```

#### 4. `obsidian.get_note_metadata`

Get metadata about a note including frontmatter, tags, links, and statistics.

**Input:**
```typescript
{
  path: string
  includeLinks?: boolean      // Include link relationships (default: true)
  includeTags?: boolean       // Include tags (default: true)
  includeProperties?: boolean // Include frontmatter (default: true)
}
```

**Output:**
```typescript
{
  path: string
  exists: boolean
  title?: string              // From frontmatter or first heading
  frontmatter?: Record<string, unknown>
  tags?: string[]
  links?: {
    outlinks: string[]        // Files this note links to
    backlinks: string[]       // Files that link to this note
    unresolvedLinks?: string[] // Unresolved link references
  }
  stats?: {
    wordCount?: number
    lineCount?: number
    characterCount?: number
  }
}
```

**Example:**
```json
{
  "toolName": "obsidian.get_note_metadata",
  "args": {
    "path": "Projects/Project1.md",
    "includeLinks": true,
    "includeTags": true,
    "includeProperties": true
  }
}
```

### Write Tools (Scoped-Write, Requires Approval)

#### 5. `obsidian.create_note`

Create a new note file with specified content.

**Input:**
```typescript
{
  path: string       // Path where note should be created
  content: string    // Content to write
  overwrite?: boolean // Overwrite if exists (default: false)
}
```

**Output:**
```typescript
{
  path: string
  created: boolean   // Whether file was actually created
  existed?: boolean  // Whether file already existed
}
```

**Example:**
```json
{
  "toolName": "obsidian.create_note",
  "args": {
    "path": "Projects/NewProject.md",
    "content": "# New Project\n\nThis is a new project note.",
    "overwrite": false
  }
}
```

**Note:** This operation requires user approval via PermissionModal.

#### 6. `obsidian.update_note`

Update a note file with new content. Supports multiple update modes for flexible markdown editing.

**Input:**
```typescript
{
  path: string
  content: string    // Content to update with
  mode: 'replace' | 'append' | 'prepend' | 'insert'
  insertAt?: number           // Line number for insert mode (1-based)
  insertMarker?: string       // Marker string for insert mode (alternative to insertAt)
  dryRun?: boolean            // Preview without applying (default: true)
}
```

**Output:**
```typescript
{
  path: string
  updated: boolean            // Whether file was actually updated
  mode: string                // Update mode that was used
  preview?: {
    originalContent?: string  // Original file content
    newContent: string        // Content after update
    addedLines?: number       // Number of lines added
    removedLines?: number     // Number of lines removed
  }
}
```

**Update Modes:**

1. **`replace`**: Completely replace file content
   ```json
   {
     "toolName": "obsidian.update_note",
     "args": {
       "path": "Projects/Project1.md",
       "content": "# Updated Project\n\nNew content here.",
       "mode": "replace",
       "dryRun": true
     }
   }
   ```

2. **`append`**: Append content to end of file
   ```json
   {
     "toolName": "obsidian.update_note",
     "args": {
       "path": "Projects/Project1.md",
       "content": "\n\n## Additional Notes\n\nNew section appended.",
       "mode": "append",
       "dryRun": true
     }
   }
   ```

3. **`prepend`**: Prepend content to beginning of file
   ```json
   {
     "toolName": "obsidian.update_note",
     "args": {
       "path": "Projects/Project1.md",
       "content": "## Important Notice\n\nThis note was updated.\n\n---\n\n",
       "mode": "prepend",
       "dryRun": true
     }
   }
   ```

4. **`insert`**: Insert content at specific position (line number or marker)
   
   Using line number:
   ```json
   {
     "toolName": "obsidian.update_note",
     "args": {
       "path": "Projects/Project1.md",
       "content": "## New Section\n\nInserted content.",
       "mode": "insert",
       "insertAt": 5,
       "dryRun": true
     }
   }
   ```
   
   Using marker:
   ```json
   {
     "toolName": "obsidian.update_note",
     "args": {
       "path": "Projects/Project1.md",
       "content": "## New Section\n\nInserted content.",
       "mode": "insert",
       "insertMarker": "<!-- INSERT HERE -->",
       "dryRun": true
     }
   }
   ```

**Note:** 
- This operation requires user approval via PermissionModal.
- Default `dryRun=true` means operations return preview without applying changes.
- Set `dryRun=false` to actually apply changes (still requires approval if permission system requires it).

## Permission System

### Permission Levels

- **`read-only`**: Can only read vault files (no approval needed)
- **`scoped-write`**: Can write to specific paths (requires approval)
- **`full-write`**: Can write anywhere (requires approval)

### Permission Scope

Permission scopes control which operations are allowed:

- **`allowedPaths`**: Glob patterns for allowed file paths (e.g., `["Projects/**"]`)
- **`deniedPaths`**: Glob patterns for denied paths (checked first) (e.g., `["**/.obsidian/**"]`)
- **`maxFileSize`**: Maximum file size in bytes (default: 10MB)
- **`allowedExtensions`**: List of allowed extensions (e.g., `[".md", ".txt"]`)

### Permission Request Flow

1. OpenCode Server sends `tool.call` or `permission.request` message
2. Obsidian plugin checks permissions
3. If approval required, `PermissionModal` is displayed to user
4. User approves or denies the operation
5. Obsidian plugin sends `permission.response` or `tool.result` back to OpenCode Server

## Audit Logging

All tool executions are logged with:
- Timestamp
- Tool name and arguments
- Session ID and call ID
- Permission level and approval status
- Execution duration
- Error information (if any)

Logs are stored in `.obsidian/opencode-audit/` directory, organized by date.

## Error Handling

Tool execution errors are returned in the `tool.result` message:

```typescript
{
  type: 'tool.result',
  payload: {
    sessionId: string
    callId: string
    success: false
    error: {
      code: string
      message: string
      details?: unknown
    }
  }
}
```

Common error codes:
- `PERMISSION_DENIED`: Operation not allowed by permission system
- `FILE_NOT_FOUND`: Requested file doesn't exist
- `VALIDATION_ERROR`: Input validation failed
- `EXECUTION_ERROR`: Error during tool execution

## Best Practices

1. **Always use `dryRun=true` first**: Preview changes before applying them
2. **Use appropriate update modes**: 
   - Use `replace` for full rewrites
   - Use `append` for adding notes/logs
   - Use `prepend` for headers/metadata
   - Use `insert` for precise content insertion
3. **Check file existence**: Use `read_note` or `get_note_metadata` before write operations
4. **Handle errors gracefully**: Check `success` field in tool results
5. **Respect user approval**: Don't retry denied operations automatically

## Migration from `apply_patch`

The `apply_patch` tool has been replaced by `update_note` for better markdown editing:

- **Before**: Required generating unified diff format
- **After**: Simple content operations with clear modes

The `update_note` tool is:
- Easier for LLMs to generate correctly
- More intuitive for markdown editing scenarios
- Supports more natural operations (append, prepend, insert)
- No complex diff parsing required

## Examples

### Complete Workflow: Reading and Updating a Note

```json
// 1. Read existing note
{
  "toolName": "obsidian.read_note",
  "args": { "path": "Projects/Project1.md" }
}

// 2. Get metadata (check tags, links)
{
  "toolName": "obsidian.get_note_metadata",
  "args": { "path": "Projects/Project1.md" }
}

// 3. Append new section (preview first)
{
  "toolName": "obsidian.update_note",
  "args": {
    "path": "Projects/Project1.md",
    "content": "\n\n## Status Update\n\nCompleted feature X.",
    "mode": "append",
    "dryRun": true
  }
}

// 4. Apply change (requires approval)
{
  "toolName": "obsidian.update_note",
  "args": {
    "path": "Projects/Project1.md",
    "content": "\n\n## Status Update\n\nCompleted feature X.",
    "mode": "append",
    "dryRun": false
  }
}
```

## Troubleshooting

### Tool returns permission denied
- Check permission level in settings
- Verify path matches allowed patterns
- Check file size limits
- Verify file extension is allowed

### Insert mode not finding marker
- Ensure marker string exists in file
- Check for whitespace differences
- Use `insertAt` with line number as alternative

### File not found errors
- Verify path is relative to vault root
- Check file exists with `read_note` first
- Ensure path uses forward slashes (`/`)

### Preview not showing
- Ensure `dryRun=true` is set
- Check that file exists (for replace/append/prepend modes)
- Verify insert position exists (for insert mode)
