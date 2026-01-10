import type {
  MCPServer,
  MCPTool,
  MCPResource,
  MCPClientConfig,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
  MCPInitializeRequest,
  MCPInitializeResponse,
  MCPToolListItem,
  MCPResourceListItem,
  MCPToolCallArguments,
  MCPToolCallResult,
  MCPServerState,
} from './types'
import { MCPServerState as ServerState } from './types'
// eslint-disable-next-line import/no-nodejs-modules
import { spawn, type ChildProcess } from 'node:child_process'
// eslint-disable-next-line import/no-nodejs-modules
import { Buffer } from 'node:buffer'
// eslint-disable-next-line import/no-nodejs-modules
import * as process from 'node:process'

/**
 * MCP Manager - manages Model Context Protocol servers
 * 
 * Implements MCP client following JSON-RPC 2.0 protocol
 * Supports stdio transport for server communication
 */
export class MCPManager {
  private config: Required<Omit<MCPClientConfig, 'servers'>> & { servers?: MCPServer[] }
  private servers: Map<string, MCPServer> = new Map()
  private tools: Map<string, MCPTool> = new Map()
  private resources: Map<string, MCPResource> = new Map()
  private serverProcesses: Map<string, ChildProcess> = new Map()
  private serverStates: Map<string, MCPServerState> = new Map()
  private requestIdCounter: number = 0
  private pendingRequests: Map<string | number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }> = new Map()
  private protocolVersion: string = '2024-11-05'
  private isInitialized: boolean = false

  constructor(config: MCPClientConfig = {}) {
    this.config = {
      servers: config.servers || [],
      protocolVersion: config.protocolVersion || this.protocolVersion,
      clientInfo: config.clientInfo || {
        name: 'opencode-obsidian',
        version: '0.13.1',
      },
    }

    // Initialize servers from config
    if (this.config.servers) {
      for (const server of this.config.servers) {
        if (server.enabled) {
          this.servers.set(server.name, server)
          this.serverStates.set(server.name, ServerState.Disconnected)
        }
      }
    }
  }

  /**
   * Initialize all enabled MCP servers
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    const enabledServers = Array.from(this.servers.values()).filter(s => s.enabled)
    
    // Initialize each server
    const initPromises = enabledServers.map(server => this.initializeServer(server))
    await Promise.allSettled(initPromises)

    // List tools and resources from all servers
    await this.refreshToolsAndResources()

    this.isInitialized = true
  }

  /**
   * Initialize a single MCP server
   */
  private async initializeServer(server: MCPServer): Promise<void> {
    try {
      this.serverStates.set(server.name, ServerState.Connecting)

      // Start server process (stdio transport)
      const transport = server.transport || 'stdio'
      if (transport !== 'stdio') {
        console.warn(`[MCPManager] Transport ${transport} not yet implemented, only stdio is supported`)
        this.serverStates.set(server.name, ServerState.Error)
        return
      }

      const args = server.args || []
      const env = {
        ...process.env,
        ...server.env,
      }

      const serverProcess = spawn(server.command, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
      })

      this.serverProcesses.set(server.name, serverProcess)
      this.serverStates.set(server.name, ServerState.Initializing)

      // Handle stdout (server messages)
      let buffer = ''
      serverProcess.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            try {
              const message = JSON.parse(line) as JSONRPCResponse | JSONRPCNotification
              this.handleServerMessage(server.name, message)
            } catch (error) {
              console.error(`[MCPManager] Failed to parse server message from ${server.name}:`, error)
            }
          }
        }
      })

      // Handle stderr (server logs)
      serverProcess.stderr?.on('data', (data: Buffer) => {
        console.debug(`[MCPManager] Server ${server.name} stderr:`, data.toString())
      })

      // Handle process exit
      serverProcess.on('exit', (code) => {
        console.warn(`[MCPManager] Server ${server.name} exited with code ${code}`)
        this.serverStates.set(server.name, ServerState.Disconnected)
        this.serverProcesses.delete(server.name)
      })

      // Handle process errors
      serverProcess.on('error', (error) => {
        console.error(`[MCPManager] Server ${server.name} process error:`, error)
        this.serverStates.set(server.name, ServerState.Error)
        this.serverProcesses.delete(server.name)
      })

      // Send initialize request
      const initRequest: MCPInitializeRequest = {
        protocolVersion: this.config.protocolVersion,
        capabilities: {
          roots: {
            listChanged: true,
          },
        },
        clientInfo: this.config.clientInfo,
      }

      const response = await this.sendRequest(server.name, 'initialize', initRequest) as MCPInitializeResponse

      if (response && response.protocolVersion && response.serverInfo) {
        console.debug(`[MCPManager] Server ${server.name} initialized:`, response.serverInfo)
        
        // Send initialized notification
        await this.sendNotification(server.name, 'initialized', {})
        
        this.serverStates.set(server.name, ServerState.Connected)
      } else {
        throw new Error('Invalid initialize response')
      }
    } catch (error) {
      console.error(`[MCPManager] Failed to initialize server ${server.name}:`, error)
      this.serverStates.set(server.name, ServerState.Error)
      throw error
    }
  }

  /**
   * Handle incoming message from server
   */
  private handleServerMessage(serverName: string, message: JSONRPCResponse | JSONRPCNotification): void {
    if ('id' in message && message.id !== null && message.id !== undefined) {
      // Response to a request
      const requestId = message.id
      const pending = this.pendingRequests.get(requestId)
      if (pending) {
        this.pendingRequests.delete(requestId)
        if ('error' in message && message.error) {
          pending.reject(new Error(`MCP Error: ${message.error.message}`))
        } else {
          pending.resolve(message.result)
        }
      }
    } else {
      // Notification (no id)
      this.handleNotification(serverName, message as JSONRPCNotification)
    }
  }

  /**
   * Handle notification from server
   */
  private handleNotification(serverName: string, notification: JSONRPCNotification): void {
    // Handle server notifications (e.g., roots/list_changed)
    console.debug(`[MCPManager] Received notification from ${serverName}:`, notification.method)
    
    if (notification.method === 'roots/list_changed') {
      // Refresh tools and resources when roots change
      this.refreshToolsAndResources().catch(error => {
        console.error(`[MCPManager] Failed to refresh tools and resources:`, error)
      })
    }
  }

  /**
   * Send JSON-RPC request to server
   */
  private async sendRequest(serverName: string, method: string, params?: unknown): Promise<unknown> {
    const serverProcess = this.serverProcesses.get(serverName)
    if (!serverProcess || !serverProcess.stdin) {
      throw new Error(`Server ${serverName} is not connected`)
    }

    const requestId = ++this.requestIdCounter
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params,
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject })

      // Send request to server
      const message = JSON.stringify(request) + '\n'
      serverProcess.stdin?.write(message, (error) => {
        if (error) {
          this.pendingRequests.delete(requestId)
          reject(error)
        }
      })

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new Error(`Request timeout for ${method}`))
        }
      }, 30000)
    })
  }

  /**
   * Send JSON-RPC notification to server (no response expected)
   */
  private async sendNotification(serverName: string, method: string, params?: unknown): Promise<void> {
    const serverProcess = this.serverProcesses.get(serverName)
    if (!serverProcess || !serverProcess.stdin) {
      throw new Error(`Server ${serverName} is not connected`)
    }

    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    }

    const message = JSON.stringify(notification) + '\n'
    return new Promise((resolve, reject) => {
      serverProcess.stdin?.write(message, (error) => {
        if (error) {
          console.error(`[MCPManager] Failed to send notification to ${serverName}:`, error)
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  /**
   * Refresh tools and resources from all connected servers
   */
  private async refreshToolsAndResources(): Promise<void> {
    for (const [serverName, state] of this.serverStates.entries()) {
      if (state === ServerState.Connected) {
        try {
          // List tools
          const toolsResponse = await this.sendRequest(serverName, 'tools/list', {}) as { tools: MCPToolListItem[] }
          if (toolsResponse && toolsResponse.tools) {
            for (const tool of toolsResponse.tools) {
              this.tools.set(tool.name, {
                ...tool,
                serverName,
              })
            }
          }

          // List resources
          const resourcesResponse = await this.sendRequest(serverName, 'resources/list', {}) as { resources: MCPResourceListItem[] }
          if (resourcesResponse && resourcesResponse.resources) {
            for (const resource of resourcesResponse.resources) {
              this.resources.set(resource.uri, {
                ...resource,
                serverName,
              })
            }
          }
        } catch (error) {
          console.error(`[MCPManager] Failed to refresh tools/resources from ${serverName}:`, error)
        }
      }
    }
  }


  /**
   * Get all available tools
   */
  getAvailableTools(): MCPTool[] {
    return Array.from(this.tools.values())
  }

  /**
   * Get tool by name
   */
  getTool(name: string): MCPTool | null {
    return this.tools.get(name) || null
  }

  /**
   * Call an MCP tool
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      throw new Error(`MCP tool not found: ${name}`)
    }

    if (!tool.serverName) {
      throw new Error(`Tool ${name} has no associated server`)
    }

    // Check if server is connected
    const serverState = this.serverStates.get(tool.serverName)
    if (serverState !== ServerState.Connected) {
      throw new Error(`Server ${tool.serverName} is not connected (state: ${serverState})`)
    }

    // Send tools/call request
    const callArgs: MCPToolCallArguments = {
      name,
      arguments: args,
    }

    try {
      const response = await this.sendRequest(tool.serverName, 'tools/call', callArgs) as MCPToolCallResult
      return response
    } catch (error) {
      console.error(`[MCPManager] Failed to call tool ${name}:`, error)
      throw error
    }
  }

  /**
   * List all resources from all connected servers
   */
  async listResources(): Promise<MCPResource[]> {
    await this.refreshToolsAndResources()
    return Array.from(this.resources.values())
  }

  /**
   * Get resource content by URI
   */
  async getResource(uri: string): Promise<string | null> {
    const resource = this.resources.get(uri)
    if (!resource) {
      throw new Error(`Resource not found: ${uri}`)
    }

    if (!resource.serverName) {
      throw new Error(`Resource ${uri} has no associated server`)
    }

    // Check if server is connected
    const serverState = this.serverStates.get(resource.serverName)
    if (serverState !== ServerState.Connected) {
      throw new Error(`Server ${resource.serverName} is not connected (state: ${serverState})`)
    }

    // Send resources/read request
    try {
      const response = await this.sendRequest(resource.serverName, 'resources/read', { uri }) as {
        contents?: Array<{
          uri: string
          mimeType?: string
          text?: string
          blob?: string // base64 encoded
        }>
      }

      if (response && response.contents && response.contents.length > 0) {
        const content = response.contents[0]
        if (content && content.text) {
          return content.text
        } else if (content && content.blob) {
          // Decode base64 blob
          return Buffer.from(content.blob, 'base64').toString('utf-8')
        }
      }

      return null
    } catch (error) {
      console.error(`[MCPManager] Failed to read resource ${uri}:`, error)
      throw error
    }
  }

  /**
   * Register a new MCP server
   */
  registerServer(server: MCPServer): void {
    this.servers.set(server.name, server)
    if (server.enabled && this.isInitialized) {
      // Reinitialize to pick up new server
      this.isInitialized = false
      this.initialize().catch(error => {
        console.error(`[MCPManager] Failed to initialize server ${server.name}:`, error)
      })
    }
  }

  /**
   * Unregister an MCP server
   */
  unregisterServer(name: string): void {
    this.servers.delete(name)
  }

  /**
   * Get all registered servers
   */
  getServers(): MCPServer[] {
    return Array.from(this.servers.values())
  }

  /**
   * Shutdown all MCP connections
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return
    }

    // Send shutdown notification to all connected servers
    const shutdownPromises: Promise<void>[] = []
    for (const [serverName, state] of this.serverStates.entries()) {
      if (state === ServerState.Connected || state === ServerState.Initializing) {
        const shutdownPromise = this.sendNotification(serverName, 'notifications/shutdown', {})
          .catch(error => {
            console.error(`[MCPManager] Failed to send shutdown notification to ${serverName}:`, error)
          })
        shutdownPromises.push(shutdownPromise)
      }
    }

    await Promise.allSettled(shutdownPromises)

    // Close all server processes
    for (const [serverName, serverProcess] of this.serverProcesses.entries()) {
      try {
        if (serverProcess.stdin) {
          serverProcess.stdin.end()
        }
        serverProcess.kill('SIGTERM')
        
        // Force kill after timeout if still running
        setTimeout(() => {
          if (!serverProcess.killed) {
            serverProcess.kill('SIGKILL')
          }
        }, 5000)
      } catch (error) {
        console.error(`[MCPManager] Failed to shutdown server ${serverName}:`, error)
      }
    }

    // Clear all state
    this.serverProcesses.clear()
    this.serverStates.clear()
    this.tools.clear()
    this.resources.clear()
    this.pendingRequests.clear()
    this.isInitialized = false

    console.debug('[MCPManager] All MCP connections closed')
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize()
    }
  }
}
