# Agents

## Overview

Agents are AI assistant configurations that define specialized behaviors, system prompts, model preferences, and tool access patterns. The OpenCode Obsidian plugin supports custom agents loaded from `.opencode/agent/*.md` files, allowing you to create purpose-built AI assistants for different tasks.

## Table of Contents

1. [Agent Structure](#agent-structure)
2. [Creating Custom Agents](#creating-custom-agents)
3. [Agent Configuration](#agent-configuration)
4. [Skills Integration](#skills-integration)
5. [Tool Configuration](#tool-configuration)
6. [Model Overrides](#model-overrides)
7. [Agent Selection](#agent-selection)
8. [Best Practices](#best-practices)
9. [Examples](#examples)

## Agent Structure

An agent is defined by the `Agent` interface in `src/types.ts`:

```typescript
interface Agent {
  id: string              // Agent identifier (filename without .md)
  name: string            // Display name
  description?: string    // Optional description
  systemPrompt: string    // System prompt content
  model?: {               // Optional model override
    providerID: string    // Provider identifier
    modelID: string       // Model identifier
  }
  tools?: {               // Tool enablement configuration
    [key: string]: boolean
  }
  skills?: string[]       // Referenced skill IDs
  color?: string          // UI color (hex format)
  hidden?: boolean        // Hide from UI
  mode?: string           // Agent mode identifier
}
```

### Key Properties

- **id**: Derived from the filename (e.g., `docs.md` → `id: "docs"`)
- **name**: Display name shown in the UI (from frontmatter or derived from id)
- **systemPrompt**: The core instructions that define the agent's behavior
- **model**: Optional override to use a specific AI model for this agent
- **tools**: Control which tools the agent can access
- **skills**: Reusable prompt components merged into the system prompt
- **color**: Visual identifier in the UI (e.g., `"#38A3EE"`)
- **hidden**: Set to `true` to hide the agent from the UI
- **mode**: Agent mode identifier (e.g., `"primary"`)

## Creating Custom Agents

### File Location

Custom agents are stored in the `.opencode/agent/` directory within your vault:

```
vault-root/
└── .opencode/
    └── agent/
        ├── docs.md
        ├── triage.md
        └── research.md
```

### File Format

Agent files use Markdown with YAML frontmatter:

```markdown
---
name: Documentation Writer
description: Specialized agent for writing and updating documentation
color: "#38A3EE"
model:
  providerID: anthropic
  modelID: claude-3-5-sonnet-20241022
tools:
  "*": false
  obsidian.read_note: true
  obsidian.update_note: true
  obsidian.create_note: true
skills:
  - markdown-formatting
  - technical-writing
---

You are a documentation specialist focused on creating clear, comprehensive documentation.

Your responsibilities:
- Write clear, concise documentation
- Follow markdown best practices
- Maintain consistent formatting
- Include relevant examples
- Update existing documentation when needed

When writing documentation:
1. Start with a clear overview
2. Use proper heading hierarchy
3. Include code examples where appropriate
4. Add links to related documentation
5. Keep language simple and accessible
```

### Frontmatter Fields

All frontmatter fields are optional. If omitted, defaults are used:

- **name**: Defaults to capitalized filename (e.g., `docs.md` → `"Docs"`)
- **description**: No default, shown in agent selection UI
- **color**: Defaults to plugin's default color
- **model**: Uses the default model configured in settings
- **tools**: Defaults to all tools enabled
- **skills**: No skills included by default
- **hidden**: Defaults to `false`
- **mode**: No default mode

## Agent Configuration

### Loading Agents

Agents are automatically loaded when the plugin starts. The loading process:

1. Scans `.opencode/agent/` directory for `.md` files
2. Parses YAML frontmatter for configuration
3. Extracts system prompt from markdown content
4. Validates agent structure
5. Stores in plugin settings for UI display

### Agent Resolution

When a conversation starts, the agent configuration is resolved through these steps:

1. **Base Configuration**: Load the selected agent's configuration
2. **Skill Merging**: Merge referenced skills into the system prompt
3. **Instruction Integration**: Add instruction files if configured
4. **Model Override**: Apply agent-specific model if defined
5. **Tool Configuration**: Apply tool enablement rules

This resolution happens in the OpenCode Server, which manages the full agent lifecycle.

## Skills Integration

### What are Skills?

Skills are reusable prompt components that can be referenced by multiple agents. They allow you to:

- Share common instructions across agents
- Modularize complex prompts
- Maintain consistency across agent behaviors
- Update shared logic in one place

### Skill File Structure

Skills are stored in `.opencode/skill/{skill-id}/SKILL.md`:

```
vault-root/
└── .opencode/
    └── skill/
        ├── markdown-formatting/
        │   └── SKILL.md
        └── technical-writing/
            └── SKILL.md
```

### Skill Format

```markdown
---
name: Markdown Formatting
description: Best practices for markdown formatting
---

When formatting markdown:
- Use ATX-style headers (# Header)
- Add blank lines around code blocks
- Use backticks for inline code
- Prefer lists over long paragraphs
```

### Referencing Skills

Reference skills in agent frontmatter:

```yaml
---
name: Documentation Writer
skills:
  - markdown-formatting
  - technical-writing
---
```

Skills are merged into the agent's system prompt in the order specified.

## Tool Configuration

### Available Tools

The plugin provides 6 core Obsidian tools:

1. **obsidian.search_vault** - Search notes (read-only)
2. **obsidian.read_note** - Read note content (read-only)
3. **obsidian.list_notes** - List notes in folder (read-only)
4. **obsidian.get_note_metadata** - Get frontmatter, tags, links (read-only)
5. **obsidian.create_note** - Create new note (scoped-write)
6. **obsidian.update_note** - Update with replace/append/prepend/insert modes (scoped-write)

### Tool Enablement

Control which tools an agent can access using the `tools` field:

```yaml
---
name: Read-Only Agent
tools:
  "*": false                      # Disable all tools by default
  obsidian.search_vault: true     # Enable specific tools
  obsidian.read_note: true
  obsidian.list_notes: true
---
```

### Tool Patterns

**Enable all tools** (default):
```yaml
tools:
  "*": true
```

**Disable all tools**:
```yaml
tools:
  "*": false
```

**Enable specific tools only**:
```yaml
tools:
  "*": false
  obsidian.read_note: true
  obsidian.search_vault: true
```

**Disable specific tools**:
```yaml
tools:
  "*": true
  obsidian.update_note: false
  obsidian.create_note: false
```

### Permission Levels

Tool execution is gated by permission levels configured in plugin settings:

- **read-only**: No approval needed for read operations
- **scoped-write**: Requires user approval for writes to specific paths
- **full-write**: Requires approval for any write operation

Agent tool configuration works in conjunction with these permission levels.

## Model Overrides

### Specifying Models

Agents can override the default model configuration:

```yaml
---
name: Fast Responder
model:
  providerID: anthropic
  modelID: claude-3-haiku-20240307
---
```

### Provider IDs

Common provider identifiers:
- `anthropic` - Anthropic (Claude models)
- `openai` - OpenAI (GPT models)
- Custom provider IDs from OpenCode Server configuration

### Model IDs

Examples of model identifiers:
- `claude-3-5-sonnet-20241022` - Claude 3.5 Sonnet
- `claude-3-opus-20240229` - Claude 3 Opus
- `claude-3-haiku-20240307` - Claude 3 Haiku
- `gpt-4` - GPT-4
- `gpt-3.5-turbo` - GPT-3.5 Turbo

## Agent Selection

### UI Selection

Agents can be selected in the plugin settings or during conversation:

1. Open plugin settings (Settings → OpenCode Obsidian)
2. Navigate to "Agent Configuration" section
3. Select from the dropdown of available agents
4. The selected agent becomes the default for new conversations

### Default Agent

The default agent is specified in settings:

```typescript
settings.agent = "docs"  // Agent ID
```

## Best Practices

### System Prompt Design

**Be Specific**: Clearly define the agent's role and responsibilities.

```markdown
You are a research assistant specialized in academic literature review.
```

**Provide Context**: Explain when and how the agent should be used.

```markdown
Use this agent when:
- Conducting literature reviews
- Summarizing research papers
- Identifying research gaps
```

**Set Boundaries**: Define what the agent should NOT do.

```markdown
Do not:
- Make up citations or references
- Provide medical advice
- Generate content outside your expertise
```

### Tool Configuration Best Practices

**Principle of Least Privilege**: Only enable tools the agent needs.

```yaml
# Research agent only needs read access
tools:
  "*": false
  obsidian.search_vault: true
  obsidian.read_note: true
  obsidian.get_note_metadata: true
```

**Write-Enabled Agents**: Be explicit about write permissions.

```yaml
# Documentation agent needs write access
tools:
  "*": false
  obsidian.read_note: true
  obsidian.create_note: true
  obsidian.update_note: true
```

### Skill Organization

**Modular Skills**: Keep skills focused on single concerns.

```
.opencode/skill/
├── markdown-formatting/SKILL.md    # Formatting rules
├── citation-style/SKILL.md         # Citation guidelines
└── code-review/SKILL.md            # Code review process
```

**Reusable Skills**: Design skills to be used across multiple agents.

### Naming Conventions

**Agent Files**: Use descriptive, lowercase names with hyphens.
- `docs-writer.md` ✓
- `research-assistant.md` ✓
- `DocsWriter.md` ✗

**Agent Names**: Use clear, descriptive display names.
- "Documentation Writer" ✓
- "Research Assistant" ✓
- "Agent 1" ✗

## Examples

### Example 1: Documentation Writer

```markdown
---
name: Documentation Writer
description: Specialized agent for creating and maintaining documentation
color: "#38A3EE"
model:
  providerID: anthropic
  modelID: claude-3-5-sonnet-20241022
tools:
  "*": false
  obsidian.read_note: true
  obsidian.search_vault: true
  obsidian.create_note: true
  obsidian.update_note: true
skills:
  - markdown-formatting
  - technical-writing
---

You are a documentation specialist focused on creating clear, comprehensive documentation.

Your responsibilities:
- Write clear, concise documentation
- Follow markdown best practices
- Maintain consistent formatting
- Include relevant examples
- Update existing documentation when needed

When writing documentation:
1. Start with a clear overview
2. Use proper heading hierarchy
3. Include code examples where appropriate
4. Add links to related documentation
5. Keep language simple and accessible
```

