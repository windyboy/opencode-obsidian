/**
 * WebSocket protocol for communication between Obsidian plugin and OpenCode Server
 * Based on the architecture: Obsidian plugin (client) <-> OpenCode Server (runtime)
 */

/**
 * Base message structure
 */
interface BaseMessage {
  /** Message type identifier */
  type: string
  /** Unique message ID (correlation ID) */
  id?: string
  /** Timestamp when message was created (milliseconds since epoch) */
  timestamp?: number
  /** Message payload (type-specific) */
  payload: unknown
}

/**
 * Client -> Server Messages
 */

/**
 * Client: Start a new session
 */
export interface ClientSessionStartMessage extends BaseMessage {
  type: 'session.start'
  payload: {
    /** Optional context information (current note, selection, etc.) */
    context?: {
      /** Current note path */
      currentNote?: string
      /** Selected text */
      selection?: string
      /** Link relationships */
      links?: string[]
      /** Tags */
      tags?: string[]
      /** Frontmatter properties */
      properties?: Record<string, unknown>
    }
    /** Optional agent ID to use */
    agentId?: string
    /** Optional session ID from Obsidian side (for mapping) */
    obsidianSessionId?: string
  }
}

/**
 * Client: Send a message to an existing session
 */
export interface ClientSessionMessageMessage extends BaseMessage {
  type: 'session.message'
  payload: {
    /** Session ID (returned from session.created) */
    sessionId: string
    /** User message content */
    message: string
    /** Optional image attachments */
    images?: Array<{
      data: string  // Base64-encoded
      mimeType: string
      name?: string
    }>
  }
}

/**
 * Client: Send tool execution result back to server
 */
export interface ClientToolResultMessage extends BaseMessage {
  type: 'tool.result'
  payload: {
    /** Session ID */
    sessionId: string
    /** Tool call ID (correlation ID from tool.call) */
    callId: string
    /** Tool execution result */
    result?: unknown
    /** Error information if execution failed */
    error?: {
      message: string
      code?: string
      details?: unknown
    }
    /** Optional audit log entry */
    auditLog?: {
      approved: boolean
      dryRun: boolean
      duration: number
    }
  }
}

/**
 * Client: Send permission response (approval/rejection)
 */
export interface ClientPermissionResponseMessage extends BaseMessage {
  type: 'permission.response'
  payload: {
    /** Session ID */
    sessionId: string
    /** Permission request call ID */
    callId: string
    /** Whether permission was granted */
    allowed: boolean
    /** Optional reason for rejection */
    reason?: string
    /** Whether this approval is for this session only (not persistent) */
    sessionOnly?: boolean
  }
}

/**
 * Client: Interrupt/stop a session
 */
export interface ClientSessionInterruptMessage extends BaseMessage {
  type: 'session.interrupt'
  payload: {
    /** Session ID to interrupt */
    sessionId: string
  }
}

/**
 * Server -> Client Messages
 */

/**
 * Server: Session created notification
 */
export interface ServerSessionCreatedMessage extends BaseMessage {
  type: 'session.created'
  payload: {
    /** Session ID (use this for subsequent messages) */
    sessionId: string
    /** Optional agent ID that was selected */
    agentId?: string
  }
}

/**
 * Server: Stream a token (for streaming responses)
 */
export interface ServerStreamTokenMessage extends BaseMessage {
  type: 'stream.token'
  payload: {
    /** Session ID */
    sessionId: string
    /** Token content */
    token: string
    /** Whether this is the last token */
    done?: boolean
  }
}

/**
 * Server: Stream thinking/analysis content
 */
export interface ServerStreamThinkingMessage extends BaseMessage {
  type: 'stream.thinking'
  payload: {
    /** Session ID */
    sessionId: string
    /** Thinking content */
    content: string
  }
}

/**
 * Server: Request tool execution
 */
export interface ServerToolCallMessage extends BaseMessage {
  type: 'tool.call'
  payload: {
    /** Session ID */
    sessionId: string
    /** Tool call ID (correlation ID - include this in tool.result response) */
    callId: string
    /** Tool name/identifier */
    toolName: string
    /** Tool arguments (validated against tool schema) */
    args: unknown
  }
}

/**
 * Server: Request permission for a tool call
 */
export interface ServerPermissionRequestMessage extends BaseMessage {
  type: 'permission.request'
  payload: {
    /** Session ID */
    sessionId: string
    /** Permission request call ID (include this in permission.response) */
    callId: string
    /** Tool name */
    toolName: string
    /** Tool arguments */
    args: unknown
    /** Optional preview (for write operations like update_note) */
    preview?: {
      /** Original content (optional, only for replace mode) */
      originalContent?: string
      /** New content after operation */
      newContent: string
      /** Update mode (for update_note tool) */
      mode?: string
      /** Statistics */
      addedLines?: number
      removedLines?: number
    }
  }
}

/**
 * Server: Progress update
 */
export interface ServerProgressUpdateMessage extends BaseMessage {
  type: 'progress.update'
  payload: {
    /** Session ID */
    sessionId: string
    /** Progress message */
    message: string
    /** Progress stage/phase */
    stage?: string
    /** Progress percentage (0-100) */
    progress?: number
  }
}

