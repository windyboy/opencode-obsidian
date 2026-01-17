import type { Conversation } from "../../types";
import { Notice, App } from "obsidian";
import { ConfirmationModal } from "../modals/confirmation-modal";

export class ConversationSelectorComponent {
	private isLoading = false;

	constructor(
		private getConversations: () => Conversation[],
		private getActiveConversationId: () => string | null,
		private app: App,
		private switchConversation: (id: string) => Promise<void>,
		private renameConversation: (id: string, title: string) => Promise<void>,
		private deleteConversation: (id: string) => Promise<void>,
		private createNewConversation: () => Promise<void>,
		private exportConversation: (id: string) => Promise<void>,
		private getIsLoading?: () => boolean,
		private syncFromServer?: () => Promise<void>,
		private viewSessionDiff?: (sessionId: string) => Promise<void>,
		private forkConversation?: (id: string) => Promise<void>,
	) {}

	private get conversations(): Conversation[] {
		return this.getConversations();
	}

	private get activeConversationId(): string | null {
		return this.getActiveConversationId();
	}

	/**
	 * Format timestamp as relative time (e.g., "2 min ago", "1 hour ago")
	 */
	private formatRelativeTime(timestamp: number): string {
		const now = Date.now();
		const diff = now - timestamp;
		const seconds = Math.floor(diff / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (seconds < 60) {
			return "just now";
		} else if (minutes < 60) {
			return `${minutes} min${minutes !== 1 ? 's' : ''} ago`;
		} else if (hours < 24) {
			return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
		} else if (days < 7) {
			return `${days} day${days !== 1 ? 's' : ''} ago`;
		} else {
			// Format as date for older conversations
			const date = new Date(timestamp);
			return date.toLocaleDateString();
		}
	}

	render(container: HTMLElement): void {
		container.empty();

		// Check if loading
		const isLoading = this.getIsLoading?.() ?? false;

		if (this.conversations.length === 0) {
			const emptyDiv = container.createDiv("opencode-obsidian-no-conversations");
			if (isLoading) {
				const spinner = emptyDiv.createSpan("opencode-obsidian-spinner opencode-obsidian-spinner-large");
				emptyDiv.createSpan({ text: " Loading conversations..." });
			} else {
				emptyDiv.textContent = "No conversations yet";
			}
			return;
		}

		const tabsContainer = container.createDiv(
			"opencode-obsidian-tabs-container",
		);

		// Add loading indicator if loading
		if (isLoading) {
			tabsContainer.addClass("opencode-obsidian-tabs-loading");
		}

		this.conversations.forEach((conv) => {
			const tab = tabsContainer.createDiv("opencode-obsidian-tab");
			tab.setAttribute("data-conversation-id", conv.id);

			if (conv.id === this.activeConversationId) {
				tab.addClass("active");
			}

			// Create tab content container
			const tabContent = tab.createDiv("opencode-obsidian-tab-content");

			// Add session indicator for conversations with active server sessions
			if (conv.sessionId) {
				const sessionIndicator = tab.createSpan("opencode-obsidian-tab-session-indicator");
				sessionIndicator.textContent = "●";
				sessionIndicator.setAttribute("title", "Synced with server");
			}

			const title = tabContent.createSpan("opencode-obsidian-tab-title");
			title.textContent = conv.title;

			// Add session metadata (message count, last updated)
			const metadata = tabContent.createDiv("opencode-obsidian-tab-metadata");
			const messageCount = conv.messages.length;
			const lastUpdated = this.formatRelativeTime(conv.updatedAt);
			metadata.textContent = `${messageCount} msg${messageCount !== 1 ? 's' : ''} • ${lastUpdated}`;

			// Update tooltip to include metadata
			const tooltipText = `${conv.title}\n${messageCount} message${messageCount !== 1 ? 's' : ''} • Last updated ${lastUpdated}`;
			tab.setAttribute("title", tooltipText);

			let isEditing = false;
			title.ondblclick = (e) => {
				e.stopPropagation();
				if (isEditing) return;
				isEditing = true;

				const input = document.createElement("input");
				input.type = "text";
				input.value = conv.title;
				input.className = "opencode-obsidian-tab-title-edit";
				input.style.width = `${title.offsetWidth}px`;
				input.style.minWidth = "120px";
				input.style.maxWidth = "300px";

				title.style.display = "none";
				tabContent.insertBefore(input, title);

				input.focus();
				input.select();

				const saveTitle = async () => {
					const newTitle = input.value.trim();
					if (newTitle && newTitle !== conv.title) {
						await this.renameConversation(conv.id, newTitle);
					}
					input.remove();
					title.style.display = "";
					isEditing = false;
				};

				const cancelEdit = () => {
					input.remove();
					title.style.display = "";
					isEditing = false;
				};

				input.onblur = () => {
					setTimeout(saveTitle, 200);
				};

				input.onkeydown = (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						e.stopPropagation();
						void saveTitle();
					} else if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						cancelEdit();
					}
				};
			};

			const closeBtn = tab.createSpan("opencode-obsidian-tab-close");
			closeBtn.textContent = "×";
			closeBtn.setAttribute("title", "Delete conversation");

			closeBtn.onclick = async (e) => {
				e.stopPropagation();
				if (isLoading) return; // Prevent action during loading
				
				// Show confirmation modal
				const hasSession = !!conv.sessionId;
				const message = hasSession
					? `Are you sure you want to delete "${conv.title}"? This will also delete the session from the server.`
					: `Are you sure you want to delete "${conv.title}"?`;
				
				new ConfirmationModal(
					this.app,
					"Delete conversation",
					message,
					async () => {
						await this.deleteConversation(conv.id);
					}
				).open();
			};

			tab.oncontextmenu = (e) => {
				if (isLoading) return; // Prevent action during loading
				e.preventDefault();
				e.stopPropagation();
				this.showConversationContextMenu(tab, conv.id, e);
			};

			tab.onclick = async () => {
				if (!isEditing && !isLoading) { // Prevent action during loading
					await this.switchConversation(conv.id);
				}
			};
		});

