# Embedded OpenCode Server Implementation Plan

## 1. Project Background

### 1.1 Current Situation Analysis

The current OpenCode Obsidian plugin uses a client-server architecture, requiring users to manually start an external OpenCode server. This approach has several pain points:

- **Poor user experience**: Users need extra steps to install and start the OpenCode CLI
- **Complex configuration**: Users need to manually configure server URL and port
- **High entry barrier**: Not user-friendly for non-technical users
- **Limited integration**: External servers cannot directly perceive the Obsidian workspace environment

### 1.2 Problem Statement

How to provide a more convenient way for users to use OpenCode features without affecting existing functionality?

### 1.3 Project Objectives

- Implement a self-starting embedded OpenCode server within the plugin
- Maintain compatibility with the existing external server architecture
- Improve user experience and reduce entry barriers
- Ensure the solution is feasible, simple, and maintainable

## 2. Functional Requirements

### 2.1 Core Functions

| Function Point | Description | Priority |
|----------------|-------------|----------|
| Embedded server auto-start | Automatically start the OpenCode server when the plugin loads | P0 |
| Server lifecycle management | Automatically handle server start, stop, and restart | P0 |
| Configuration options | Provide configuration interface for the embedded server | P1 |
| Compatibility support | Maintain compatibility with external servers | P0 |
| Error handling | Gracefully handle server startup and runtime errors | P0 |

### 2.2 Non-Functional Requirements

| Requirement | Description |
|-------------|-------------|
| Performance | Server startup time < 15 seconds |
| Resource consumption | Memory usage < 200MB, CPU usage < 20% |
| Maintainability | Modular code for easy maintenance and extension |
| Security | Configure appropriate security measures to prevent unauthorized access |

## 3. Technical Architecture

### 3.1 System Architecture Diagram

```
┌────────────────────────────────────────────────────────────┐
│                        Obsidian App                        │
├────────────────────────────────────────────────────────────┤
│                  OpenCode Obsidian Plugin                  │
├─────────────────────────┬──────────────────────────────────┤
│   ServerManager (new)   │  Existing Plugin Components      │
├─────────────────────────┼──────────────────────────────────┤
│ ┌─────────────────────┐ │ ┌──────────────────────────────┐ │
│ │  Process Management │ │ │     OpenCodeServerClient     │ │
│ └─────────────────────┘ │ └──────────────────────────────┘ │
│ ┌─────────────────────┐ │ ┌──────────────────────────────┐ │
│ │   Health Checking   │ │ │      ConnectionManager       │ │
│ └─────────────────────┘ │ └──────────────────────────────┘ │
│ ┌─────────────────────┐ │ ┌──────────────────────────────┐ │
│ │     Error Handling  │ │ │      SessionEventBus         │ │
│ └─────────────────────┘ │ └──────────────────────────────┘ │
└─────────────────────────┴──────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────┐
│                  OpenCode Server Process                   │
│ (spawned by ServerManager, either embedded or external)    │
└────────────────────────────────────────────────────────────┘
```

### 3.2 Core Component Responsibilities

#### 3.2.1 ServerManager

- **Responsibility**: Manage the lifecycle of the embedded OpenCode server
- **Core Functions**:
  - Start and stop server processes
  - Monitor server health status
  - Handle errors and recovery
  - Manage configuration

#### 3.2.2 Integration with Existing Components

- **OpenCodeServerClient**: Communicate with the embedded server
- **ConnectionManager**: Manage connection states
- **SessionEventBus**: Handle server events

### 3.3 Technology Stack

| Technology/Framework | Purpose | Version |
|----------------------|---------|---------|
| TypeScript           | Main development language | 5.8+ |
| Node.js              | Runtime environment | 16+ |
| Obsidian API         | Plugin development | Latest |
| @opencode-ai/sdk     | OpenCode SDK | Latest |
| Child Process        | Process management | Node.js built-in |

## 4. Implementation Plan

