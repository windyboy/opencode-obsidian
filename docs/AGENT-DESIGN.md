# Agent Design Document

## Overview

This document describes the design and implementation details for the Agent system in the OpenCode Obsidian plugin. Agents are specialized AI assistant configurations that enable users to create purpose-built assistants for different tasks, each with their own model, system prompt, and tool access patterns.

## Core Design Principles

1. **Session-Level Binding**: Each conversation binds to a specific agent, not globally *(Planned - not yet implemented)*
2. **Model Override**: Each agent can specify its own AI model (provider + model ID) *(Planned - not yet implemented)*
3. **Visual Identity**: Agents have colors and categories for easy identification *(Partially implemented - colors supported, categories planned)*
4. **Backward Compatibility**: Default agents work out of the box without configuration *(Implemented)*
5. **Extensibility**: Users can create custom agents via `.opencode/agent/*.md` files *(Planned - not yet implemented)*

## Current Implementation Status

**What Works Now**:
- ✅ Basic agent selection via dropdown in UI
- ✅ Default agents available in UI (implementation may vary)
- ✅ Agent ID passed to `startSession` (via system message)
- ✅ Agent selector in settings UI
- ✅ `session.command` API supports `agent` parameter

**What's Planned**:
- ⏳ Session-level agent binding (conversation-specific agents)
- ⏳ Agent loading from `.opencode/agent/*.md` files
- ⏳ Model override per agent
- ⏳ Enhanced UI with categories, badges, and visual indicators
- ⏳ Agent switching mid-conversation
- ⏳ Agent validation and error handling

## Default Agents

### Agent List

The plugin provides 5 default agents, each optimized for specific use cases:

| ID | Name | Description | Category | Color | Model |
|---|---|---|---|---|---|
| `assistant` | General Assistant | Versatile assistant for general tasks and questions | general | `#7C3AED` | Default |
| `note-writer` | Note Writer | Specialized in writing and organizing Obsidian notes | writing | `#059669` | Default |
| `research-assistant` | Research Assistant | Helps with research, fact-checking, and information gathering | research | `#DC2626` | Default |
| `thinking-partner` | Thinking Partner | Engages in deep thinking and idea exploration | thinking | `#2563EB` | Default |
| `read-only` | Read-Only Assistant | Safe mode - can only read notes, cannot modify anything | safe | `#6B7280` | Default |

### Agent Categories

- **general**: General-purpose assistants
- **writing**: Note writing and documentation
- **research**: Research and information gathering
- **thinking**: Deep thinking and ideation
- **safe**: Read-only mode for safety
- **custom**: User-defined agents

## Data Structures

### Agent Interface

**Current Implementation** (as defined in `src/types.ts`):

```typescript
interface Agent {
  /** Agent identifier - filename without .md extension */
  id: string;
  
  /** Display name for the agent */
  name: string;
  
  /** Optional description shown in UI */
  description?: string;
  
  /** System prompt content (Markdown) */
  systemPrompt: string;
  
  /** Optional model override */
  model?: {
    providerID: string;  // e.g., "anthropic", "openai"
    modelID: string;     // e.g., "claude-3-5-sonnet-20241022"
  };
  
  /** Tool enablement configuration */
  tools?: { [key: string]: boolean };
  
  /** Referenced skill IDs */
  skills?: string[];
  
  /** UI color in hex format */
  color?: string;
  
  /** Hide from UI if true */
  hidden?: boolean;
  
  /** Agent mode identifier (e.g., "primary") */
  mode?: string;
}
```

**Future Extensions** (planned but not yet implemented):

```typescript
interface Agent {
  // ... existing fields above ...
  
  /** Agent category */
  category?: 'general' | 'writing' | 'research' | 'thinking' | 'safe' | 'custom';
  
  /** Icon identifier (optional) */
  icon?: string;
  
  /** Whether this is a built-in default agent */
  isDefault?: boolean;
}
```

### Conversation Binding

**Planned Design** (not yet implemented):

Each conversation should bind to a specific agent:

```typescript
interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  sessionId?: string | null;
  
  /** Agent ID bound to this conversation */
  agentId?: string;  // ⏳ Planned - not yet in current implementation
  
  /** Agent snapshot at conversation creation time */
  agentSnapshot?: {  // ⏳ Planned - not yet in current implementation
    id: string;
    name: string;
    description?: string;
  };
  
  // ... other fields
}
```

**Current Implementation** (as defined in `src/types.ts`):

```typescript
interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  sessionId?: string | null;
  pendingImagePath?: string;
  providerID?: string;
  // Note: agentId and agentSnapshot are not yet implemented
}
```

