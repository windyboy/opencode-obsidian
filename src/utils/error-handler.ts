/**
 * Error severity levels
 */
export enum ErrorSeverity {
  Critical = 'critical',
  Error = 'error',
  Warning = 'warning',
  Info = 'info'
}

/**
 * Error context information
 */
export interface ErrorContext {
  module?: string
  function?: string
  operation?: string
  metadata?: Record<string, unknown>
}

/**
 * User notification callback function
 */
export type NotificationCallback = (message: string, severity: ErrorSeverity) => void

/**
 * Error handler configuration
 */
export interface ErrorHandlerConfig {
  showUserNotifications?: boolean
  logToConsole?: boolean
  collectErrors?: boolean
  maxCollectedErrors?: number
  notificationCallback?: NotificationCallback
}

/**
 * Collected error for reporting
 */
interface CollectedError {
  error: Error
  severity: ErrorSeverity
  context: ErrorContext
  timestamp: number
}

/**
 * Unified error handling system
 * Provides consistent error handling, logging, and user notification across the application
 */
export class ErrorHandler {
  private config: Required<Omit<ErrorHandlerConfig, 'notificationCallback'>> & {
    notificationCallback?: NotificationCallback
  }
  private collectedErrors: CollectedError[] = []

  constructor(config: Partial<ErrorHandlerConfig> = {}) {
    this.config = {
      showUserNotifications: config.showUserNotifications ?? true,
      logToConsole: config.logToConsole ?? true,
      collectErrors: config.collectErrors ?? false,
      maxCollectedErrors: config.maxCollectedErrors ?? 100,
      notificationCallback: config.notificationCallback
    }
  }

  /**
   * Handle an error with the specified severity and context
   */
  handleError(
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    error: Error | unknown,
    context: ErrorContext = {},
    severity: ErrorSeverity = ErrorSeverity.Error
  ): void {
    const errorInstance = error instanceof Error 
      ? error 
      : new Error(String(error))

    // Collect error if enabled
    if (this.config.collectErrors) {
      this.collectError(errorInstance, severity, context)
    }

    // Log to console
    if (this.config.logToConsole) {
      this.logError(errorInstance, severity, context)
    }

    // Show user notification for critical and error level issues
    if (this.config.showUserNotifications && 
        (severity === ErrorSeverity.Critical || severity === ErrorSeverity.Error)) {
      this.notifyUser(errorInstance, severity, context)
    }
  }

  /**
   * Log error to console with context information
   */
  private logError(error: Error, severity: ErrorSeverity, context: ErrorContext): void {
    const prefix = `[${context.module || 'Unknown'}]${context.function ? `.${context.function}` : ''}`
    const message = `${prefix} ${severity.toUpperCase()}: ${error.message}`
    
    switch (severity) {
      case ErrorSeverity.Critical:
      case ErrorSeverity.Error:
        console.error(message, {
          error,
          stack: error.stack,
          context: context.metadata
        })
        break
      case ErrorSeverity.Warning:
        console.warn(message, {
          error,
          context: context.metadata
        })
        break
      case ErrorSeverity.Info:
        console.debug(message, {
          error,
          context: context.metadata
        })
        break
    }
  }

  /**
   * Show user notification
   */
  private notifyUser(error: Error, severity: ErrorSeverity, context: ErrorContext): void {
    // Create user-friendly error message
    let userMessage = error.message
    
    // Add context if available
    if (context.operation) {
      userMessage = `${context.operation}: ${userMessage}`
    } else if (context.module) {
      userMessage = `${context.module}: ${userMessage}`
    }

    // Limit message length for notifications
    if (userMessage.length > 200) {
      userMessage = userMessage.substring(0, 197) + '...'
    }

    // Use notification callback if provided, otherwise fallback to console
    if (this.config.notificationCallback) {
      try {
        this.config.notificationCallback(userMessage, severity)
      } catch (e) {
        console.error(`[ErrorHandler] Failed to show notification:`, e)
      }
    } else {
      // Fallback to console if no notification callback is provided
      console.error(`[User Notification - ${severity}] ${userMessage}`)
    }
  }

  /**
   * Collect error for later reporting
   */
  private collectError(error: Error, severity: ErrorSeverity, context: ErrorContext): void {
    if (this.collectedErrors.length >= this.config.maxCollectedErrors) {
      // Remove oldest error if we've reached the limit
      this.collectedErrors.shift()
    }

    this.collectedErrors.push({
      error,
      severity,
      context,
      timestamp: Date.now()
    })
  }

  /**
   * Get collected errors
   */
  getCollectedErrors(): ReadonlyArray<CollectedError> {
    return [...this.collectedErrors]
  }

  /**
   * Clear collected errors
   */
  clearCollectedErrors(): void {
    this.collectedErrors = []
  }

  /**
   * Wrap an async function with error handling
   */
  wrapAsync<T extends (...args: unknown[]) => Promise<unknown>>(
    fn: T,
    context: ErrorContext
  ): T {
    return (async (...args: Parameters<T>) => {
      try {
        return await fn(...args)
      } catch (error) {
        this.handleError(error, context)
        throw error // Re-throw to allow caller to handle
      }
    }) as T
  }

  /**
   * Wrap a sync function with error handling
   */
  wrapSync<T extends (...args: unknown[]) => unknown>(
    fn: T,
    context: ErrorContext
  ): T {
    return ((...args: Parameters<T>) => {
      try {
        return fn(...args)
      } catch (error) {
        this.handleError(error, context)
        throw error // Re-throw to allow caller to handle
      }
    }) as T
  }
}

/**
 * Global error handler instance
 * Can be configured per module or use default instance
 */
let defaultErrorHandler: ErrorHandler | null = null

/**
 * Get or create default error handler
 */
export function getDefaultErrorHandler(config?: Partial<ErrorHandlerConfig>): ErrorHandler {
  if (!defaultErrorHandler) {
    defaultErrorHandler = new ErrorHandler(config)
  }
  return defaultErrorHandler
}

/**
 * Set default error handler (useful for testing or custom configuration)
 */
export function setDefaultErrorHandler(handler: ErrorHandler): void {
  defaultErrorHandler = handler
}