/**
 * Server: Error notification
 */
export interface ServerErrorMessage extends BaseMessage {
  type: 'error'
  payload: {
    /** Session ID (if error is session-specific) */
    sessionId?: string
    /** Error message */
    message: string
    /** Error code */
    code?: string
    /** Error details */
    details?: unknown
  }
}

/**
 * Server: Session ended notification
 */
export interface ServerSessionEndMessage extends BaseMessage {
  type: 'session.end'
  payload: {
    /** Session ID */
    sessionId: string
    /** Reason for ending */
    reason: 'completed' | 'interrupted' | 'error' | 'timeout'
    /** Optional error message */
    error?: string
  }
}

/**
 * Union type for all client messages
 */
export type ClientMessage =
  | ClientSessionStartMessage
  | ClientSessionMessageMessage
  | ClientToolResultMessage
  | ClientPermissionResponseMessage
  | ClientSessionInterruptMessage

/**
 * Union type for all server messages
 */
export type ServerMessage =
  | ServerSessionCreatedMessage
  | ServerStreamTokenMessage
  | ServerStreamThinkingMessage
  | ServerToolCallMessage
  | ServerPermissionRequestMessage
  | ServerProgressUpdateMessage
  | ServerErrorMessage
  | ServerSessionEndMessage

/**
 * Union type for all messages (client or server)
 */
export type ProtocolMessage = ClientMessage | ServerMessage

/**
 * Message serialization/deserialization utilities
 */
export class ProtocolMessageSerializer {
  /**
   * Generate a unique ID with the given prefix
   */
  private static generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
  }

  /**
   * Serialize a message to JSON string
   */
  static serialize(message: ProtocolMessage): string {
    const messageWithMetadata: ProtocolMessage = {
      ...message,
      id: message.id || this.generateMessageId(),
      timestamp: message.timestamp || Date.now()
    }
    return JSON.stringify(messageWithMetadata)
  }

  /**
   * Deserialize a JSON string to a message
   */
  static deserialize(data: string): ProtocolMessage {
    try {
      const parsed = JSON.parse(data) as ProtocolMessage
      return parsed
    } catch (error) {
      throw new Error(`Failed to deserialize message: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Generate a unique message ID
   */
  static generateMessageId(): string {
    return this.generateId('msg')
  }

  /**
   * Generate a unique call ID for tool calls
   */
  static generateCallId(): string {
    return this.generateId('call')
  }

  /**
   * Generate a unique session ID
   */
  static generateSessionId(): string {
    return this.generateId('session')
  }
}

/**
 * Message type sets for type-safe comparisons
 */
const CLIENT_MESSAGE_TYPES = new Set(['session.start', 'session.message', 'tool.result', 'permission.response', 'session.interrupt'])
const SERVER_MESSAGE_TYPES = new Set(['session.created', 'stream.token', 'stream.thinking', 'tool.call', 'permission.request', 'progress.update', 'error', 'session.end'])

/**
 * Type guards for message types
 */
export const ProtocolMessageTypeGuard = {
  /** Check if message is a client message */
  isClientMessage: (message: ProtocolMessage): message is ClientMessage =>
    CLIENT_MESSAGE_TYPES.has(message.type),

  /** Check if message is a server message */
  isServerMessage: (message: ProtocolMessage): message is ServerMessage =>
    SERVER_MESSAGE_TYPES.has(message.type),

  /** Type guards for specific message types */
  isSessionStart: (msg: ProtocolMessage): msg is ClientSessionStartMessage => msg.type === 'session.start',
  isSessionMessage: (msg: ProtocolMessage): msg is ClientSessionMessageMessage => msg.type === 'session.message',
  isToolResult: (msg: ProtocolMessage): msg is ClientToolResultMessage => msg.type === 'tool.result',
  isPermissionResponse: (msg: ProtocolMessage): msg is ClientPermissionResponseMessage => msg.type === 'permission.response',
  isSessionInterrupt: (msg: ProtocolMessage): msg is ClientSessionInterruptMessage => msg.type === 'session.interrupt',
  isSessionCreated: (msg: ProtocolMessage): msg is ServerSessionCreatedMessage => msg.type === 'session.created',
  isStreamToken: (msg: ProtocolMessage): msg is ServerStreamTokenMessage => msg.type === 'stream.token',
  isStreamThinking: (msg: ProtocolMessage): msg is ServerStreamThinkingMessage => msg.type === 'stream.thinking',
  isToolCall: (msg: ProtocolMessage): msg is ServerToolCallMessage => msg.type === 'tool.call',
  isPermissionRequest: (msg: ProtocolMessage): msg is ServerPermissionRequestMessage => msg.type === 'permission.request',
  isProgressUpdate: (msg: ProtocolMessage): msg is ServerProgressUpdateMessage => msg.type === 'progress.update',
  isError: (msg: ProtocolMessage): msg is ServerErrorMessage => msg.type === 'error',
  isSessionEnd: (msg: ProtocolMessage): msg is ServerSessionEndMessage => msg.type === 'session.end'
}