**Current Behavior**: All conversations use the global `settings.agent` value. There is no per-conversation agent binding yet.

## UI/UX Design

### Agent Selection UI

#### Location 1: Input Toolbar (Quick Switch)
- Dropdown selector in input toolbar
- Shows current agent with color indicator
- Click to expand and see all available agents
- Grouped by category with visual separators

#### Location 2: Conversation Header
- Display current agent badge with name and color
- Click to switch agent (with confirmation if conversation has messages)
- Shows agent description on hover

#### Location 3: Message Display
- Assistant messages show agent badge/indicator
- Color-coded to match agent

### Visual Design

```
┌─────────────────────────────────────┐
│  Conversation Header                │
│  ┌─────────────┐                    │
│  │ 🟣 General  │ ← Agent Badge     │
│  │ Assistant   │                    │
│  └─────────────┘                    │
├─────────────────────────────────────┤
│  Messages...                        │
│                                     │
│  [User] Hello                       │
│  [🟣 General Assistant] Hi there!   │
│                                     │
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐ │
│  │ 🟣 General Assistant  ▼      │ │ ← Agent Selector
│  └───────────────────────────────┘ │
│  [Type your message...]             │
└─────────────────────────────────────┘
```

### Agent Selector Dropdown

```
┌─────────────────────────────────┐
│ General                         │
│ ┌─────────────────────────────┐ │
│ │ 🟣 General Assistant        │ │
│ │    Versatile assistant...   │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ Writing                         │
│ ┌─────────────────────────────┐ │
│ │ 🟢 Note Writer              │ │
│ │    Specialized in writing...│ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ Research                        │
│ ┌─────────────────────────────┐ │
│ │ 🔴 Research Assistant       │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

## Implementation Details

### Agent Manager

Centralized agent management utility:

```typescript
class AgentManager {
  /** Get all available agents (default + custom) */
  getAllAgents(): Array<Agent | DefaultAgent>;
  
  /** Get agent by ID */
  getAgentById(id: string): Agent | DefaultAgent | null;
  
  /** Validate agent exists */
  validateAgent(id: string): boolean;
  
  /** Get default agent */
  getDefaultAgent(): DefaultAgent;
  
  /** Format display name with description */
  getDisplayName(agent: Agent | DefaultAgent): string;
}
```

### Session Creation Flow

**Current Implementation**:

```
1. User creates new conversation
   ↓
2. ConversationManager.createNewConversation() (no agentId parameter)
   ↓
3. Create Conversation (no agentId field)
   ↓
4. Start session with global settings.agent (via system message)
   ↓
5. OpenCode Server receives agent info from system message
```

**Planned Flow** (when fully implemented):

```
1. User creates new conversation
   ↓
2. Select agent (from dropdown or default)
   ↓
3. ConversationManager.createNewConversation(agentId?)
   ↓
4. Validate agent exists (fallback to default if not)
   ↓
5. Create Conversation with agentId bound
   ↓
6. Start session with agent ID and model override
   ↓
7. OpenCode Server resolves agent config:
   - Load agent system prompt
   - Apply model override (if specified)
   - Apply tool configuration
   - Merge skills
```

### Message Sending Flow

**Current Implementation**:

```
1. User sends message
   ↓
2. Use global settings.agent (all conversations share the same agent)
   ↓
3. Call startSession with agent ID (passed via system message)
   ↓
4. Call session.prompt with message content only
   ↓
5. OpenCode Server receives agent info from system message
```

**Planned Flow** (when fully implemented):

```
1. User sends message
   ↓
2. Get current conversation's agentId
   ↓
