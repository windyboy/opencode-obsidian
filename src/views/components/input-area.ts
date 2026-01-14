import type OpenCodeObsidianPlugin from "../../main";
import { App } from "obsidian";
import { ConfirmationModal } from "../modals/confirmation-modal";
import { AttachmentModal } from "../modals/attachment-modal";

interface CommandSuggestion {
	name: string;
	description?: string;
}

export class InputAreaComponent {
	private commandSuggestions: CommandSuggestion[] = [];
	private commandSuggestionsLoading = false;
	private isStreaming = false;

	constructor(
		private plugin: OpenCodeObsidianPlugin,
		private app: App,
		private sendMessage: (content: string) => Promise<void>,
		private stopStreaming: () => void,
		private showAttachmentModal: () => void,
		private ensureCommandSuggestions: () => Promise<void>,
		private parseSlashCommand: (content: string) => { command: string; args: string } | null,
		private setIsStreaming: (value: boolean) => void,
	) {}

	render(container: HTMLElement): void {
		container.empty();

		const inputContainer = container.createDiv(
			"opencode-obsidian-input-container",
		);

		const toolbar = inputContainer.createDiv(
			"opencode-obsidian-input-toolbar",
		);

		const agentSelect = toolbar.createEl("select", {
			cls: "opencode-obsidian-agent-select",
		});

		const defaultAgents: Array<{ id: string; name: string }> = [
			{ id: "assistant", name: "Assistant" },
			{ id: "bootstrap", name: "Bootstrap" },
			{ id: "thinking-partner", name: "Thinking Partner" },
			{ id: "research-assistant", name: "Research Assistant" },
			{ id: "read-only", name: "Read Only" },
		];

		const loadedAgents =
			this.plugin.settings.agents?.filter((a) => !a.hidden) || [];

		const agentsToShow =
			loadedAgents.length > 0 ? loadedAgents : defaultAgents;

		agentsToShow.forEach((agent) => {
			const option = agentSelect.createEl("option", {
				value: agent.id,
				text: agent.name,
			});

			if ("color" in agent && typeof agent.color === "string") {
				option.style.color = agent.color;
			}
		});

		const currentValue = this.plugin.settings.agent;
		if (agentsToShow.some((a) => a.id === currentValue)) {
			agentSelect.value = currentValue;
		} else if (agentsToShow.length > 0 && agentsToShow[0]) {
			agentSelect.value = agentsToShow[0].id;
			this.plugin.settings.agent = agentsToShow[0].id;
			void this.plugin.saveSettings();
		}

		agentSelect.onchange = async () => {
			this.plugin.settings.agent = agentSelect.value;
			await this.plugin.debouncedSaveSettings();
		};

		const textarea = inputContainer.createEl("textarea", {
			cls: "opencode-obsidian-input-textarea",
			attr: {
				placeholder:
					"Type your message... (Shift+Enter for new line, Enter to send)",
			},
		});

		const suggestionContainer = inputContainer.createDiv(
			"opencode-obsidian-command-suggestions",
		);
		const suggestionList = suggestionContainer.createDiv(
			"opencode-obsidian-command-suggestions-list",
		);

		const statusBar = inputContainer.createDiv(
			"opencode-obsidian-input-status",
		);
		const charCount = statusBar.createSpan("opencode-obsidian-char-count");
		const streamingStatus = statusBar.createSpan(
			"opencode-obsidian-streaming-status",
		);

		const updateCharCount = () => {
			const count = textarea.value.length;
			charCount.textContent = `${count} characters`;
			if (count > 8000) {
				charCount.addClass("opencode-obsidian-char-warning");
			} else {
				charCount.removeClass("opencode-obsidian-char-warning");
			}
		};

		let currentSuggestions: CommandSuggestion[] = [];
		let selectedSuggestionIndex = -1;

		const hideSuggestions = () => {
			suggestionContainer.removeClass("is-visible");
			currentSuggestions = [];
			selectedSuggestionIndex = -1;
		};

		const applySuggestion = (suggestion: CommandSuggestion) => {
			const value = textarea.value;
			const trimmed = value.startsWith("/") ? value.slice(1) : value;
			const firstSpaceIndex = trimmed.search(/\s/);
			const rest =
				firstSpaceIndex === -1 ? "" : trimmed.slice(firstSpaceIndex);
			textarea.value = `/${suggestion.name}${rest || " "}`;
			hideSuggestions();
			textarea.focus();
			updateCharCount();
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment
			textarea.style.height = "auto";
			textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
		};

		const renderSuggestions = (suggestions: CommandSuggestion[]) => {
			suggestionList.empty();
			currentSuggestions = suggestions;
			selectedSuggestionIndex = suggestions.length > 0 ? 0 : -1;
			if (suggestions.length === 0) {
				hideSuggestions();
				return;
			}
			suggestionContainer.addClass("is-visible");
			suggestions.forEach((suggestion, index) => {
				const item = suggestionList.createDiv(
					"opencode-obsidian-command-suggestion",
				);
				if (index === selectedSuggestionIndex) {
					item.addClass("is-selected");
				}
				const nameEl = item.createSpan(
					"opencode-obsidian-command-suggestion-name",
				);
				nameEl.textContent = `/${suggestion.name}`;
				if (suggestion.description) {
					const descEl = item.createSpan(
						"opencode-obsidian-command-suggestion-description",
					);
					descEl.textContent = suggestion.description;
				}
				item.onclick = () => applySuggestion(suggestion);
			});
		};

		const showStatusSuggestion = (text: string) => {
			suggestionList.empty();
			const item = suggestionList.createDiv(
				"opencode-obsidian-command-suggestion opencode-obsidian-command-suggestion-empty",
			);
			item.textContent = text;
			suggestionContainer.addClass("is-visible");
			currentSuggestions = [];
			selectedSuggestionIndex = -1;
		};

		const updateCommandSuggestions = async () => {
			const value = textarea.value;
			if (!value.startsWith("/")) {
				hideSuggestions();
				return;
			}
			if (!this.plugin.opencodeClient) {
				showStatusSuggestion("Server not connected.");
				return;
			}
			if (this.commandSuggestions.length === 0) {
				if (!this.commandSuggestionsLoading) {
					showStatusSuggestion("Loading commands...");
				}
				await this.ensureCommandSuggestions();
			}
			const query = value.slice(1).split(/\s+/)[0]?.toLowerCase() ?? "";
			const matches = this.commandSuggestions.filter((suggestion) =>
				query ? suggestion.name.toLowerCase().startsWith(query) : true,
			);
			const limited = matches.slice(0, 8);
			if (limited.length === 0) {
				if (query) {
					showStatusSuggestion("No matching commands.");
				} else {
					hideSuggestions();
				}
				return;
			}
			renderSuggestions(limited);
		};

		const handleInputChange = () => {
			updateCharCount();
			void updateCommandSuggestions();
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment
			textarea.style.height = "auto";
			textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
		};

		textarea.oninput = handleInputChange;
		updateCharCount();

		const buttonContainer = inputContainer.createDiv(
			"opencode-obsidian-input-buttons",
		);

		const sendBtn = buttonContainer.createEl("button", {
			text: this.isStreaming ? "Stop" : "Send",
			cls: this.isStreaming ? "mod-warning" : "mod-cta",
		});

		const attachBtn = buttonContainer.createEl("button", {
			text: "📎",
			cls: "opencode-obsidian-attach-btn",
			attr: { title: "Attach image" },
		});

		const clearBtn = buttonContainer.createEl("button", {
			text: "🗑️",
			cls: "opencode-obsidian-clear-btn",
			attr: { title: "Clear input" },
		});

		if (this.isStreaming) {
			streamingStatus.textContent = "Streaming response...";
			streamingStatus.addClass("opencode-obsidian-streaming");
		} else {
			streamingStatus.textContent = "";
			streamingStatus.removeClass("opencode-obsidian-streaming");
		}

		sendBtn.onclick = async () => {
			if (this.isStreaming) {
				this.stopStreaming();
			} else {
				const message = textarea.value.trim();
				if (message) {
					await this.sendMessage(message);
					textarea.value = "";
					updateCharCount();
				}
			}
		};

		attachBtn.onclick = () => {
			void this.showAttachmentModal();
		};

		clearBtn.onclick = () => {
			if (textarea.value.trim()) {
				new ConfirmationModal(
					this.app,
					"Clear input?",
					"Are you sure you want to clear the current input?",
					() => {
						textarea.value = "";
						updateCharCount();
						textarea.focus();
					},
				).open();
			}
		};

		textarea.onkeydown = (e) => {
			if (suggestionContainer.hasClass("is-visible")) {
				if (e.key === "ArrowDown") {
					e.preventDefault();
					if (currentSuggestions.length > 0) {
						selectedSuggestionIndex =
							(selectedSuggestionIndex + 1) % currentSuggestions.length;
						renderSuggestions(currentSuggestions);
					}
					return;
				}
				if (e.key === "ArrowUp") {
					e.preventDefault();
					if (currentSuggestions.length > 0) {
						selectedSuggestionIndex =
							(selectedSuggestionIndex - 1 + currentSuggestions.length) %
							currentSuggestions.length;
						renderSuggestions(currentSuggestions);
					}
					return;
				}
				if (e.key === "Tab") {
					const suggestion = currentSuggestions[selectedSuggestionIndex];
					if (selectedSuggestionIndex >= 0 && suggestion) {
						e.preventDefault();
						applySuggestion(suggestion);
						return;
					}
				}
				if (e.key === "Escape") {
					e.preventDefault();
					hideSuggestions();
					return;
				}
				if (
					e.key === "Enter" &&
					!e.shiftKey &&
					selectedSuggestionIndex >= 0
				) {
					const suggestion = currentSuggestions[selectedSuggestionIndex];
					if (suggestion) {
						e.preventDefault();
						applySuggestion(suggestion);
						return;
					}
				}
			}
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				sendBtn.click();
			}
		};

