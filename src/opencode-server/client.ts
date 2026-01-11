/**
 * OpenCode Server WebSocket Client
 * Manages WebSocket connection to OpenCode Server and handles all protocol messages
 */

import type { App } from 'obsidian'
import { ProtocolMessageSerializer, ProtocolMessageTypeGuard } from './protocol'
import type {
  ClientSessionStartMessage,
  ClientSessionMessageMessage,
  ClientToolResultMessage,
  ClientPermissionResponseMessage,
  ClientSessionInterruptMessage,
  ServerSessionCreatedMessage,
  ServerStreamTokenMessage,
  ServerStreamThinkingMessage,
  ServerToolCallMessage,
  ServerPermissionRequestMessage,
  ServerProgressUpdateMessage,
  ServerErrorMessage,
  ServerSessionEndMessage,
  ProtocolMessage
} from './protocol'
import { ObsidianToolRegistry } from '../tools/obsidian/tool-registry'
import { PermissionPendingError } from '../tools/obsidian/tool-executor'
import { PermissionModal, type PermissionRequest } from '../tools/obsidian/permission-modal'
import type { PermissionManager } from '../tools/obsidian/permission-manager'
import type { ErrorHandler } from '../utils/error-handler'
import { ErrorSeverity } from '../utils/error-handler'
import type { ImageAttachment } from '../types'

/**
 * OpenCode Server client configuration
 */
export interface OpenCodeServerConfig {
  /** WebSocket URL for OpenCode Server */
  url: string
  /** Optional authentication token */
  token?: string
  /** Whether to automatically reconnect on connection loss (default: true) */
  autoReconnect?: boolean
  /** Delay between reconnection attempts in milliseconds (default: 3000) */
  reconnectDelay?: number
  /** Maximum number of reconnection attempts (default: 10, 0 = unlimited) */
  reconnectMaxAttempts?: number
}

/**
 * Connection state
 */
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/**
 * Session context information
 */
export interface SessionContext {
  currentNote?: string
  selection?: string
  links?: string[]
  tags?: string[]
  properties?: Record<string, unknown>
}

/**
 * Progress update information
 */
export interface ProgressUpdate {
  message: string
  stage?: string
  progress?: number
}

/**
 * Pending tool call information (waiting for permission)
 */
interface PendingToolCall {
  sessionId: string
  callId: string
  toolName: string
  args: unknown
  startTime: number
}

/**
 * OpenCode Server WebSocket Client
 * Handles all communication with OpenCode Server
 */
export class OpenCodeServerClient {
  private ws: WebSocket | null = null
  private connectionState: ConnectionState = 'disconnected'
  private config: Required<Omit<OpenCodeServerConfig, 'token'>> & { token?: string }
  private reconnectTimer: number | null = null
  private reconnectAttempts: number = 0
  private currentSessionId: string | null = null
  private pendingToolCalls: Map<string, PendingToolCall> = new Map()
  
  // Pending session requests: Map<obsidianSessionId|requestId, PendingSessionRequest>
  private pendingSessionRequests: Map<string, {
    resolve: (sessionId: string) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
    obsidianSessionId?: string
    requestId: string
  }> = new Map()
  
  // Fallback callback array for backward compatibility (if no obsidianSessionId)
  private sessionCreatedCallbacks: Array<(sessionId: string, agentId?: string) => void> = []
  
  // Callbacks
  private streamTokenCallbacks: Array<(sessionId: string, token: string, done: boolean) => void> = []
  private streamThinkingCallbacks: Array<(sessionId: string, content: string) => void> = []
  private errorCallbacks: Array<(error: Error) => void> = []
  private progressUpdateCallbacks: Array<(sessionId: string, progress: ProgressUpdate) => void> = []
  private sessionEndCallbacks: Array<(sessionId: string, reason: string) => void> = []

  constructor(
    private toolRegistry: ObsidianToolRegistry,
    private app: App,
    private errorHandler: ErrorHandler,
    config: OpenCodeServerConfig,
    private permissionManager?: PermissionManager
  ) {
    this.config = {
      url: config.url,
      token: config.token,
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelay: config.reconnectDelay ?? 3000,
      reconnectMaxAttempts: config.reconnectMaxAttempts ?? 10
    }
    
    if (!this.permissionManager) {
      console.warn('[OpenCodeServerClient] PermissionManager not provided. Preview generation will bypass permission checks.')
    }
  }

  /**
   * Connect to OpenCode Server
   */
  async connect(): Promise<void> {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      console.debug('[OpenCodeServerClient] Already connected or connecting')
      return
    }

    this.connectionState = 'connecting'
    this.reconnectAttempts = 0