3. Load agent configuration from settings.agents or .opencode/agent/*.md
   ↓
4. Extract model override (if any)
   ↓
5. Call OpenCode Server with:
   - agent: agentId (string) - via session.prompt body (if SDK supports it)
   - model: { providerID, modelID } (if specified and SDK supports it)
   - parts: message content
   ↓
6. OpenCode Server uses agent config + model override
```

### SDK Integration

**Current Implementation Status**:

The OpenCode SDK `session.prompt` API is currently called with only `parts`:

```typescript
// Current implementation (src/opencode-server/client.ts)
sdkClient.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: "text", text: content }],
  },
});
```

The `session.command` API already supports the `agent` parameter:

```typescript
// Current implementation (src/opencode-server/client.ts)
sdkClient.session.command({
  path: { id: sessionId },
  body: {
    command,
    arguments: argumentsText,
    ...(agent ? { agent } : {}),
  },
});
```

**Agent Passing Mechanism**:

Currently, the agent ID is passed via system message during session initialization:

```typescript
// Current implementation (src/opencode-server/client.ts)
private buildSystemMessage(
  context?: SessionContext,
  agent?: string,
  instructions?: string[],
): string | null {
  const parts: string[] = [];
  if (agent) {
    parts.push(`Agent: ${agent}`);
  }
  // ... other context ...
  return parts.length > 0 ? parts.join("\n") : null;
}
```

**Future Enhancement** (when SDK supports it):

If the OpenCode SDK `session.prompt` API supports `agent` and `model` parameters, the implementation should be updated to:

```typescript
sdkClient.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: "text", text: content }],
    agent?: string,              // Agent ID (if SDK supports it)
    model?: {                    // Model override (if SDK supports it)
      providerID: string,
      modelID: string
    },
    system?: string,             // System prompt (if SDK supports it)
    tools?: { [key: string]: boolean }  // Tool config (if SDK supports it)
  }
});
```

**Note**: The SDK API capabilities need to be verified. If these parameters are not supported, the current system message approach will continue to be used.

## API Design

### Client API Methods

#### `startSession` (Current Implementation)

**Current signature** (as implemented in `src/opencode-server/client.ts`):

```typescript
async startSession(
  context?: SessionContext,
  agent?: string,
  instructions?: string[],
): Promise<string>
```

**Future enhancement** (planned):

```typescript
async startSession(
  context?: SessionContext,
  agent?: string,
  instructions?: string[],
  modelOverride?: { providerID: string; modelID: string }
): Promise<string>
```

**Note**: Currently, `modelOverride` is not supported. The agent is passed via system message during session initialization.

#### `sendMessage` (Current Implementation)

**Current signature** (as implemented in `src/opencode-server/client.ts`):

```typescript
async sendMessage(
  sessionId: string,
  content: string
): Promise<void>
```

**Future enhancement** (planned):

```typescript
async sendMessage(
  sessionId: string,
  content: string,
  agent?: string,
  modelOverride?: { providerID: string; modelID: string }
): Promise<void>
```

**Note**: Currently, agent and model override are not passed per message. They are set during session initialization.

#### `sendSessionMessage` (Current Implementation)

**Current signature** (as implemented in `src/opencode-server/client.ts`):

```typescript
async sendSessionMessage(
  sessionId: string,
  content: string,
  images?: ImageAttachment[]
): Promise<void>
```

**Future enhancement** (planned):

```typescript
async sendSessionMessage(
  sessionId: string,
  content: string,
  images?: ImageAttachment[],
  agent?: string,
  modelOverride?: { providerID: string; modelID: string }
): Promise<void>
```

**Note**: Image attachments are currently not fully supported (logged as warning).

### Conversation Manager Methods

#### `createNewConversation` (Current Implementation)

**Current signature** (as implemented in `src/views/services/conversation-manager.ts`):

```typescript
async createNewConversation(): Promise<void>
```

**Current behavior**:
- Creates a new conversation without `agentId` parameter
- Conversation does not bind to a specific agent
- All conversations use global `settings.agent`

**Planned enhancement**:

```typescript
async createNewConversation(agentId?: string): Promise<void>
```
- If `agentId` not provided, uses `settings.agent` (default agent)
- Validates agent exists
- Creates conversation with `agentId` bound
- Stores agent snapshot for history

#### `switchAgent` (Planned - Not Yet Implemented)

```typescript
async switchAgent(
  conversationId: string,
  newAgentId: string
): Promise<void>
```
- Validates new agent exists
- Shows confirmation if conversation has messages
- Updates conversation's `agentId`
- Clears session to start fresh with new agent

**Note**: This method is not yet implemented. Agent switching is not currently supported.

## Default Agent Definitions

### General Assistant
```typescript
{
  id: 'assistant',
  name: 'General Assistant',
  description: 'Versatile assistant for general tasks and questions',
  category: 'general',
  color: '#7C3AED'
}
```

### Note Writer
```typescript
{
  id: 'note-writer',
  name: 'Note Writer',
  description: 'Specialized in writing and organizing Obsidian notes',
  category: 'writing',
  color: '#059669'
}
```

### Research Assistant
```typescript
{
  id: 'research-assistant',
  name: 'Research Assistant',
  description: 'Helps with research, fact-checking, and information gathering',
  category: 'research',
  color: '#DC2626'
}
```

### Thinking Partner
```typescript
{
  id: 'thinking-partner',
  name: 'Thinking Partner',
  description: 'Engages in deep thinking and idea exploration',
  category: 'thinking',
  color: '#2563EB'
}
```

### Read-Only Assistant
```typescript
{
  id: 'read-only',
  name: 'Read-Only Assistant',
  description: 'Safe mode - can only read notes, cannot modify anything',
  category: 'safe',
  color: '#6B7280',
  tools: {
    '*': false,
    'obsidian.read_note': true,
    'obsidian.search_vault': true,
    'obsidian.list_notes': true,
    'obsidian.get_note_metadata': true
  }
}
```

**Note**: These are the designed default agents. The actual implementation may vary and will be updated to match this design.

## Custom Agent File Format

Custom agents are defined in `.opencode/agent/{agent-id}.md`:

```markdown
---
name: Documentation Writer
description: Specialized agent for creating documentation
category: writing
color: "#38A3EE"
model:
  providerID: anthropic
  modelID: claude-3-5-sonnet-20241022
tools:
  "*": false
  obsidian.read_note: true
  obsidian.create_note: true
  obsidian.update_note: true
skills:
  - markdown-formatting
  - technical-writing
---

You are a documentation specialist...

[System prompt content here]
```

## Error Handling

### Agent Not Found
- Fallback to default agent (`assistant`)
- Show warning notice to user
- Log error for debugging

### Model Not Available
- Fallback to default model
- Show warning notice
- Continue with conversation

### Invalid Agent Configuration
- Skip invalid agents
- Show error in settings
- Allow user to fix configuration

## Migration Strategy

### Existing Conversations
- Existing conversations without `agentId` use default agent
- Agent snapshot is optional (for backward compatibility)
- No breaking changes to existing data

### Settings Migration
- Keep `settings.agent` as default agent ID
- Add `conversations[].agentId` for session-level binding
- Maintain backward compatibility

## Testing Strategy

### Unit Tests
- AgentManager: validation, lookup, formatting
- Agent selection UI: rendering, interaction
- Model override: parameter passing

### Integration Tests
- Session creation with agent
- Message sending with model override
- Agent switching mid-conversation

### E2E Tests
- Create conversation with agent
- Switch agent and verify behavior
- Verify model is used correctly

## Future Enhancements

1. **Agent Templates**: Pre-built agent templates for common use cases
2. **Agent Sharing**: Share agent definitions between vaults
3. **Agent Analytics**: Track which agents are used most
4. **Smart Agent Suggestions**: Suggest agent based on conversation context
5. **Agent Versioning**: Track agent definition changes over time

## Implementation Status

### Phase 1: Core Functionality
- [x] Basic agent selection in UI (simple dropdown)
- [x] Agent ID passed to `startSession` via system message
- [x] Default agents available in UI
- [ ] Extend `Conversation` interface with `agentId` (session-level binding)
- [ ] Create `AgentManager` utility class
- [ ] Load agents from `.opencode/agent/*.md` files
- [ ] Modify `startSession` to accept model override
- [ ] Modify `sendMessage` to pass model and agent (if SDK supports it)

### Phase 2: UI Implementation
- [x] Basic agent selector dropdown in input toolbar
- [x] Agent selector in settings UI
- [ ] Enhanced `AgentSelectorComponent` with category grouping
- [ ] Add agent display in conversation header
- [ ] Add agent indicator in messages
- [ ] Implement agent switching with confirmation

### Phase 3: Integration
- [ ] Update `ConversationManager.createNewConversation` to accept `agentId`
- [ ] Update `MessageSender.sendMessage` to use conversation's `agentId`
- [ ] Add agent validation
- [ ] Error handling and fallbacks
- [ ] Agent loading from `.opencode/agent/*.md` files

### Phase 4: Polish
- [ ] Add visual styling for agent badges
- [ ] Add tooltips with agent descriptions
- [ ] Category grouping in selector
- [ ] Settings UI improvements
- [ ] Support for `category`, `icon`, `isDefault` fields

## Current Limitations

1. **Session-Level Binding**: Conversations do not currently bind to specific agents. The global `settings.agent` is used for all conversations.

2. **Agent Loading**: Agents are not automatically loaded from `.opencode/agent/*.md` files. The `settings.agents` array may be empty.

3. **Model Override**: Model override is not implemented. Agent-specific model configurations are not applied.

4. **SDK API Support**: The SDK `session.prompt` API may not support `agent` and `model` parameters directly. Current implementation uses system messages.

5. **Agent Categories**: Category-based grouping and filtering is not implemented in the UI.

6. **Agent Switching**: Switching agents mid-conversation is not implemented.

## Future Enhancements

1. **Verify SDK API**: Confirm whether `session.prompt` supports `agent` and `model` parameters
2. **Implement Agent Loading**: Load agents from `.opencode/agent/*.md` files on plugin startup
3. **Session-Level Binding**: Bind each conversation to a specific agent
4. **Model Override**: Pass model override to SDK when supported
5. **Enhanced UI**: Implement category grouping, badges, and visual indicators
