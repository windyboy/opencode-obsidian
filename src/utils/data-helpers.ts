/**
 * Data Helper Utilities
 *
 * Common data transformation functions extracted from various components.
 * These are pure functions for string manipulation, formatting, and data processing.
 */

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
	return filename.replace(/[<>:"/\\|?*]/g, "_").substring(0, maxLength);
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