### 4.1 Core Implementation Steps

#### 4.1.1 Type Definition Extension

Extend the `OpenCodeServerConfig` interface in `src/types.ts`:

```typescript
export interface OpenCodeObsidianSettings {
  // Existing configuration...
  opencodeServer?: {
    url: string;
    useEmbeddedServer?: boolean;
    opencodePath?: string;
    embeddedServerPort?: number;
    // Existing configuration...
  };
}
```

#### 4.1.2 ServerManager Implementation

Create `src/server/ServerManager.ts`:

```typescript
export class ServerManager {
  private process: ChildProcess | null = null;
  private state: ServerState = "stopped";
  private lastError: string | null = null;
  
  constructor(config: ServerManagerConfig, errorHandler: ErrorHandler, onStateChange: (state: ServerState) => void) {
    // Initialization...
  }
  
  async start(): Promise<boolean> {
    // Server startup logic...
  }
  
  stop(): void {
    // Server shutdown logic...
  }
  
  private async checkServerHealth(): Promise<boolean> {
    // Health check logic...
  }
}
```

#### 4.1.3 Plugin Integration

Integrate ServerManager in `src/main.ts`:

```typescript
export default class OpenCodeObsidianPlugin extends Plugin {
  private serverManager: ServerManager | null = null;
  
  async onload() {
    // Existing initialization...
    if (this.settings.opencodeServer?.useEmbeddedServer) {
      await this.initializeEmbeddedServer();
    } else if (this.settings.opencodeServer?.url) {
      await this.initializeExternalServer();
    }
  }
  
  private async initializeEmbeddedServer(): Promise<void> {
    // Embedded server initialization logic...
  }
  
  private async initializeExternalServer(): Promise<void> {
    // External server initialization logic...
  }
}
```

#### 4.1.4 Settings Interface

Add embedded server configuration options in `src/settings.ts`:

```typescript
new Setting(containerEl)
  .setName("Use embedded server")
  .setDesc("Start an embedded OpenCode Server automatically")
  .addToggle((toggle) => {
    toggle
      .setValue(this.plugin.settings.opencodeServer?.useEmbeddedServer || false)
      .onChange(async (value) => {
        // Configuration update logic...
      });
  });
```

### 4.2 Key Algorithms and Processes

#### 4.2.1 Server Startup Process

```
start()
├── Check server status
├── If already running or starting, return
├── Set state to "starting"
├── Check if server is already running on the specified port
├── If not running, start OpenCode CLI using spawn
├── Configure CORS and other parameters
├── Wait for server startup (maximum 15 seconds)
├── Perform health check
├── If health check passes, set state to "running"
├── Otherwise, stop server and set error state
└── Return startup result
```

#### 4.2.2 Health Check Algorithm

```
checkServerHealth()
├── Send GET request to /health endpoint
├── Set 2-second timeout
├── If response status code is 200, return true
├── Otherwise, return false
```

### 4.3 Configuration Management

| Configuration Item | Type | Default Value | Description |
|--------------------|------|---------------|-------------|
| useEmbeddedServer  | boolean | false | Whether to enable the embedded server |
| opencodePath       | string | "opencode" | Path to the OpenCode CLI executable |
| embeddedServerPort | number | 4096 | Embedded server port |
| startupTimeout     | number | 15000 | Server startup timeout in milliseconds |

## 5. Development Plan

### 5.1 Development Phase Division

| Phase | Duration | Tasks |
|-------|----------|-------|
| Phase 1 | 1 day | Requirements analysis and documentation |
| Phase 2 | 2 days | Core component development (ServerManager) |
| Phase 3 | 1 day | Plugin integration and configuration management |
| Phase 4 | 1 day | Settings interface development |
| Phase 5 | 1 day | Testing and debugging |
| Phase 6 | 0.5 days | Documentation improvement and review |

### 5.2 Milestones

