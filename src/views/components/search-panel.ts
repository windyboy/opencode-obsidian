import { App, Notice, Platform, TFile } from "obsidian";
import type OpenCodeObsidianPlugin from "../../main";
import { empty, setAttribute, setStyles } from "../../utils/dom-helpers";
import type { SearchResult, FileResult, SymbolResult } from "../../types";

export type SearchMode = "text" | "files" | "symbols";

export class SearchPanel {
	private container: HTMLElement;
	private app: App;
	private plugin: OpenCodeObsidianPlugin;
	private searchInput: HTMLInputElement;
	private searchButton: HTMLButtonElement;
	private resultsContainer: HTMLElement;
	private statusMessage: HTMLElement;
	private loadingIndicator: HTMLElement;
	private modeTabs: HTMLElement;
	private currentMode: SearchMode = "text";
	private searchTimeout: number | null = null;

	constructor(plugin: OpenCodeObsidianPlugin, container: HTMLElement) {
		this.plugin = plugin;
		this.container = container;
		this.app = plugin.app;
		
		this.render();
		this.bindEvents();
	}

	private render(): void {
		// Clear container
		empty(this.container);
		
		// Set up container styles
		setStyles(this.container, {
			display: "flex",
			flexDirection: "column",
			height: "100%",
			backgroundColor: "var(--background-primary)",
			border: "1px solid var(--background-modifier-border)",
			borderRadius: "var(--radius-s)",
		});

		// Create search header
		const header = this.container.createEl("div", {
			cls: "search-header",
		});
		setStyles(header, {
			display: "flex",
			flexDirection: "column",
			padding: "8px",
			borderBottom: "1px solid var(--background-modifier-border)",
		});

		// Create mode tabs
		this.modeTabs = header.createEl("div", {
			cls: "search-mode-tabs",
		});
		setStyles(this.modeTabs, {
			display: "flex",
			marginBottom: "8px",
			gap: "4px",
		});

		// Create tab buttons
		this.createModeTab("text", "Text");
		this.createModeTab("files", "Files");
		this.createModeTab("symbols", "Symbols");

		// Create search input container
		const inputContainer = header.createEl("div", {
			cls: "search-input-container",
		});
		setStyles(inputContainer, {
			display: "flex",
			gap: "8px",
		});

		// Create search input
		this.searchInput = inputContainer.createEl("input", {
			type: "text",
			placeholder: "Search...",
			cls: "search-input",
		});
		setStyles(this.searchInput, {
			flex: "1",
			padding: "8px 12px",
			border: "1px solid var(--background-modifier-border)",
			borderRadius: "var(--radius-s)",
			backgroundColor: "var(--background-secondary)",
			color: "var(--text-normal)",
		});

		// Create search button
		this.searchButton = inputContainer.createEl("button", {
			text: "Search",
			cls: "search-button",
		});
		setStyles(this.searchButton, {
			padding: "8px 16px",
			backgroundColor: "var(--interactive-accent)",
			color: "var(--text-on-accent)",
			border: "none",
			borderRadius: "var(--radius-s)",
			cursor: "pointer",
		});

		// Create results container
		this.resultsContainer = this.container.createEl("div", {
			cls: "search-results",
		});
		setStyles(this.resultsContainer, {
			flex: "1",
			overflow: "auto",
			padding: "8px",
		});

		// Create status message
		this.statusMessage = this.container.createEl("div", {
			cls: "search-status",
		});
		setStyles(this.statusMessage, {
			padding: "8px",
			fontSize: "var(--font-size-smaller)",
			color: "var(--text-muted)",
			borderTop: "1px solid var(--background-modifier-border)",
		});

		// Create loading indicator
		this.loadingIndicator = this.container.createEl("div", {
			cls: "search-loading",
			text: "Searching...",
		});
		setStyles(this.loadingIndicator, {
			display: "none",
			padding: "16px",
			textAlign: "center",
			color: "var(--text-muted)",
		});
	}

	private createModeTab(mode: SearchMode, label: string): void {
		const tab = this.modeTabs.createEl("button", {
			text: label,
			cls: "search-mode-tab",
		});
		setStyles(tab, {
			padding: "4px 8px",
			backgroundColor: mode === this.currentMode 
				? "var(--interactive-accent)" 
				: "var(--background-secondary)",
			color: mode === this.currentMode 
				? "var(--text-on-accent)" 
				: "var(--text-normal)",
			border: "1px solid var(--background-modifier-border)",
			borderRadius: "var(--radius-xs)",
			cursor: "pointer",
			fontSize: "var(--font-size-smaller)",
		});

		tab.addEventListener("click", () => {
			this.setMode(mode);
		});
	}

