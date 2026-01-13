/**
 * Utility functions for debouncing and throttling function calls
 */

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
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let pendingPromise: Promise<Awaited<ReturnType<T>>> | null = null
  let resolveCallback: ((value: Awaited<ReturnType<T>>) => void) | null = null
  let rejectCallback: ((reason?: unknown) => void) | null = null

  return function debounced(...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> {
    // Cancel previous timeout
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }

    // Create new promise if no pending promise exists
    if (!pendingPromise) {
      pendingPromise = new Promise<Awaited<ReturnType<T>>>((resolve, reject) => {
        resolveCallback = resolve
        rejectCallback = reject
      })
    }

    // Set new timeout
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    timeoutId = setTimeout(async () => {
      try {
        const result = await fn(...args) as Awaited<ReturnType<T>>
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
