/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	createDiv,
	createSpan,
	createButton,
	createElement,
	addClass,
	removeClass,
	toggleClass,
	hasClass,
	setText,
	setAttribute,
	removeAttribute,
	show,
	hide,
	toggleVisibility,
	isVisible,
	empty,
	appendChildren,
	createTextarea,
	createInput,
	createSelect,
	setAttributes,
	setStyles,
} from "./dom-helpers";

describe("DOM Helpers", () => {
	describe("createDiv", () => {
		it("should create a div element without class", () => {
			const div = createDiv();
			expect(div.tagName).toBe("DIV");
			expect(div.className).toBe("");
		});

		it("should create a div element with class", () => {
			const div = createDiv("test-class");
			expect(div.tagName).toBe("DIV");
			expect(div.className).toBe("test-class");
		});
	});

	describe("createSpan", () => {
		it("should create a span element without class", () => {
			const span = createSpan();
			expect(span.tagName).toBe("SPAN");
			expect(span.className).toBe("");
		});

		it("should create a span element with class", () => {
			const span = createSpan("test-class");
			expect(span.tagName).toBe("SPAN");
			expect(span.className).toBe("test-class");
		});
	});

	describe("createButton", () => {
		it("should create a button with text", () => {
			const button = createButton("Click me");
			expect(button.tagName).toBe("BUTTON");
			expect(button.textContent).toBe("Click me");
		});

		it("should create a button with class", () => {
			const button = createButton("Click me", { className: "btn-primary" });
			expect(button.className).toBe("btn-primary");
		});

		it("should create a button with click handler", () => {
			const onClick = vi.fn();
			const button = createButton("Click me", { onClick });
			button.click();
			expect(onClick).toHaveBeenCalledOnce();
		});

		it("should create a disabled button", () => {
			const button = createButton("Click me", { disabled: true });
			expect(button.disabled).toBe(true);
		});

		it("should create a button with tooltip", () => {
			const button = createButton("Click me", { tooltip: "Click this button" });
			expect(button.getAttribute("title")).toBe("Click this button");
		});
	});

	describe("createElement", () => {
		it("should create an element without class", () => {
			const p = createElement("p");
			expect(p.tagName).toBe("P");
			expect(p.className).toBe("");
		});

		it("should create an element with class", () => {
			const p = createElement("p", "paragraph");
			expect(p.tagName).toBe("P");
			expect(p.className).toBe("paragraph");
		});
	});

	describe("addClass", () => {
		it("should add a single class", () => {
			const div = createDiv();
			addClass(div, "test-class");
			expect(div.className).toBe("test-class");
		});

		it("should add multiple classes", () => {
			const div = createDiv();
			addClass(div, "class1", "class2", "class3");
			expect(div.classList.contains("class1")).toBe(true);
			expect(div.classList.contains("class2")).toBe(true);
			expect(div.classList.contains("class3")).toBe(true);
		});
	});

	describe("removeClass", () => {
		it("should remove a single class", () => {
			const div = createDiv("test-class");
			removeClass(div, "test-class");
			expect(div.className).toBe("");
		});

		it("should remove multiple classes", () => {
			const div = createDiv();
			addClass(div, "class1", "class2", "class3");
			removeClass(div, "class1", "class3");
			expect(div.classList.contains("class1")).toBe(false);
			expect(div.classList.contains("class2")).toBe(true);
			expect(div.classList.contains("class3")).toBe(false);
		});
	});

	describe("toggleClass", () => {
		it("should add class if not present", () => {
			const div = createDiv();
			toggleClass(div, "test-class");
			expect(div.classList.contains("test-class")).toBe(true);
		});

		it("should remove class if present", () => {
			const div = createDiv("test-class");
			toggleClass(div, "test-class");
			expect(div.classList.contains("test-class")).toBe(false);
		});
	});

	describe("hasClass", () => {
		it("should return true if element has class", () => {
			const div = createDiv("test-class");
			expect(hasClass(div, "test-class")).toBe(true);
		});

		it("should return false if element does not have class", () => {
			const div = createDiv();
			expect(hasClass(div, "test-class")).toBe(false);
		});
	});

	describe("setText", () => {
		it("should set text content", () => {
			const div = createDiv();
			setText(div, "Hello World");
			expect(div.textContent).toBe("Hello World");
		});

		it("should replace existing text content", () => {
			const div = createDiv();
			div.textContent = "Old text";
			setText(div, "New text");
			expect(div.textContent).toBe("New text");
		});
	});

	describe("setAttribute", () => {
		it("should set an attribute", () => {
			const div = createDiv();
			setAttribute(div, "data-id", "123");
			expect(div.getAttribute("data-id")).toBe("123");
		});
	});

	describe("removeAttribute", () => {
		it("should remove an attribute", () => {
			const div = createDiv();
			div.setAttribute("data-id", "123");
			removeAttribute(div, "data-id");
			expect(div.getAttribute("data-id")).toBeNull();
		});
	});

	describe("show", () => {
		it("should remove hidden class", () => {
			const div = createDiv("hidden");
			show(div);
			expect(div.classList.contains("hidden")).toBe(false);
		});

		it("should clear display style", () => {
			const div = createDiv();
			div.style.display = "none";
			show(div);
			expect(div.style.display).toBe("");
		});
	});

	describe("hide", () => {
		it("should add hidden class", () => {
			const div = createDiv();
			hide(div);
			expect(div.classList.contains("hidden")).toBe(true);
		});

		it("should set display to none", () => {
			const div = createDiv();
			hide(div);
			expect(div.style.display).toBe("none");
		});
	});

	describe("toggleVisibility", () => {
		it("should show hidden element", () => {
			const div = createDiv("hidden");
			toggleVisibility(div);
			expect(div.classList.contains("hidden")).toBe(false);
		});

		it("should hide visible element", () => {
			const div = createDiv();
			toggleVisibility(div);
			expect(div.classList.contains("hidden")).toBe(true);
		});
	});

	describe("isVisible", () => {
		it("should return true for visible element", () => {
			const div = createDiv();
			expect(isVisible(div)).toBe(true);
		});

		it("should return false for hidden element with class", () => {
			const div = createDiv("hidden");
			expect(isVisible(div)).toBe(false);
		});

		it("should return false for hidden element with style", () => {
			const div = createDiv();
			div.style.display = "none";
			expect(isVisible(div)).toBe(false);
		});
	});

	describe("empty", () => {
		it("should remove all children", () => {
			const parent = createDiv();
			parent.appendChild(createDiv());
			parent.appendChild(createSpan());
			parent.appendChild(createButton("Test"));
			expect(parent.children.length).toBe(3);

			empty(parent);
			expect(parent.children.length).toBe(0);
		});

		it("should handle empty element", () => {
			const div = createDiv();
			empty(div);
			expect(div.children.length).toBe(0);
		});
	});

	describe("appendChildren", () => {
		it("should append multiple children", () => {
			const parent = createDiv();
			const child1 = createDiv();
			const child2 = createSpan();
			const child3 = createButton("Test");

			appendChildren(parent, child1, child2, child3);
			expect(parent.children.length).toBe(3);
			expect(parent.children[0]).toBe(child1);
			expect(parent.children[1]).toBe(child2);
			expect(parent.children[2]).toBe(child3);
		});

		it("should handle no children", () => {
			const parent = createDiv();
			appendChildren(parent);
			expect(parent.children.length).toBe(0);
		});
	});

	describe("createTextarea", () => {
		it("should create a textarea without options", () => {
			const textarea = createTextarea();
			expect(textarea.tagName).toBe("TEXTAREA");
		});

		it("should create a textarea with class", () => {
			const textarea = createTextarea({ className: "input-field" });
			expect(textarea.className).toBe("input-field");
		});

		it("should create a textarea with placeholder", () => {
			const textarea = createTextarea({ placeholder: "Enter text..." });
			expect(textarea.placeholder).toBe("Enter text...");
		});

		it("should create a textarea with rows", () => {
			const textarea = createTextarea({ rows: 5 });
			expect(textarea.rows).toBe(5);
		});

		it("should create a textarea with value", () => {
			const textarea = createTextarea({ value: "Initial value" });
			expect(textarea.value).toBe("Initial value");
		});

		it("should create a textarea with change handler", () => {
			const onChange = vi.fn();
			const textarea = createTextarea({ onChange });
			textarea.value = "New value";
			textarea.dispatchEvent(new Event("change"));
			expect(onChange).toHaveBeenCalledWith("New value");
		});
	});

	describe("createInput", () => {
		it("should create an input without options", () => {
			const input = createInput();
			expect(input.tagName).toBe("INPUT");
		});

		it("should create an input with type", () => {
			const input = createInput({ type: "email" });
			expect(input.type).toBe("email");
		});

		it("should create an input with class", () => {
			const input = createInput({ className: "input-field" });
			expect(input.className).toBe("input-field");
		});

		it("should create an input with placeholder", () => {
			const input = createInput({ placeholder: "Enter email..." });
			expect(input.placeholder).toBe("Enter email...");
		});

		it("should create an input with value", () => {
			const input = createInput({ value: "test@example.com" });
			expect(input.value).toBe("test@example.com");
		});

		it("should create an input with change handler", () => {
			const onChange = vi.fn();
			const input = createInput({ onChange });
			input.value = "new@example.com";
			input.dispatchEvent(new Event("change"));
			expect(onChange).toHaveBeenCalledWith("new@example.com");
		});
	});

	describe("createSelect", () => {
		it("should create a select with options", () => {
			const options = [
				{ value: "1", text: "Option 1" },
				{ value: "2", text: "Option 2" },
				{ value: "3", text: "Option 3" },
			];
			const select = createSelect(options);
			expect(select.tagName).toBe("SELECT");
			expect(select.options.length).toBe(3);
			expect(select.options[0]?.value).toBe("1");
			expect(select.options[0]?.textContent).toBe("Option 1");
		});

		it("should create a select with selected value", () => {
			const options = [
				{ value: "1", text: "Option 1" },
				{ value: "2", text: "Option 2" },
			];
			const select = createSelect(options, "2");
			expect(select.value).toBe("2");
		});

		it("should create a select with change handler", () => {
			const onChange = vi.fn();
			const options = [
				{ value: "1", text: "Option 1" },
				{ value: "2", text: "Option 2" },
			];
			const select = createSelect(options, "1", onChange);
			select.value = "2";
			select.dispatchEvent(new Event("change"));
			expect(onChange).toHaveBeenCalledWith("2");
		});
	});

	describe("setAttributes", () => {
		it("should set multiple attributes", () => {
			const div = createDiv();
			setAttributes(div, {
				"data-id": "123",
				"data-name": "test",
				"aria-label": "Test element",
			});
			expect(div.getAttribute("data-id")).toBe("123");
			expect(div.getAttribute("data-name")).toBe("test");
			expect(div.getAttribute("aria-label")).toBe("Test element");
		});

		it("should handle empty attributes object", () => {
			const div = createDiv();
			setAttributes(div, {});
			expect(div.attributes.length).toBe(0);
		});
	});

	describe("setStyles", () => {
		it("should set multiple styles", () => {
			const div = createDiv();
			setStyles(div, {
				color: "red",
				fontSize: "16px",
				display: "block",
			});
			expect(div.style.color).toBe("red");
			expect(div.style.fontSize).toBe("16px");
			expect(div.style.display).toBe("block");
		});

		it("should skip undefined styles", () => {
			const div = createDiv();
			setStyles(div, {
				color: "red",
				fontSize: undefined,
			});
			expect(div.style.color).toBe("red");
			expect(div.style.fontSize).toBe("");
		});
	});
});
