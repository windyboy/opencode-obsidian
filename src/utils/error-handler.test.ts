import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorHandler, ErrorSeverity, getDefaultErrorHandler, setDefaultErrorHandler } from './error-handler'

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorHandler = new ErrorHandler()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should create ErrorHandler with default config', () => {
      const handler = new ErrorHandler()
      expect(handler).toBeInstanceOf(ErrorHandler)
    })

    it('should create ErrorHandler with custom config', () => {
      const handler = new ErrorHandler({
        showUserNotifications: false,
        logToConsole: false,
        collectErrors: true,
        maxCollectedErrors: 50,
      })
      expect(handler).toBeInstanceOf(ErrorHandler)
    })

    it('should use default values for undefined config options', () => {
      const handler = new ErrorHandler({})
      const errors = handler.getCollectedErrors()
      expect(errors).toEqual([])
    })
  })

  describe('handleError', () => {
    it('should handle Error instance', () => {
      const error = new Error('Test error')
      errorHandler.handleError(error, {}, ErrorSeverity.Error)
      
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should handle non-Error values by converting to Error', () => {
      errorHandler.handleError('String error', {}, ErrorSeverity.Error)
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should handle errors with context', () => {
      const error = new Error('Test error')
      const context = {
        module: 'TestModule',
        function: 'testFunction',
        operation: 'Test operation',
        metadata: { key: 'value' }
      }
      
      errorHandler.handleError(error, context, ErrorSeverity.Error)
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[TestModule].testFunction'),
        expect.any(Object)
      )
    })

    it('should log warnings with console.warn', () => {
      const error = new Error('Warning message')
      errorHandler.handleError(error, {}, ErrorSeverity.Warning)
      
      expect(consoleWarnSpy).toHaveBeenCalled()
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    })

    it('should log info with console.info', () => {
      const error = new Error('Info message')
      errorHandler.handleError(error, {}, ErrorSeverity.Info)
      
      expect(consoleInfoSpy).toHaveBeenCalled()
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    })

    it('should not log when logToConsole is disabled', () => {
      const handler = new ErrorHandler({ 
        logToConsole: false,
        showUserNotifications: false, // Also disable notifications to avoid console.error in fallback
      })
      const error = new Error('Test error')
      
      handler.handleError(error, {}, ErrorSeverity.Error)
      
      // Should not log via logError method, but notifyUser fallback might still use console.error
      // So we check that the main error logging wasn't called (the one with full error object)
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[Unknown]'),
        expect.any(Object)
      )
    })
  })

  describe('notification callback', () => {
    it('should call notification callback for critical errors', () => {
      const notificationCallback = vi.fn()
      const handler = new ErrorHandler({
        notificationCallback,
        showUserNotifications: true,
      })
      
      const error = new Error('Critical error')
      handler.handleError(error, {}, ErrorSeverity.Critical)
      
      expect(notificationCallback).toHaveBeenCalledWith(
        'Critical error',
        ErrorSeverity.Critical
      )
    })

    it('should call notification callback for error severity', () => {
      const notificationCallback = vi.fn()
      const handler = new ErrorHandler({
        notificationCallback,
        showUserNotifications: true,
      })
      
      const error = new Error('Regular error')
      handler.handleError(error, {}, ErrorSeverity.Error)
      
      expect(notificationCallback).toHaveBeenCalled()
    })

    it('should not call notification callback for warnings', () => {
      const notificationCallback = vi.fn()
      const handler = new ErrorHandler({
        notificationCallback,
        showUserNotifications: true,
      })
      
      const error = new Error('Warning')
      handler.handleError(error, {}, ErrorSeverity.Warning)
      
      expect(notificationCallback).not.toHaveBeenCalled()
    })

    it('should not call notification callback when showUserNotifications is disabled', () => {
      const notificationCallback = vi.fn()
      const handler = new ErrorHandler({
        notificationCallback,
        showUserNotifications: false,
      })
      
      const error = new Error('Error')
      handler.handleError(error, {}, ErrorSeverity.Error)
      
      expect(notificationCallback).not.toHaveBeenCalled()
    })

    it('should truncate long messages in notifications', () => {
      const notificationCallback = vi.fn()
      const handler = new ErrorHandler({
        notificationCallback,
        showUserNotifications: true,
      })
      
      const longMessage = 'a'.repeat(250)
      const error = new Error(longMessage)
      handler.handleError(error, {}, ErrorSeverity.Error)
      
      expect(notificationCallback).toHaveBeenCalled()
      const [message] = notificationCallback.mock.calls[0]
      expect(message.length).toBeLessThanOrEqual(200)
      expect(message).toContain('...')
    })

    it('should add operation context to notification message', () => {
      const notificationCallback = vi.fn()
      const handler = new ErrorHandler({
        notificationCallback,
        showUserNotifications: true,
      })
      
      const error = new Error('Test error')
      handler.handleError(error, { operation: 'Test operation' }, ErrorSeverity.Error)
      
      expect(notificationCallback).toHaveBeenCalledWith(
        expect.stringContaining('Test operation'),
        ErrorSeverity.Error
      )
    })
  })

  describe('error collection', () => {
    it('should collect errors when enabled', () => {
      const handler = new ErrorHandler({ collectErrors: true })
      const error = new Error('Test error')
      
      handler.handleError(error, { module: 'Test' }, ErrorSeverity.Error)
      
      const errors = handler.getCollectedErrors()
      expect(errors).toHaveLength(1)
      expect(errors[0].error.message).toBe('Test error')
      expect(errors[0].severity).toBe(ErrorSeverity.Error)
      expect(errors[0].context.module).toBe('Test')
    })

    it('should not collect errors when disabled', () => {
      const handler = new ErrorHandler({ collectErrors: false })
      const error = new Error('Test error')
      
      handler.handleError(error, {}, ErrorSeverity.Error)
      
      const errors = handler.getCollectedErrors()
      expect(errors).toHaveLength(0)
    })

    it('should limit collected errors to maxCollectedErrors', () => {
      const handler = new ErrorHandler({
        collectErrors: true,
        maxCollectedErrors: 5,
      })
      
      // Add 7 errors
      for (let i = 0; i < 7; i++) {
        handler.handleError(new Error(`Error ${i}`), {}, ErrorSeverity.Error)
      }
      
      const errors = handler.getCollectedErrors()
      expect(errors).toHaveLength(5)
      // Should keep the most recent 5 errors
      expect(errors[0].error.message).toBe('Error 2')
      expect(errors[4].error.message).toBe('Error 6')
    })

    it('should clear collected errors', () => {
      const handler = new ErrorHandler({ collectErrors: true })
      const error = new Error('Test error')
      
      handler.handleError(error, {}, ErrorSeverity.Error)
      expect(handler.getCollectedErrors()).toHaveLength(1)
      
      handler.clearCollectedErrors()
      expect(handler.getCollectedErrors()).toHaveLength(0)
    })
  })

  describe('wrapAsync', () => {
    it('should wrap async function and handle errors', async () => {
      const asyncFn = vi.fn().mockRejectedValue(new Error('Async error'))
      const wrappedFn = errorHandler.wrapAsync(asyncFn, {
        module: 'Test',
        function: 'asyncFn',
      })
      
      await expect(wrappedFn()).rejects.toThrow('Async error')
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should wrap async function and pass through successful results', async () => {
      const asyncFn = vi.fn().mockResolvedValue('success')
      const wrappedFn = errorHandler.wrapAsync(asyncFn, {
        module: 'Test',
        function: 'asyncFn',
      })
      
      const result = await wrappedFn()
      expect(result).toBe('success')
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    })

    it('should preserve function arguments', async () => {
      const asyncFn = vi.fn().mockResolvedValue('result')
      const wrappedFn = errorHandler.wrapAsync(asyncFn, {
        module: 'Test',
      })
      
      await wrappedFn('arg1', 'arg2')
      expect(asyncFn).toHaveBeenCalledWith('arg1', 'arg2')
    })
  })

  describe('wrapSync', () => {
    it('should wrap sync function and handle errors', () => {
      const syncFn = vi.fn().mockImplementation(() => {
        throw new Error('Sync error')
      })
      const wrappedFn = errorHandler.wrapSync(syncFn, {
        module: 'Test',
        function: 'syncFn',
      })
      
      expect(() => wrappedFn()).toThrow('Sync error')
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should wrap sync function and pass through successful results', () => {
      const syncFn = vi.fn().mockReturnValue('success')
      const wrappedFn = errorHandler.wrapSync(syncFn, {
        module: 'Test',
      })
      
      const result = wrappedFn()
      expect(result).toBe('success')
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    })

    it('should preserve function arguments', () => {
      const syncFn = vi.fn().mockReturnValue('result')
      const wrappedFn = errorHandler.wrapSync(syncFn, {
        module: 'Test',
      })
      
      wrappedFn('arg1', 'arg2')
      expect(syncFn).toHaveBeenCalledWith('arg1', 'arg2')
    })
  })
})

describe('getDefaultErrorHandler', () => {
  afterEach(() => {
    setDefaultErrorHandler(null as any)
  })

  it('should create and return default error handler', () => {
    const handler = getDefaultErrorHandler()
    expect(handler).toBeInstanceOf(ErrorHandler)
  })

  it('should return the same instance on subsequent calls', () => {
    const handler1 = getDefaultErrorHandler()
    const handler2 = getDefaultErrorHandler()
    expect(handler1).toBe(handler2)
  })

  it('should create handler with custom config', () => {
    const handler = getDefaultErrorHandler({ collectErrors: true })
    expect(handler).toBeInstanceOf(ErrorHandler)
  })
})

describe('setDefaultErrorHandler', () => {
  afterEach(() => {
    setDefaultErrorHandler(null as any)
  })

  it('should set custom default error handler', () => {
    const customHandler = new ErrorHandler({ collectErrors: true })
    setDefaultErrorHandler(customHandler)
    
    const retrieved = getDefaultErrorHandler()
    expect(retrieved).toBe(customHandler)
  })
})
