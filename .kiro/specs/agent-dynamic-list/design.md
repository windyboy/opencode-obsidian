# Design: Agent Dynamic List

## Overview

Add dynamic agent loading from OpenCode Server to replace hardcoded agent list in settings.

## Architecture

### Components

1. **OpenCodeServerClient** (`src/opencode-server/client.ts`)
   - Add `listAgents()` method to fetch agents from server
   - Use existing SDK client: `sdkClient.app.agents()`

2. **Plugin Main** (`src/main.ts`)
   - Fetch agents on startup (non-blocking)
   - Store in settings on success, fallback to hardcoded on failure

3. **Settings Page** (`src/settings.ts`)
   - Add "Refresh agents" button
   - Update dropdown when agents change
   - Handle loading states

### Data Flow

```
Startup:
Plugin.onload() → OpenCodeClient.listAgents() → Store in settings
                                              ↓ (on error)
                                         Fallback to hardcoded

Manual Refresh:
User clicks button → OpenCodeClient.listAgents() → Update dropdown
                                                 ↓ (on error)
                                            Show error notice
```

## Implementation Details

### 1. OpenCodeServerClient.listAgents()

```typescript
/**
 * List available agents from server
 * @returns Array of agents with id, name, description
 * @throws Error if request fails
 */
async listAgents(): Promise<Agent[]> {
	try {
		const response = await this.sdkClient.app.agents();
		if (response.error || !response.data) {
			throw new Error(`Failed to list agents: ${response.error ?? "Unknown error"}`);
		}
		return response.data.map(agent => ({
			id: agent.id,
			name: agent.name,
			description: agent.description,
			// Map other fields as needed
		}));
	} catch (error) {
		this.errorHandler.handleError(
			error,
			{
				module: "OpenCodeClient",
				function: "listAgents",
				operation: "Listing agents",
			},
			ErrorSeverity.Warning,
		);
		throw error;
	}
}
```

### 2. Plugin Startup (main.ts)

```typescript
async onload() {
	// ... existing initialization ...
	
	// Load agents (non-blocking)
	this.loadAgents().catch(error => {
		console.warn("Failed to load agents from server, using defaults", error);
	});
}

private async loadAgents(): Promise<void> {
	try {
		if (!this.opencodeClient) {
			return; // No client configured yet
		}
		const agents = await this.opencodeClient.listAgents();
		this.settings.agents = agents;
		await this.saveSettings();
	} catch (error) {
		// Fallback to hardcoded agents
		this.settings.agents = this.getDefaultAgents();
		this.errorHandler.handleError(
			error,
			{ module: "Plugin", function: "loadAgents" },
			ErrorSeverity.Warning,
		);
	}
}

private getDefaultAgents(): Agent[] {
	return [
		{ id: "assistant", name: "Assistant" },
		{ id: "bootstrap", name: "Bootstrap" },
		{ id: "thinking-partner", name: "Thinking Partner" },
		{ id: "research-assistant", name: "Research Assistant" },
		{ id: "read-only", name: "Read Only" },
	];
}
```

### 3. Settings Page Refresh (settings.ts)

Add refresh button in `renderAgentConfiguration()`:

```typescript
private renderAgentConfiguration(containerEl: HTMLElement): void {
	// ... existing code ...
	
	// Add refresh button
	agentSetting.addButton((button) => {
		button
			.setButtonText("Refresh agents")
			.setTooltip("Fetch latest agents from server")
			.onClick(async () => {
				button.setDisabled(true);
				button.setButtonText("Refreshing...");
				
				try {
					const agents = await this.plugin.opencodeClient?.listAgents();
					if (agents) {
						this.plugin.settings.agents = agents;
						await this.plugin.saveSettings();
						this.display(); // Re-render settings
						new Notice("Agents refreshed successfully");
					}
				} catch (error) {
					const errorMessage = error instanceof Error 
						? error.message 
						: "Unknown error";
					new Notice(`Failed to refresh agents: ${errorMessage}`);
				} finally {
					button.setDisabled(false);
					button.setButtonText("Refresh agents");
				}
			});
	});
}
```

## Error Handling

### Scenarios

1. **Server unavailable on startup**
   - Log warning
   - Use hardcoded agents
   - Plugin continues normally

2. **Manual refresh fails**
   - Show error notice to user
   - Keep existing agent list
   - Re-enable button

3. **Invalid response from server**
   - Throw error with context
   - ErrorHandler logs details
   - Fallback to defaults

### Error Messages

- Startup failure: Console warning only (non-intrusive)
- Manual refresh failure: Notice with clear message
- All errors logged via ErrorHandler

## Testing Strategy

### Unit Tests

1. **OpenCodeServerClient.listAgents()**
   - Mock SDK response success
   - Mock SDK response error
   - Verify error handling

2. **Plugin.loadAgents()**
   - Mock successful fetch
   - Mock failed fetch (verify fallback)
   - Verify non-blocking behavior

3. **Settings refresh button**
   - Mock successful refresh
   - Mock failed refresh
   - Verify button state changes

### Manual Testing

1. Start plugin with server running → agents loaded
2. Start plugin with server down → defaults used
3. Click refresh with server running → agents updated
4. Click refresh with server down → error shown

## Migration

No migration needed - backward compatible:
- Existing hardcoded agents remain as fallback
- Settings structure unchanged
- No breaking changes to API

## Future Enhancements

- Cache agents with TTL
- Agent metadata (skills, tools, models)
- Agent filtering/search in settings
