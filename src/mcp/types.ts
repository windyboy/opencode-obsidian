export interface MCPServer {
  name: string
  enabled: boolean
  config: Record<string, unknown>
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: string
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
}

export interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface MCPClientConfig {
  servers?: MCPServer[]
}
