/**
 * DOM Helper Utilities
 *
 * Common DOM manipulation functions extracted from view components.
 * These are pure functions that don't depend on Obsidian API where possible.
 */

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
