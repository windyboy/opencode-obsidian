import type { Conversation } from "../../types";
import { Notice, App } from "obsidian";
import { ConfirmationModal } from "../modals/confirmation-modal";

export class ConversationSelectorComponent {
	constructor(
		private getConversations: () => Conversation[],
		private getActiveConversationId: () => string | null,
		private app: App,
		private switchConversation: (id: string) => Promise<void>,
		private renameConversation: (id: string, title: string) => Promise<void>,
		private deleteConversation: (id: string) => Promise<void>,
		private createNewConversation: () => Promise<void>,
		private exportConversation: (id: string) => Promise<void>,
	) {}

	private get conversations(): Conversation[] {
		return this.getConversations();
	}

	private get activeConversationId(): string | null {
		return this.getActiveConversationId();
	}

	render(container: HTMLElement): void {
		container.empty();

		if (this.conversations.length === 0) {
			container.createDiv(
				"opencode-obsidian-no-conversations",
			).textContent = "No conversations yet";
			return;
		}

		const tabsContainer = container.createDiv(
			"opencode-obsidian-tabs-container",
		);

		this.conversations.forEach((conv) => {
			const tab = tabsContainer.createDiv("opencode-obsidian-tab");
			tab.setAttribute("data-conversation-id", conv.id);

			if (conv.id === this.activeConversationId) {
				tab.addClass("active");
			}

			const title = tab.createSpan("opencode-obsidian-tab-title");
			title.textContent = conv.title;
			tab.setAttribute("title", conv.title);

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
				tab.insertBefore(input, title);

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

			closeBtn.onclick = (e) => {
				e.stopPropagation();
				void this.deleteConversation(conv.id);
			};

			tab.oncontextmenu = (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.showConversationContextMenu(tab, conv.id, e);
			};

			tab.onclick = () => {
				if (!isEditing) {
					void this.switchConversation(conv.id);
				}
			};
		});

		const newTab = tabsContainer.createDiv(
			"opencode-obsidian-tab opencode-obsidian-tab-new",
		);
		newTab.textContent = "+";
		newTab.setAttribute("title", "New conversation");
		newTab.onclick = () => {
			void this.createNewConversation();
		};
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

		const deleteItem = menu.createDiv("opencode-obsidian-context-menu-item");
		deleteItem.textContent = "Delete";
		deleteItem.addClass("opencode-obsidian-context-menu-item-danger");
		deleteItem.onclick = () => {
			menu.remove();
			void this.deleteConversation(conversationId);
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