    try {
      const ws = new WebSocket(this.config.url)
      this.ws = ws

      ws.onopen = () => {
        console.debug('[OpenCodeServerClient] WebSocket connected')
        this.connectionState = 'connected'
        this.reconnectAttempts = 0
        
        // Send authentication token if provided
        if (this.config.token) {
          // Note: Authentication via WebSocket subprotocol or initial message would be handled here
          // For now, we assume the token is validated by the server on connection
        }
      }

      ws.onmessage = (event) => {
        this.handleMessage(event.data as string)
      }

      ws.onerror = (error) => {
        console.error('[OpenCodeServerClient] WebSocket error:', error)
        this.connectionState = 'disconnected'
        const errorObj = new Error('WebSocket connection error')
        this.errorHandler.handleError(errorObj, {
          module: 'OpenCodeServerClient',
          function: 'connect',
          operation: 'WebSocket connection'
        }, ErrorSeverity.Error)
        
        // Trigger error callbacks
        for (const callback of this.errorCallbacks) {
          callback(errorObj)
        }
      }

      ws.onclose = (event) => {
        console.debug('[OpenCodeServerClient] WebSocket closed', { code: event.code, reason: event.reason })
        this.connectionState = 'disconnected'
        this.ws = null

        // Attempt to reconnect if enabled
        if (this.config.autoReconnect && !event.wasClean) {
          this.attemptReconnect()
        }
      }
    } catch (error) {
      this.connectionState = 'disconnected'
      this.errorHandler.handleError(error, {
        module: 'OpenCodeServerClient',
        function: 'connect',
        operation: 'Creating WebSocket connection'
      }, ErrorSeverity.Error)
      throw error
    }
  }

  /**
   * Disconnect from OpenCode Server
   */
  async disconnect(): Promise<void> {
    this.config.autoReconnect = false // Disable auto-reconnect when manually disconnecting

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting')
      this.ws = null
    }

    this.connectionState = 'disconnected'
    this.currentSessionId = null
    this.pendingToolCalls.clear()
  }

  /**
   * Attempt to reconnect to the server
   */
  private attemptReconnect(): void {
    if (!this.config.autoReconnect) {
      return
    }

    if (this.config.reconnectMaxAttempts > 0 && this.reconnectAttempts >= this.config.reconnectMaxAttempts) {
      console.warn('[OpenCodeServerClient] Max reconnection attempts reached')
      this.errorHandler.handleError(
        new Error('Max reconnection attempts reached'),
        {
          module: 'OpenCodeServerClient',
          function: 'attemptReconnect',
          operation: 'Auto-reconnect'
        },
        ErrorSeverity.Error
      )
      return
    }

    this.connectionState = 'reconnecting'
    this.reconnectAttempts++

    // Exponential backoff: delay increases with each attempt
    const delay = this.config.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1)
    
    console.debug(`[OpenCodeServerClient] Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message = ProtocolMessageSerializer.deserialize(data)

      if (!ProtocolMessageTypeGuard.isServerMessage(message)) {
        console.warn('[OpenCodeServerClient] Received unexpected client message type:', message.type)
        return
      }

      switch (message.type) {
        case 'session.created':
          this.handleSessionCreated(message)
          break
        case 'stream.token':
          this.handleStreamToken(message)
          break
        case 'stream.thinking':
          this.handleStreamThinking(message)
          break
        case 'tool.call':
          void this.handleToolCall(message)
          break
        case 'permission.request':
          void this.handlePermissionRequest(message)
          break
        case 'progress.update':
          this.handleProgressUpdate(message)
          break
        case 'error':
          this.handleError(message)
          break
        case 'session.end':
          this.handleSessionEnd(message)
          break
        default:
          console.warn('[OpenCodeServerClient] Unknown message type:', (message as { type: string }).type)
      }
    } catch (error) {
      this.errorHandler.handleError(error, {
        module: 'OpenCodeServerClient',
        function: 'handleMessage',
        operation: 'Processing server message'
      }, ErrorSeverity.Error)
    }
  }

  /**
   * Handle session.created message
   */
  private handleSessionCreated(message: ServerSessionCreatedMessage): void {
    const { sessionId, agentId } = message.payload
    this.currentSessionId = sessionId

    console.debug('[OpenCodeServerClient] Session created:', { sessionId, agentId })

    // Try to resolve pending request by message ID first
    const pendingRequest = message.id ? this.pendingSessionRequests.get(message.id) : undefined

    if (pendingRequest) {
      this.resolvePendingRequest(message.id!, pendingRequest, sessionId)
      return
    }

    // If only one pending request exists, resolve it (FIFO)
    if (this.pendingSessionRequests.size === 1) {
      const [key, request] = this.pendingSessionRequests.entries().next().value as [string, typeof pendingRequest]
      if (request) {
        this.resolvePendingRequest(key, request, sessionId)
        return
      }
    }

    // Fallback to legacy callbacks
    console.warn('[OpenCodeServerClient] Could not match session.created to pending request, using fallback callbacks')
    for (const callback of this.sessionCreatedCallbacks) {
      callback(sessionId, agentId)
    }
  }

  /**
   * Resolve a pending session request
   */
  private resolvePendingRequest(
    key: string,
    request: { resolve: (sessionId: string) => void; timeout: ReturnType<typeof setTimeout> },
    sessionId: string
  ): void {
    clearTimeout(request.timeout)
    this.pendingSessionRequests.delete(key)
    request.resolve(sessionId)
    console.debug('[OpenCodeServerClient] Resolved pending session request:', key)
  }

  /**
   * Handle stream.token message
   */
  private handleStreamToken(message: ServerStreamTokenMessage): void {
    const { sessionId, token, done } = message.payload
    this.streamTokenCallbacks.forEach(cb => cb(sessionId, token, done ?? false))
  }

  /**
   * Handle stream.thinking message
   */
  private handleStreamThinking(message: ServerStreamThinkingMessage): void {
    const { sessionId, content } = message.payload
    this.streamThinkingCallbacks.forEach(cb => cb(sessionId, content))
  }

  /**
   * Handle tool.call message
   */
  private async handleToolCall(message: ServerToolCallMessage): Promise<void> {
    const { sessionId, callId, toolName, args } = message.payload

    console.debug('[OpenCodeServerClient] Tool call received:', { sessionId, callId, toolName })

    const startTime = Date.now()

    try {
      // Execute tool (approved=false initially, will be set to true after permission if needed)
      const result = await this.toolRegistry.execute(toolName, args, sessionId, callId, false)

      // Publish tool result event
      // Send tool result back to server
      this.sendToolResult(sessionId, callId, result, undefined, {
        approved: false,
        dryRun: false,
        duration: Date.now() - startTime
      })
    } catch (error) {
      if (error instanceof PermissionPendingError) {
        // Permission required - store pending tool call and request permission
        this.pendingToolCalls.set(callId, {
          sessionId,
          callId,
          toolName,
          args,
          startTime
        })

        // For update_note tool, we need to generate a preview first
        // Use unified preview generation from toolRegistry (which uses ObsidianToolExecutor)
        let preview: PermissionRequest['preview'] | undefined
        if (toolName === 'obsidian.update_note') {
          try {
            preview = await this.toolRegistry.generatePreview(toolName, args, sessionId, callId)
          } catch (previewError) {
            console.warn('[OpenCodeServerClient] Failed to generate preview:', previewError)
          }
        }

        // Publish permission requested event
        // Show permission modal
        await this.showPermissionModal({
          sessionId,
          callId,
          toolName,
          args,
          preview
        })
      } else {
        // Other error - publish error event and send error result
        const errorMessage = error instanceof Error ? error.message : String(error)
        
        this.sendToolResult(sessionId, callId, undefined, {
          message: errorMessage,
          code: 'TOOL_EXECUTION_ERROR',
          details: error
        })
      }
    }
  }


  /**
   * Show permission modal and handle user response
   */
  private async showPermissionModal(request: PermissionRequest): Promise<void> {
    return new Promise((resolve) => {
      const modal = new PermissionModal(this.app, request, (allowed: boolean, reason?: string) => {
        void (async () => {
          const { sessionId, callId, toolName, args } = request

          if (allowed) {
            // User approved - re-execute tool with approved=true
            const pendingCall = this.pendingToolCalls.get(callId)
            if (pendingCall) {
              this.pendingToolCalls.delete(callId)

              try {
                const startTime = pendingCall.startTime
                const result = await this.toolRegistry.execute(toolName, args, sessionId, callId, true)

                // Send tool result
                this.sendToolResult(sessionId, callId, result, undefined, {
                  approved: true,
                  dryRun: false,
                  duration: Date.now() - startTime
                })
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error)
                this.sendToolResult(sessionId, callId, undefined, {
                  message: errorMessage,
                  code: 'TOOL_EXECUTION_ERROR',
                  details: error
                })
              }
            }
          } else {
            // User denied - send permission response
            this.sendPermissionResponse(sessionId, callId, false, reason)
            this.pendingToolCalls.delete(callId)
          }

          resolve()
        })()
      })

      modal.open()
    })
  }

  /**
   * Handle permission.request message (from server)
   */
  private async handlePermissionRequest(message: ServerPermissionRequestMessage): Promise<void> {
    const { sessionId, callId, toolName, args, preview } = message.payload

    // Publish event to event bus
    // Show permission modal
    await this.showPermissionModal({
      sessionId,
      callId,
      toolName,
      args,
      preview
    })
  }

  /**
   * Handle progress.update message
   */
  private handleProgressUpdate(message: ServerProgressUpdateMessage): void {
    const { sessionId, message: progressMessage, stage, progress } = message.payload
    this.progressUpdateCallbacks.forEach(cb => cb(sessionId, { message: progressMessage, stage, progress }))
  }

  /**
   * Handle error message
   */
  private handleError(message: ServerErrorMessage): void {
    const { sessionId, message: errorMessage, code, details } = message.payload

    const error = new Error(errorMessage)
    if (code) {
      (error as { code?: string }).code = code
    }

    this.errorHandler.handleError(error, {
      module: 'OpenCodeServerClient',
      function: 'handleError',
      operation: 'Server error',
      metadata: { sessionId, code, details }
    }, ErrorSeverity.Error)

    this.errorCallbacks.forEach(cb => cb(error))
  }

  /**
   * Handle session.end message
   */
  private handleSessionEnd(message: ServerSessionEndMessage): void {
    const { sessionId, reason } = message.payload

    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null
    }

    this.sessionEndCallbacks.forEach(cb => cb(sessionId, reason))
  }

  /**
   * Send a message to the server
   */
  private sendMessage(message: ProtocolMessage): void {
    if (!this.ws || this.connectionState !== 'connected') {
      throw new Error('WebSocket is not connected')
    }

    const serialized = ProtocolMessageSerializer.serialize(message)
    this.ws.send(serialized)
  }

  /**
   * Start a new session
   */
  async startSession(context?: SessionContext, agentId?: string, obsidianSessionId?: string): Promise<string> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

    const message: ClientSessionStartMessage = {
      type: 'session.start',
      id: requestId,
      payload: {
        context,
        agentId,
        obsidianSessionId
      }
    }

    this.sendMessage(message)

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSessionRequests.delete(requestId)
        reject(new Error('Session start timeout'))
      }, 10000)

      this.pendingSessionRequests.set(requestId, {
        resolve,
        reject,
        timeout,
        obsidianSessionId,
        requestId
      })
    })
  }

  /**
   * Send a message to an existing session
   */
  async sendSessionMessage(sessionId: string, message: string, images?: ImageAttachment[]): Promise<void> {
    const clientMessage: ClientSessionMessageMessage = {
      type: 'session.message',
      payload: {
        sessionId,
        message,
        images: images?.map(img => ({
          data: img.data,
          mimeType: img.mimeType,
          name: img.name
        }))
      }
    }

    this.sendMessage(clientMessage)
  }

  /**
   * Send tool execution result
   */
  private sendToolResult(
    sessionId: string,
    callId: string,
    result?: unknown,
    error?: { message: string; code?: string; details?: unknown },
    auditLog?: { approved: boolean; dryRun: boolean; duration: number }
  ): void {
    const message: ClientToolResultMessage = {
      type: 'tool.result',
      payload: {
        sessionId,
        callId,
        result,
        error,
        auditLog
      }
    }

    this.sendMessage(message)
  }

  /**
   * Send permission response
   */
  private sendPermissionResponse(
    sessionId: string,
    callId: string,
    allowed: boolean,
    reason?: string,
    sessionOnly?: boolean
  ): void {
    const message: ClientPermissionResponseMessage = {
      type: 'permission.response',
      payload: {
        sessionId,
        callId,
        allowed,
        reason,
        sessionOnly
      }
    }

    this.sendMessage(message)
  }

  /**
   * Interrupt/stop a session
   */
  async interruptSession(sessionId: string): Promise<void> {
    const message: ClientSessionInterruptMessage = {
      type: 'session.interrupt',
      payload: {
        sessionId
      }
    }

    this.sendMessage(message)
  }

  /**
   * Register callback for stream token events
   */
  onStreamToken(callback: (sessionId: string, token: string, done: boolean) => void): void {
    this.streamTokenCallbacks.push(callback)
  }

  /**
   * Unregister callback for stream token events
   */
  offStreamToken(callback: (sessionId: string, token: string, done: boolean) => void): void {
    this.streamTokenCallbacks = this.streamTokenCallbacks.filter(cb => cb !== callback)
  }

  /**
   * Register callback for stream thinking events
   */
  onStreamThinking(callback: (sessionId: string, content: string) => void): void {
    this.streamThinkingCallbacks.push(callback)
  }

  /**
   * Unregister callback for stream thinking events
   */
  offStreamThinking(callback: (sessionId: string, content: string) => void): void {
    this.streamThinkingCallbacks = this.streamThinkingCallbacks.filter(cb => cb !== callback)
  }

  /**
   * Register callback for error events
   */
  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback)
  }

  /**
   * Register callback for progress update events
   */
  onProgressUpdate(callback: (sessionId: string, progress: ProgressUpdate) => void): void {
    this.progressUpdateCallbacks.push(callback)
  }

  /**
   * Register callback for session end events
   */
  onSessionEnd(callback: (sessionId: string, reason: string) => void): void {
    this.sessionEndCallbacks.push(callback)
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === 'connected'
  }
}