		const newTab = tabsContainer.createDiv(
			"opencode-obsidian-tab opencode-obsidian-tab-new",
		);
		if (isLoading) {
			const spinner = newTab.createSpan("opencode-obsidian-spinner");
			newTab.addClass("opencode-obsidian-tab-disabled");
		} else {
			newTab.textContent = "+";
		}
		newTab.setAttribute("title", isLoading ? "Loading..." : "New conversation");
		newTab.onclick = async () => {
			if (!isLoading) {
				await this.createNewConversation();
			}
		};

		// Add sync button if syncFromServer callback is provided
		if (this.syncFromServer) {
			const syncTab = tabsContainer.createDiv(
				"opencode-obsidian-tab opencode-obsidian-tab-sync",
			);
			if (isLoading) {
				const spinner = syncTab.createSpan("opencode-obsidian-spinner");
				syncTab.addClass("opencode-obsidian-tab-disabled");
			} else {
				syncTab.innerHTML = "↻";
			}
			syncTab.setAttribute("title", isLoading ? "Syncing..." : "Sync from server");
			syncTab.onclick = async () => {
				if (!isLoading && this.syncFromServer) {
					await this.syncFromServer();
				}
			};
		}
	}

	private showConversationContextMenu(
		tab: HTMLElement,
		conversationId: string,
		event: MouseEvent,
	): void {
		const existingMenu = document.querySelector(
			".opencode-obsidian-context-menu",
		);
		if (existingMenu) {
			existingMenu.remove();
		}

		const conversation = this.conversations.find(
			(c) => c.id === conversationId,
		);
		if (!conversation) return;

		const menu = document.createElement("div");
		menu.className = "opencode-obsidian-context-menu";
		menu.style.position = "fixed";
		menu.style.left = `${event.clientX}px`;
		menu.style.top = `${event.clientY}px`;
		menu.style.zIndex = "10000";

		const renameItem = menu.createDiv("opencode-obsidian-context-menu-item");
		renameItem.textContent = "Rename";
		renameItem.onclick = async () => {
			menu.remove();
			const titleEl = tab.querySelector(
				".opencode-obsidian-tab-title",
			) as HTMLElement;
			if (titleEl) {
				titleEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
			}
		};

		const exportItem = menu.createDiv("opencode-obsidian-context-menu-item");
		exportItem.textContent = "Export";
		exportItem.onclick = () => {
			menu.remove();
			void this.exportConversation(conversationId);
		};

		// Add "View changes" option if session has a sessionId and callback is provided
		if (conversation.sessionId && this.viewSessionDiff) {
			const viewChangesItem = menu.createDiv("opencode-obsidian-context-menu-item");
			viewChangesItem.textContent = "View changes";
			viewChangesItem.onclick = () => {
				menu.remove();
				if (conversation.sessionId && this.viewSessionDiff) {
					void this.viewSessionDiff(conversation.sessionId);
				}
			};
		}

		// Add "Fork session" option if session has a sessionId and callback is provided
		if (conversation.sessionId && this.forkConversation) {
			const forkItem = menu.createDiv("opencode-obsidian-context-menu-item");
			forkItem.textContent = "Fork session";
			forkItem.onclick = () => {
				menu.remove();
				if (this.forkConversation) {
					void this.forkConversation(conversationId);
				}
			};
		}

		const deleteItem = menu.createDiv("opencode-obsidian-context-menu-item");
		deleteItem.textContent = "Delete";
		deleteItem.addClass("opencode-obsidian-context-menu-item-danger");
		deleteItem.onclick = () => {
			menu.remove();
			
			// Show confirmation modal
			const hasSession = !!conversation.sessionId;
			const message = hasSession
				? `Are you sure you want to delete "${conversation.title}"? This will also delete the session from the server.`
				: `Are you sure you want to delete "${conversation.title}"?`;
			
			new ConfirmationModal(
				this.app,
				"Delete conversation",
				message,
				async () => {
					await this.deleteConversation(conversationId);
				}
			).open();
		};

		document.body.appendChild(menu);

		const closeMenu = (e: MouseEvent) => {
			if (!menu.contains(e.target as Node)) {
				menu.remove();
				document.removeEventListener("click", closeMenu);
			}
		};

		setTimeout(() => {
			document.addEventListener("click", closeMenu);
		}, 0);
	}
}
