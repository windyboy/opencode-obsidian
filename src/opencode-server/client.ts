/**
 * OpenCode Server HTTP + SSE Client
 * Uses HTTP for requests and SSE for streaming events
 */

import type { App } from 'obsidian'
import { requestUrl } from 'obsidian'
import { ObsidianToolRegistry } from '../tools/obsidian/tool-registry'
import type { PermissionManager } from '../tools/obsidian/permission-manager'
import type { ErrorHandler } from '../utils/error-handler'
import { ErrorSeverity } from '../utils/error-handler'
import type { ImageAttachment } from '../types'

/**
 * OpenCode Server client configuration
 */
export interface OpenCodeServerConfig {
	/** Base HTTP URL for OpenCode Server */
	url: string
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

interface EventEnvelope {
	type?: string
	properties?: unknown
}

interface EventWrapper {
	payload?: EventEnvelope
}

interface MessagePart {
	type: string
	sessionID: string
	text?: string
}

interface MessagePartUpdatedPayload {
	part: MessagePart
	delta?: string
}

interface SessionStatusPayload {
	sessionID: string
	status: { type: string; message?: string; attempt?: number }
}

interface SessionErrorPayload {
	sessionID?: string
	error?: { name?: string; data?: { message?: string } }
}

/**
 * OpenCode Server HTTP + SSE Client
 * Handles all communication with OpenCode Server
 */
export class OpenCodeServerClient {
	private connectionState: ConnectionState = 'disconnected'
	private config: Required<OpenCodeServerConfig>
	private reconnectTimer: number | null = null
	private reconnectAttempts: number = 0
	private currentSessionId: string | null = null
	private baseUrl: string
	private sseAbortController: AbortController | null = null
	private sseBuffer = ''
	private sseCurrentEvent: string | null = null
	private sseCurrentData: string[] = []

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
			autoReconnect: config.autoReconnect ?? true,
			reconnectDelay: config.reconnectDelay ?? 3000,
			reconnectMaxAttempts: config.reconnectMaxAttempts ?? 10
		}
		this.baseUrl = this.normalizeBaseUrl(config.url)

