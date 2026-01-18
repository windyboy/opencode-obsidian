/**
 * Combined Utility Functions
 *
 * Consolidated helpers from debounce-throttle.ts, data-helpers.ts, and dom-helpers.ts
 */

// ============================================================================
// Debounce and Throttle Utilities
// ============================================================================

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

// ============================================================================
// Data Manipulation Utilities
// ============================================================================

/**
 * Format a timestamp as a locale string
 */
export function formatTimestamp(timestamp: number): string {
	return new Date(timestamp).toLocaleString();
}

/**
 * Format a timestamp as a locale time string (time only)
 */
export function formatTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString();
}

/**
 * Format a timestamp as an ISO string
 */
export function formatISOTimestamp(timestamp: number): string {
	return new Date(timestamp).toISOString();
}

/**
 * Create a filename-safe timestamp string
 */
export function createFilenameSafeTimestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	return `${text.substring(0, maxLength - 3)}...`;
}

/**
 * Sanitize a string for use as a filename
 */
export function sanitizeFilename(filename: string, maxLength = 50): string {
	return filename.replace(/[<>:/\\|?*]/g, "_").substring(0, maxLength);
}

/**
 * Normalize a file path (convert backslashes, remove leading/trailing slashes)
 */
export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/") // Convert backslashes to forward slashes
		.replace(/^\/+/, "") // Remove leading slashes
		.replace(/\/+$/, ""); // Remove trailing slashes
}

/**
 * Generate a unique ID with timestamp and random component
 */
