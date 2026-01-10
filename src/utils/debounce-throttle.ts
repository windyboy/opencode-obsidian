/**
 * Utility functions for debouncing and throttling function calls
 */

/**
 * Creates a debounced function that delays invoking the provided function
 * until after the specified delay has elapsed since the last time it was invoked.
 * 
 * @param fn - The function to debounce
 * @param delay - The delay in milliseconds
 * @returns A debounced version of the function
 * 
 * @example
 * const debouncedSave = debounce(() => saveSettings(), 500)
 * input.onChange = debouncedSave
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return function debounced(...args: Parameters<T>) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = null
    }, delay)
  }
}

/**
 * Creates a debounced async function that delays invoking the provided async function
 * until after the specified delay has elapsed since the last time it was invoked.
 * Returns a Promise that resolves with the result of the last invocation.
 * 
 * @param fn - The async function to debounce
 * @param delay - The delay in milliseconds
 * @returns A debounced async version of the function
 * 
 * @example
 * const debouncedSave = debounceAsync(async () => await saveSettings(), 500)
 * await debouncedSave()
 */
export function debounceAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let pendingPromise: Promise<ReturnType<T>> | null = null
  let resolveCallback: ((value: ReturnType<T>) => void) | null = null
  let rejectCallback: ((reason?: unknown) => void) | null = null

  return function debounced(...args: Parameters<T>): Promise<ReturnType<T>> {
    // Cancel previous timeout
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }

    // Create new promise if no pending promise exists
    if (!pendingPromise) {
      pendingPromise = new Promise<ReturnType<T>>((resolve, reject) => {
        resolveCallback = resolve
        rejectCallback = reject
      })
    }

    // Set new timeout
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    timeoutId = setTimeout(async () => {
      try {
        const result = await fn(...args)
        if (resolveCallback) {
          resolveCallback(result)
        }
      } catch (error) {
        if (rejectCallback) {
          rejectCallback(error)
        }
      } finally {
        timeoutId = null
        pendingPromise = null
        resolveCallback = null
        rejectCallback = null
      }
    }, delay)

    return pendingPromise
  }
}

/**
 * Creates a throttled function that invokes the provided function
 * at most once per specified delay period.
 * 
 * @param fn - The function to throttle
 * @param delay - The delay in milliseconds
 * @returns A throttled version of the function
 * 
 * @example
 * const throttledFetch = throttle(() => fetchModels(), 1000)
 * scrollHandler = throttledFetch
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastInvokeTime = 0
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return function throttled(...args: Parameters<T>) {
    const now = Date.now()
    const timeSinceLastInvoke = now - lastInvokeTime

    if (timeSinceLastInvoke >= delay) {
      // Enough time has passed, invoke immediately
      lastInvokeTime = now
      fn(...args)
    } else {
      // Schedule invocation for the remaining time
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
      timeoutId = setTimeout(() => {
        lastInvokeTime = Date.now()
        fn(...args)
        timeoutId = null
      }, delay - timeSinceLastInvoke)
    }
  }
}

/**
 * Creates a throttled async function that invokes the provided async function
 * at most once per specified delay period.
 * Returns a Promise that resolves with the result of the invocation.
 * 
 * @param fn - The async function to throttle
 * @param delay - The delay in milliseconds
 * @returns A throttled async version of the function
 * 
 * @example
 * const throttledFetch = throttleAsync(async () => await fetchModels(), 1000)
 * await throttledFetch()
 */
export function throttleAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let lastInvokeTime = 0
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let pendingPromise: Promise<ReturnType<T>> | null = null
  let resolveCallback: ((value: ReturnType<T>) => void) | null = null
  let rejectCallback: ((reason?: unknown) => void) | null = null

  return function throttled(...args: Parameters<T>): Promise<ReturnType<T>> {
    const now = Date.now()
    const timeSinceLastInvoke = now - lastInvokeTime

    if (timeSinceLastInvoke >= delay) {
      // Enough time has passed, invoke immediately
      // Clear any pending timeout and promise
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      // Resolve/reject any pending promise with the new result
      const previousResolve = resolveCallback
      const previousReject = rejectCallback
      pendingPromise = null
      resolveCallback = null
      rejectCallback = null

      lastInvokeTime = now
      const promise = fn(...args)
      
      // If there was a pending promise, resolve it with this new result
      promise
        .then(result => {
          if (previousResolve) {
            previousResolve(result)
          }
          return result
        })
        .catch(error => {
          if (previousReject) {
            previousReject(error)
          }
          throw error
        })
      
      return promise
    } else {
      // Schedule invocation for the remaining time
      if (!pendingPromise) {
        pendingPromise = new Promise<ReturnType<T>>((resolve, reject) => {
          resolveCallback = resolve
          rejectCallback = reject
        })
      }

      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }

      // eslint-disable-next-line @typescript-eslint/no-misused-promises
    timeoutId = setTimeout(async () => {
        lastInvokeTime = Date.now()
        try {
          const result = await fn(...args)
          if (resolveCallback) {
            resolveCallback(result)
          }
        } catch (error) {
          if (rejectCallback) {
            rejectCallback(error)
          }
        } finally {
          timeoutId = null
          pendingPromise = null
          resolveCallback = null
          rejectCallback = null
        }
      }, delay - timeSinceLastInvoke)

      return pendingPromise
    }
  }
}