		if (!this.permissionManager) {
			console.warn('[OpenCodeServerClient] PermissionManager not provided. Preview generation will bypass permission checks.')
		}
	}

	/**
	 * Connect to OpenCode Server (opens SSE stream)
	 */
	async connect(): Promise<void> {
		if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
			console.debug('[OpenCodeServerClient] Already connected or connecting')
			return
		}

		this.connectionState = 'connecting'
		this.reconnectAttempts = 0

		try {
			await this.startEventStream()
		} catch (error) {
			this.connectionState = 'disconnected'
			this.errorHandler.handleError(error, {
				module: 'OpenCodeServerClient',
				function: 'connect',
				operation: 'Opening SSE connection'
			}, ErrorSeverity.Error)
			throw error
		}
	}

	/**
	 * Disconnect from OpenCode Server
	 */
	async disconnect(): Promise<void> {
		this.config.autoReconnect = false

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}

		if (this.sseAbortController) {
			this.sseAbortController.abort()
			this.sseAbortController = null
		}

		this.connectionState = 'disconnected'
		this.currentSessionId = null
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

		const delay = this.config.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1)
		console.debug(`[OpenCodeServerClient] Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`)

		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = null
			void this.connect()
		}, delay)
	}

	private async startEventStream(): Promise<void> {
		if (this.sseAbortController) {
			this.sseAbortController.abort()
		}

		const controller = new AbortController()
		this.sseAbortController = controller
		const eventUrl = this.buildUrl('/global/event')

		console.debug('[OpenCodeServerClient] Connecting to SSE endpoint (EventSource):', {
			url: eventUrl,
			baseUrl: this.baseUrl,
			configUrl: this.config.url
		})

		try {
			console.debug('[OpenCodeServerClient] Creating EventSource to:', eventUrl)

			const eventSource = new EventSource(eventUrl)

			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					eventSource.close()
					reject(new Error('EventSource connection timeout'))
				}, 10000)

				eventSource.onopen = () => {
					console.debug('[OpenCodeServerClient] EventSource opened')
					clearTimeout(timeout)
					this.connectionState = 'connected'
					this.reconnectAttempts = 0
					console.debug('[OpenCodeServerClient] SSE connection established')
					resolve()
				}

				eventSource.onerror = (error) => {
					console.error('[OpenCodeServerClient] EventSource error:', error)
					clearTimeout(timeout)
					eventSource.close()
					reject(new Error('EventSource connection failed. Make sure OpenCode Server is running with --cors flag.'))
				}

				eventSource.addEventListener('message', (event) => {
					this.handleSseChunk(event.data)
				})

				eventSource.addEventListener('server.connected', (event) => {
					console.debug('[OpenCodeServerClient] Server connected event received')
				})

				controller.signal.addEventListener('abort', () => {
					eventSource.close()
				})
			})

			void this.readEventStreamWithEventSource(eventSource, controller)
		} catch (error) {
			console.error('[OpenCodeServerClient] SSE connection error:', {
				error,
				message: error instanceof Error ? error.message : String(error),
				name: error instanceof Error ? error.name : undefined
			})
			throw error
		}
	}

	private async readEventStreamWithEventSource(eventSource: EventSource, controller: AbortController): Promise<void> {
		const handleEvent = (eventType: string, dataStr: string) => {
			let data: unknown
			try {
				data = JSON.parse(dataStr)
			} catch (error) {
				console.warn('[OpenCodeServerClient] Failed to parse event data:', error)
				return
			}

			const envelope = data as EventEnvelope
			const wrapper = data as EventWrapper
			const payload = wrapper.payload ?? envelope

			this.handleServerEvent(eventType, payload?.properties ?? envelope?.properties)
		}

		eventSource.addEventListener('message.part.updated', (event) => {
			handleEvent('message.part.updated', event.data)
		})

		eventSource.addEventListener('session.status', (event) => {
			handleEvent('session.status', event.data)
		})

		eventSource.addEventListener('session.error', (event) => {
			handleEvent('session.error', event.data)
		})

		eventSource.addEventListener('session.idle', (event) => {
			handleEvent('session.idle', event.data)
		})

		eventSource.onerror = (error) => {
			if (controller.signal.aborted) {
				console.debug('[OpenCodeServerClient] SSE stream aborted')
				return
			}

			console.error('[OpenCodeServerClient] EventSource error:', error)

			const errorObj = error instanceof Error ? error : new Error(String(error))
			this.errorCallbacks.forEach(cb => cb(errorObj))

			if (!controller.signal.aborted) {
				this.connectionState = 'disconnected'
				this.sseAbortController = null
				eventSource.close()
				console.debug('[OpenCodeServerClient] SSE connection closed, attempting reconnect')
				this.attemptReconnect()
			}
		}

		controller.signal.addEventListener('abort', () => {
			eventSource.close()
		})
	}

	private handleSseChunk(chunk: string): void {
		this.sseBuffer += chunk
		const lines = this.sseBuffer.split(/\r?\n/)
		this.sseBuffer = lines.pop() ?? ''

		for (const line of lines) {
			if (!line) {
				this.dispatchSseEvent()
				continue
			}

			if (line.startsWith('event:')) {
				this.sseCurrentEvent = line.slice(6).trim()
				continue
			}

			if (line.startsWith('data:')) {
				this.sseCurrentData.push(line.slice(5).trim())
			}

			if (line.startsWith('id:')) {
			}
		}
	}

	private dispatchSseEvent(): void {
		if (this.sseCurrentData.length === 0) {
			this.sseCurrentEvent = null
			return
		}

		const data = this.sseCurrentData.join('\n')
		this.sseCurrentData = []

		let parsed: unknown
		try {
			parsed = JSON.parse(data)
		} catch (error) {
			console.warn('[OpenCodeServerClient] Failed to parse SSE payload', error)
			this.sseCurrentEvent = null
			return
		}

		const envelope = parsed as EventEnvelope
		const wrapper = parsed as EventWrapper
		const payload = wrapper.payload ?? envelope
		const eventType = this.sseCurrentEvent ?? payload?.type ?? envelope?.type

		this.sseCurrentEvent = null

		if (!eventType) {
			return
		}

		this.handleServerEvent(eventType, payload?.properties ?? envelope?.properties)
	}

	private handleServerEvent(eventType: string, properties?: unknown): void {
		switch (eventType) {
			case 'message.part.updated':
				this.handleMessagePartUpdated(properties as MessagePartUpdatedPayload)
				break
			case 'session.status':
				this.handleSessionStatus(properties as SessionStatusPayload)
				break
			case 'session.error':
				this.handleSessionError(properties as SessionErrorPayload)
				break
			case 'session.idle':
				this.handleSessionIdle(properties as { sessionID: string })
				break
			default:
				break
		}
	}

	private handleMessagePartUpdated(payload: MessagePartUpdatedPayload): void {
		if (!payload?.part) {
			return
		}

		const { part, delta } = payload
		const sessionId = part.sessionID

		switch (part.type) {
			case 'text': {
				const token = delta ?? part.text ?? ''
				if (token) {
					this.streamTokenCallbacks.forEach(cb => cb(sessionId, token, false))
				}
				break
			}
			case 'reasoning': {
				const content = delta ?? part.text ?? ''
				if (content) {
					this.streamThinkingCallbacks.forEach(cb => cb(sessionId, content))
				}
				break
			}
			default:
				break
		}
	}

	private handleSessionStatus(payload: SessionStatusPayload): void {
		if (!payload?.sessionID || !payload.status) {
			return
		}

		const message = payload.status.message ?? `Session ${payload.status.type}`
		this.progressUpdateCallbacks.forEach(cb => cb(payload.sessionID, { message }))
	}

	private handleSessionError(payload: SessionErrorPayload): void {
		const message = payload?.error?.data?.message ?? 'Session error'
		const error = new Error(message)
		if (payload?.sessionID) {
			(error as { sessionId?: string }).sessionId = payload.sessionID
		}

		const metadataPayload: Record<string, unknown> = {
			sessionID: payload?.sessionID ?? null,
			errorName: payload?.error?.name ?? null,
			errorMessage: payload?.error?.data?.message ?? null
		}

		this.errorHandler.handleError(error, {
			module: 'OpenCodeServerClient',
			function: 'handleSessionError',
			operation: 'Session error',
			metadata: { payload: metadataPayload }
		}, ErrorSeverity.Error)


		this.errorCallbacks.forEach(cb => cb(error))
	}

	private handleSessionIdle(payload: { sessionID: string }): void {
		if (!payload?.sessionID) {
			return
		}

		this.streamTokenCallbacks.forEach(cb => cb(payload.sessionID, '', true))
		this.sessionEndCallbacks.forEach(cb => cb(payload.sessionID, 'completed'))
	}

	private buildUrl(path: string): string {
		const normalizedPath = path.startsWith('/') ? path : `/${path}`
		return `${this.baseUrl}${normalizedPath}`
	}

	private normalizeBaseUrl(value: string): string {
		const trimmed = value.trim()
		if (trimmed.startsWith('ws://')) {
			return `http://${trimmed.slice(5)}`.replace(/\/$/, '')
		}
		if (trimmed.startsWith('wss://')) {
			return `https://${trimmed.slice(6)}`.replace(/\/$/, '')
		}
		return trimmed.replace(/\/$/, '')
	}

	private async requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
		const headers: Record<string, string> = {}
		if (options.headers instanceof Headers) {
			options.headers.forEach((value, key) => {
				headers[key] = value
			})
		} else if (typeof options.headers === 'object') {
			Object.assign(headers, options.headers)
		}
		if (!headers['Content-Type']) {
			headers['Content-Type'] = 'application/json'
		}

		const url = this.buildUrl(path)
		console.debug('[OpenCodeServerClient] HTTP request (Obsidian requestUrl):', {
			url,
			method: options.method || 'GET',
			headers,
			hasBody: !!options.body
		})

		const response = await requestUrl({
			url,
			method: options.method || 'GET',
			headers,
			body: options.body ? String(options.body) : undefined
		})

		if (response.status < 200 || response.status >= 300) {
			throw new Error(`Request failed (${response.status}): ${response.text}`)
		}

		console.debug('[OpenCodeServerClient] HTTP response:', {
			url,
			status: response.status
		})

		return response.json as T
	}

	/**
	 * Start a new session
	 */
	async startSession(context?: SessionContext, agentId?: string, obsidianSessionId?: string): Promise<string> {
		const payload: { title?: string } = {}
		if (obsidianSessionId) {
			payload.title = `Obsidian ${obsidianSessionId}`
		} else if (context?.currentNote) {
			payload.title = context.currentNote
		}

		const response = await this.requestJson<{ id: string }>('/session', {
			method: 'POST',
			body: JSON.stringify(payload)
		})

		this.currentSessionId = response.id
		return response.id
	}

	/**
	 * Send a message to an existing session
	 */
	async sendSessionMessage(sessionId: string, message: string, images?: ImageAttachment[]): Promise<void> {
		if (images && images.length > 0) {
			console.warn('[OpenCodeServerClient] Image attachments are not supported in the HTTP API yet')
		}

		await this.requestJson(`/session/${encodeURIComponent(sessionId)}/message`, {
			method: 'POST',
			body: JSON.stringify({
				parts: [
					{
						type: 'text',
						text: message
					}
				]
			})
		})
	}

	/**
	 * Interrupt/stop a session
	 */
	async interruptSession(sessionId: string): Promise<void> {
		await this.requestJson(`/session/${encodeURIComponent(sessionId)}/abort`, {
			method: 'POST',
			body: JSON.stringify({})
		})
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