		textarea.onblur = () => {
			setTimeout(() => {
				hideSuggestions();
			}, 150);
		};
	}

	updateStreamingStatus(isStreaming: boolean): void {
		this.isStreaming = isStreaming;
		const statusBar = document.querySelector(
			".opencode-obsidian-input-status",
		);
		if (!statusBar) return;

		const streamingStatus = statusBar.querySelector(
			".opencode-obsidian-streaming-status",
		) as HTMLElement;
		if (streamingStatus) {
			if (isStreaming) {
				streamingStatus.textContent = "Streaming response...";
				streamingStatus.addClass("opencode-obsidian-streaming");
			} else {
				streamingStatus.textContent = "";
				streamingStatus.removeClass("opencode-obsidian-streaming");
			}
		}

		const sendBtn = document.querySelector(
			".opencode-obsidian-input-buttons button.mod-cta, .opencode-obsidian-input-buttons button.mod-warning",
		) as HTMLElement;
		if (sendBtn) {
			sendBtn.textContent = isStreaming ? "Stop" : "Send";
			sendBtn.removeClass("mod-cta", "mod-warning");
			sendBtn.addClass(isStreaming ? "mod-warning" : "mod-cta");
		}
	}

	setCommandSuggestions(suggestions: CommandSuggestion[]): void {
		this.commandSuggestions = suggestions;
	}

	setCommandSuggestionsLoading(loading: boolean): void {
		this.commandSuggestionsLoading = loading;
	}
}