| Milestone | Completion Criteria |
|-----------|---------------------|
| Core component completion | ServerManager class implemented and passing unit tests |
| Plugin integration completion | Embedded server automatically starts and stops with the plugin |
| Interface completion | Settings interface can properly configure the embedded server |
| Function verification | Embedded server can normally provide OpenCode functionality |
| Documentation completion | Project documentation is complete and reviewed |

## 6. Testing Plan

### 6.1 Unit Testing

- Core method testing of the ServerManager class
- Health check algorithm testing
- Error handling logic testing

### 6.2 Integration Testing

- Integration testing between the plugin and embedded server
- Real-time configuration update testing
- Server lifecycle management testing

### 6.3 Functional Testing

- Embedded server auto-start function
- External server compatibility testing
- Error scenario handling testing

### 6.4 Performance Testing

- Server startup time testing
- Memory and CPU usage testing

## 7. Risk Assessment and Mitigation Strategies

| Risk | Impact | Mitigation Strategy |
|------|--------|---------------------|
| OpenCode CLI not installed | Embedded server cannot start | Provide clear error messages and guide users to install |
| Port conflict | Server startup failure | Implement port auto-detection and selection functionality |
| High resource consumption | Affects Obsidian performance | Optimize server configuration and limit resource usage |
| Startup timeout | Poor user experience | Provide timeout prompts and allow manual retry |

## 8. Documentation Review

### 8.1 Feasibility Assessment

- **Technical feasibility**: Based on Node.js Child Process API and existing OpenCode CLI, the technical solution is feasible
- **Resource constraints**: Implementation workload is approximately 5.5 person-days, suitable for personal small plugin projects
- **Dependency situation**: Mainly depends on OpenCode CLI, which users need to install themselves

### 8.2 Simplicity Assessment

- **Code complexity**: Uses modular design with clear and simple core logic
- **Configuration complexity**: Users only need to toggle a switch and select a port, making configuration simple
- **Maintenance cost**: Clear code structure for easy subsequent maintenance and extension

### 8.3 Maintainability Assessment

- **Code structure**: Follows the single responsibility principle with reasonable module division
- **Error handling**: Perfect error handling mechanism for easy problem location
- **Logging**: Detailed logging for easy debugging and monitoring

### 8.4 Completeness Assessment

- **Function coverage**: Covers the core functions of the embedded server
- **Documentation content**: Includes all aspects of the project with complete content
- **Testing plan**: Testing covers main functions and scenarios

### 8.5 Logical Coherence Assessment

- **Architecture design**: Clear architecture with explicit component relationships
- **Implementation process**: Reasonable process design with coherent logic
- **Documentation structure**: Clear structure with natural transitions between sections

### 8.6 Technical Rationality Assessment

- **Technology selection**: Reasonable technology stack selection that conforms to Obsidian plugin development specifications
- **Algorithm design**: Reasonable design of health check and startup processes
- **Security considerations**: Appropriate CORS policies configured to ensure secure access

## 9. Conclusion and Recommendations

### 9.1 Conclusion

This solution is a feasible, simple, and maintainable implementation plan for an embedded OpenCode server, which meets the development requirements and resource constraints of personal small plugin projects. The solution maintains compatibility with the existing external server architecture while providing a more convenient user experience.

### 9.2 Recommendations

1. **Phased implementation**: Implement according to the development plan in phases to ensure quality at each stage
2. **Adequate testing**: Test in different environments to ensure compatibility and stability
3. **User guidance**: Provide clear user guidance and error messages
4. **Documentation improvement**: Continuously improve project documentation for subsequent maintenance
5. **Performance optimization**: Further optimize performance on the premise of ensuring functionality

### 9.3 Future Outlook

- Implement port auto-detection and selection functionality
- Provide server status monitoring interface
- Support advanced server configuration options
- Implement server log viewing functionality

---

**Document Version**: 1.0
**Document Date**: 2026-01-18
**Document Author**: [Your Name]
**Review Status**: Draft completed, pending review