export function generateId(prefix = "id"): string {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Parse a slash command from input text
 * Returns null if not a valid command
 */
export function parseSlashCommand(
	content: string,
): { command: string; args: string } | null {
	const trimmed = content.trim();

	if (!trimmed.startsWith("/")) return null;

	const withoutSlash = trimmed.slice(1).trim();

	if (!withoutSlash) return null;

	const spaceIndex = withoutSlash.indexOf(" ");

	if (spaceIndex === -1) {
		return { command: withoutSlash, args: "" };
	}

	const command = withoutSlash.slice(0, spaceIndex);
	return command ? { command, args: withoutSlash.slice(spaceIndex + 1) } : null;
}

/**
 * Extract the first line from text content
 */
export function extractFirstLine(text: string, maxLength = 50): string {
	const firstLine = text.trim().split("\n")[0] ?? "";
	return firstLine.substring(0, maxLength).trim();
}

/**
 * Parse a numeric value from a string with fallback
 */
export function parseNumber(
	value: string,
	fallback: number,
	min?: number,
): number {
	const trimmed = value.trim();
	const numValue = trimmed === "0" ? 0 : parseInt(trimmed, 10);

	if (isNaN(numValue)) {
		return fallback;
	}

	if (min !== undefined && numValue < min) {
		return fallback;
	}

	return numValue;
}

/**
 * Split a multi-line string into trimmed, non-empty lines
 */
export function splitLines(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * Split a comma-separated string into trimmed, non-empty values
 */
export function splitCommaList(text: string): string[] {
	return text
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

/**
 * Ensure a file extension starts with a dot
 */
export function normalizeExtension(ext: string): string {
	return ext.startsWith(".") ? ext : `.${ext}`;
}

/**
 * Create a text snippet around a match position
 */
export function createSnippet(
	text: string,
	matchPosition: number,
	matchLength: number,
	contextLength = 50,
): string {
	const start = Math.max(0, matchPosition - contextLength);
	const end = Math.min(text.length, matchPosition + matchLength + contextLength);
	const snippet = text.substring(start, end);

	const prefix = start > 0 ? "..." : "";
	const suffix = end < text.length ? "..." : "";

	return `${prefix}${snippet}${suffix}`;
}

/**
 * Escape special regex characters in a string
 */
export function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Count occurrences of a pattern in text (case-insensitive)
 */
export function countMatches(text: string, pattern: string): number {
	const regex = new RegExp(escapeRegex(pattern), "gi");
	const matches = text.match(regex);
	return matches ? matches.length : 0;
}

/**
 * Safely parse JSON with fallback
 */
export function safeJsonParse<T>(
	json: string,
	fallback: T,
): T {
	try {
		return JSON.parse(json) as T;
	} catch {
		return fallback;
	}
}

/**
 * Safely stringify JSON with fallback
 */
export function safeJsonStringify(
	value: any,
	fallback = "",
): string {
	try {
		return JSON.stringify(value);
	} catch {
		return fallback;
	}
}

// ============================================================================
// DOM Manipulation Utilities
// ============================================================================

/**
 * Create a div element with optional class name
 */
export function createDiv(className?: string): HTMLDivElement {
	const div = document.createElement("div");
	if (className) {
		div.className = className;
	}
	return div;
}

/**
 * Create a span element with optional class name
 */
export function createSpan(className?: string): HTMLSpanElement {
	const span = document.createElement("span");
	if (className) {
		span.className = className;
	}
	return span;
}

/**
 * Create a button element with text and optional click handler
 */
export function createButton(
	text: string,
	options?: {
		className?: string;
		onClick?: () => void;
		disabled?: boolean;
		tooltip?: string;
	},
): HTMLButtonElement {
	const button = document.createElement("button");
	button.textContent = text;

	if (options?.className) {
		button.className = options.className;
	}

	if (options?.onClick) {
		button.onclick = options.onClick;
	}

	if (options?.disabled) {
		button.disabled = options.disabled;
	}

	if (options?.tooltip) {
		button.setAttribute("title", options.tooltip);
	}

	return button;
}

/**
 * Create a generic HTML element with optional class name
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (className) {
		element.className = className;
	}
	return element;
}

/**
 * Add one or more CSS classes to an element
 */
export function addClass(element: HTMLElement, ...classNames: string[]): void {
	element.classList.add(...classNames);
}

/**
 * Remove one or more CSS classes from an element
 */
export function removeClass(
	element: HTMLElement,
	...classNames: string[]
): void {
	element.classList.remove(...classNames);
}

/**
 * Toggle a CSS class on an element
 */
export function toggleClass(element: HTMLElement, className: string): void {
	element.classList.toggle(className);
}

/**
 * Check if an element has a CSS class
 */
export function hasClass(element: HTMLElement, className: string): boolean {
	return element.classList.contains(className);
}

/**
 * Set text content of an element
 */
export function setText(element: HTMLElement, text: string): void {
	element.textContent = text;
}

/**
 * Set an attribute on an element
 */
export function setAttribute(
	element: HTMLElement,
	name: string,
	value: string,
): void {
	element.setAttribute(name, value);
}

/**
 * Remove an attribute from an element
 */
export function removeAttribute(element: HTMLElement, name: string): void {
	element.removeAttribute(name);
}

/**
 * Show an element by removing the 'hidden' class
 */
export function show(element: HTMLElement): void {
	element.classList.remove("hidden");
	element.style.display = "";
}

/**
 * Hide an element by adding the 'hidden' class
 */
export function hide(element: HTMLElement): void {
	element.classList.add("hidden");
	element.style.display = "none";
}

/**
 * Toggle visibility of an element
 */
export function toggleVisibility(element: HTMLElement): void {
	if (element.classList.contains("hidden")) {
		show(element);
	} else {
		hide(element);
	}
}

/**
 * Check if an element is visible (not hidden)
 */
export function isVisible(element: HTMLElement): boolean {
	return !element.classList.contains("hidden") && element.style.display !== "none";
}

/**
 * Empty all children from an element
 */
export function empty(element: HTMLElement): void {
	while (element.firstChild) {
		element.removeChild(element.firstChild);
	}
}

/**
 * Append multiple children to an element
 */
export function appendChildren(
	parent: HTMLElement,
	...children: HTMLElement[]
): void {
	children.forEach((child) => parent.appendChild(child));
}

/**
 * Create a textarea element with common options
 */
export function createTextarea(options?: {
	className?: string;
	placeholder?: string;
	rows?: number;
	value?: string;
	onChange?: (value: string) => void;
}): HTMLTextAreaElement {
	const textarea = document.createElement("textarea");

	if (options?.className) {
		textarea.className = options.className;
	}

	if (options?.placeholder) {
		textarea.placeholder = options.placeholder;
	}

	if (options?.rows) {
		textarea.rows = options.rows;
	}

	if (options?.value) {
		textarea.value = options.value;
	}

	if (options?.onChange) {
		textarea.onchange = () => options.onChange?.(textarea.value);
	}

	return textarea;
}

/**
 * Create an input element with common options
 */
export function createInput(options?: {
	type?: string;
	className?: string;
	placeholder?: string;
	value?: string;
	onChange?: (value: string) => void;
}): HTMLInputElement {
	const input = document.createElement("input");

	if (options?.type) {
		input.type = options.type;
	}

	if (options?.className) {
		input.className = options.className;
	}

	if (options?.placeholder) {
		input.placeholder = options.placeholder;
	}

	if (options?.value) {
		input.value = options.value;
	}

	if (options?.onChange) {
		input.onchange = () => options.onChange?.(input.value);
	}

	return input;
}

/**
 * Create a select (dropdown) element with options
 */
export function createSelect(
	options: Array<{ value: string; text: string }>,
	selectedValue?: string,
	onChange?: (value: string) => void,
): HTMLSelectElement {
	const select = document.createElement("select");

	options.forEach((opt) => {
		const option = document.createElement("option");
		option.value = opt.value;
		option.textContent = opt.text;
		select.appendChild(option);
	});

	if (selectedValue) {
		select.value = selectedValue;
	}

	if (onChange) {
		select.onchange = () => onChange(select.value);
	}

	return select;
}

/**
 * Set multiple attributes on an element at once
 */
export function setAttributes(
	element: HTMLElement,
	attributes: Record<string, string>,
): void {
	Object.entries(attributes).forEach(([name, value]) => {
		element.setAttribute(name, value);
	});
}

/**
 * Set inline styles on an element
 */
export function setStyles(
	element: HTMLElement,
	styles: Partial<CSSStyleDeclaration>,
): void {
	Object.entries(styles).forEach(([property, value]) => {
		if (value !== undefined) {
			(element.style as any)[property] = value;
		}
	});
}