	private setMode(mode: SearchMode): void {
		this.currentMode = mode;
		
		// Update tab styles
		this.modeTabs.querySelectorAll(".search-mode-tab").forEach((tab, index) => {
			const modes: SearchMode[] = ["text", "files", "symbols"];
			const tabMode = modes[index];
			
			setStyles(tab as HTMLElement, {
				backgroundColor: tabMode === mode 
					? "var(--interactive-accent)" 
					: "var(--background-secondary)",
				color: tabMode === mode 
					? "var(--text-on-accent)" 
					: "var(--text-normal)",
			});
		});

		// Clear results and update placeholder
		this.clearResults();
		this.updatePlaceholder();
	}

	private updatePlaceholder(): void {
		const placeholders = {
			text: "Search text across files...",
			files: "Search files by name...",
			symbols: "Search symbols (functions, classes, etc.)...",
		};

		this.searchInput.placeholder = placeholders[this.currentMode];
	}

	private bindEvents(): void {
		// Search on input with debounce
		this.searchInput.addEventListener("input", () => {
			if (this.searchTimeout) {
				clearTimeout(this.searchTimeout);
			}

			const query = this.searchInput.value.trim();
			if (query.length > 0) {
				this.searchTimeout = window.setTimeout(() => {
					this.performSearch();
				}, 300);
			} else {
				this.clearResults();
			}
		});

		// Search on button click
		this.searchButton.addEventListener("click", () => {
			this.performSearch();
		});

		// Search on Enter key
		this.searchInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				this.performSearch();
			}
		});

		// Escape to close
		this.searchInput.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				this.hide();
			}
		});

		// Focus input when panel is shown
		this.searchInput.focus();
	}

	private async performSearch(): Promise<void> {
		const query = this.searchInput.value.trim();
		if (!query) {
			this.clearResults();
			return;
		}

		this.showLoading();
		this.clearResults();

		try {
			let results: (SearchResult | FileResult | SymbolResult)[] = [];

			if (this.currentMode === "text") {
				// Text search
				results = await this.plugin.opencodeClient?.searchText({
					pattern: query,
					limit: 50,
				}) || [];
			} else if (this.currentMode === "files") {
				// File search
				results = await this.plugin.opencodeClient?.searchFiles(query, 50) || [];
			} else if (this.currentMode === "symbols") {
				// Symbol search
				results = await this.plugin.opencodeClient?.searchSymbols(query, 50) || [];
			}

			this.displayResults(results);
			this.updateStatus(`${results.length} results found`);
		} catch (error) {
			console.error("Search failed:", error);
			new Notice("Search failed. Please check your connection.");
			this.updateStatus("Search failed");
		} finally {
			this.hideLoading();
		}
	}

	private displayResults(results: (SearchResult | FileResult | SymbolResult)[]): void {
		if (results.length === 0) {
			this.resultsContainer.createEl("div", {
				text: "No results found",
				cls: "search-no-results",
			});
			return;
		}

		results.forEach((result, index) => {
			const resultElement = this.resultsContainer.createEl("div", {
				cls: "search-result-item",
			});
			setStyles(resultElement, {
				padding: "8px 12px",
				marginBottom: "4px",
				borderRadius: "var(--radius-s)",
				backgroundColor: "var(--background-secondary)",
				cursor: "pointer",
				transition: "background-color 0.2s",
			});

			resultElement.addEventListener("click", () => {
				this.handleResultClick(result);
			});

			resultElement.addEventListener("mouseenter", () => {
				setStyles(resultElement, {
					backgroundColor: "var(--background-secondary-alt)",
				});
			});

			resultElement.addEventListener("mouseleave", () => {
				setStyles(resultElement, {
					backgroundColor: "var(--background-secondary)",
				});
			});

			// Result content
			if ("line" in result) {
				// Text search result
				const searchResult = result as SearchResult;
				this.renderTextResult(resultElement, searchResult);
			} else if ("size" in result) {
				// File search result
				const fileResult = result as FileResult;
				this.renderFileResult(resultElement, fileResult);
			} else if ("type" in result) {
				// Symbol search result
				const symbolResult = result as SymbolResult;
				this.renderSymbolResult(resultElement, symbolResult);
			}
		});
	}

	private renderTextResult(container: HTMLElement, result: SearchResult): void {
		// Path and line number
		const pathLine = container.createEl("div", {
			cls: "search-result-path",
			text: `${result.path}:${result.line}`,
		});
		setStyles(pathLine, {
			fontSize: "var(--font-size-smaller)",
			color: "var(--text-muted)",
			marginBottom: "4px",
		});

		// Content preview
		const content = container.createEl("div", {
			cls: "search-result-content",
		});
		content.innerHTML = this.highlightSearchTerms(result.content, this.searchInput.value);
		setStyles(content, {
			fontSize: "var(--font-size-small)",
			whiteSpace: "pre-wrap",
			wordBreak: "break-word",
		});
	}

	private renderFileResult(container: HTMLElement, result: FileResult): void {
		// File name/path
		const pathEl = container.createEl("div", {
			cls: "search-result-path",
			text: result.path,
		});
		setStyles(pathEl, {
			fontSize: "var(--font-size-small)",
			fontWeight: "500",
			marginBottom: "4px",
		});

		// File metadata
		const metadata = container.createEl("div", {
			cls: "search-result-metadata",
			text: this.formatFileSize(result.size),
		});
		setStyles(metadata, {
			fontSize: "var(--font-size-smaller)",
			color: "var(--text-muted)",
		});
	}

	private renderSymbolResult(container: HTMLElement, result: SymbolResult): void {
		// Symbol name and type
		const symbolHeader = container.createEl("div", {
			cls: "search-result-symbol-header",
		});

		const symbolName = symbolHeader.createEl("span", {
			cls: "search-result-symbol-name",
			text: result.name,
		});
		setStyles(symbolName, {
			fontSize: "var(--font-size-small)",
			fontWeight: "500",
			marginRight: "8px",
		});

		const symbolType = symbolHeader.createEl("span", {
			cls: "search-result-symbol-type",
			text: result.type,
		});
		setStyles(symbolType, {
			fontSize: "var(--font-size-smaller)",
			color: "var(--text-muted)",
			backgroundColor: "var(--background-secondary-alt)",
			padding: "2px 6px",
			borderRadius: "var(--radius-xs)",
		});

		// Symbol location
		const location = container.createEl("div", {
			cls: "search-result-path",
			text: `${result.path}:${result.line}`,
		});
		setStyles(location, {
			fontSize: "var(--font-size-smaller)",
			color: "var(--text-muted)",
			marginTop: "4px",
		});
	}

	private handleResultClick(result: SearchResult | FileResult | SymbolResult): void {
		try {
			// Get the file path
			let path = "";
			if ("path" in result) {
				path = result.path;
			}

			if (!path) return;

			// Open file in Obsidian
			const file = this.app.vault.getAbstractFileByPath(path) as TFile | null;
			if (file && "basename" in file && "extension" in file) {
				this.app.workspace.getLeaf().openFile(file, {
					active: true,
					...("line" in result && {
						line: (result as SearchResult).line - 1, // Obsidian uses 0-based line numbers
					}),
				});
				this.hide();
			} else {
				new Notice(`File not found: ${path}`);
			}
		} catch (error) {
			console.error("Failed to open file:", error);
			new Notice("Failed to open file");
		}
	}

	private highlightSearchTerms(text: string, searchTerm: string): string {
		if (!searchTerm) return text;
		const regex = new RegExp(`(${searchTerm})`, "gi");
		return text.replace(regex, "<mark class='search-highlight'>$1</mark>");
	}

	private formatFileSize(bytes: number): string {
		if (bytes === 0) return "0 B";
		const k = 1024;
		const sizes = ["B", "KB", "MB", "GB"];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
	}

	private showLoading(): void {
		this.loadingIndicator.style.display = "block";
		this.searchButton.disabled = true;
	}

	private hideLoading(): void {
		this.loadingIndicator.style.display = "none";
		this.searchButton.disabled = false;
	}

	private clearResults(): void {
		empty(this.resultsContainer);
		this.updateStatus("");
	}

	private updateStatus(message: string): void {
		this.statusMessage.textContent = message;
	}

	public hide(): void {
		this.container.hide();
	}

	public show(): void {
		this.container.show();
		this.searchInput.focus();
	}

	public focus(): void {
		this.searchInput.focus();
	}

	public destroy(): void {
		if (this.searchTimeout) {
			clearTimeout(this.searchTimeout);
		}
		empty(this.container);
	}
}
