/**
 * MCP Server configuration
 */
export interface MCPServer {
  name: string
  enabled: boolean
  command: string // Command to start the server
  args?: string[] // Command arguments
  env?: Record<string, string> // Environment variables
  transport?: 'stdio' | 'sse' | 'websocket' // Transport type (default: stdio)
  config?: Record<string, unknown> // Server-specific configuration
}

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: string
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
  serverName?: string // Which server provides this tool
}

/**
 * MCP Resource definition
 */
export interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
  serverName?: string // Which server provides this resource
}

/**
 * MCP Client configuration
 */
export interface MCPClientConfig {
  servers?: MCPServer[]
  protocolVersion?: string // MCP protocol version (default: "2024-11-05")
  clientInfo?: {
    name: string
    version: string
  }
}

/**
 * JSON-RPC 2.0 Request
 */
export interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: unknown
}

/**
 * JSON-RPC 2.0 Response
 */
export interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

/**
 * JSON-RPC 2.0 Notification (no id field)
 */
export interface JSONRPCNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

/**
 * MCP Initialize Request
 */
export interface MCPInitializeRequest {
  protocolVersion: string
  capabilities: {
    roots?: {
      listChanged?: boolean
    }
    sampling?: unknown
  }
  clientInfo: {
    name: string
    version: string
  }
}

/**
 * MCP Initialize Response
 */
export interface MCPInitializeResponse {
  protocolVersion: string
  capabilities: {
    roots?: {
      listChanged?: boolean
    }
    sampling?: unknown
    tools?: unknown
    resources?: unknown
  }
  serverInfo: {
    name: string
    version: string
  }
}

/**
 * MCP Tool List Item
 */
export interface MCPToolListItem {
  name: string
  description: string
  inputSchema: {
    type: string
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
}

/**
 * MCP Resource List Item
 */
export interface MCPResourceListItem {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

/**
 * MCP Tool Call Arguments
 */
export interface MCPToolCallArguments {
  name: string
  arguments?: Record<string, unknown>
}

/**
 * MCP Tool Call Result
 */
export interface MCPToolCallResult {
  content: Array<{
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string // base64 encoded
    mimeType?: string
    uri?: string
  }>
  isError?: boolean
}

/**
 * MCP Server Connection State
 */
export enum MCPServerState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Initializing = 'initializing',
  Connected = 'connected',
  Error = 'error',
}
