import type { Conversation } from "../../types";
import type OpenCodeObsidianPlugin from "../../main";
import { ErrorSeverity } from "../../utils/error-handler";

export class ConversationSync {
	constructor(
		private plugin: OpenCodeObsidianPlugin,
		private getConversations: () => Conversation[],
		private getActiveConversationId: () => string | null,
		private setActiveConversationId: (id: string | null) => void,
		private setConversations: (convs: Conversation[]) => void,
		private saveConversations: () => Promise<void>,
		private updateConversationSelector: () => void,
		private updateMessages: () => void,
		private createNewConversation: () => Promise<void>,
		private findConversationBySessionId: (
			sessionId: string,
		) => Conversation | null,
	) {}

	private get conversations(): Conversation[] {
		return this.getConversations();
	}

	private get activeConversationId(): string | null {
		return this.getActiveConversationId();
	}

	async syncConversationsFromServer(): Promise<void> {
		if (!this.plugin.opencodeClient?.isConnected()) {
			if (this.conversations.length === 0) {
				await this.createNewConversation();
			}
			return;
		}

		try {
			// 1. 从本地存储获取所有保存的 sessionId
			const saved = (await this.plugin.loadData()) as {
				sessionIds?: string[];
			} | null;

			const savedSessionIds = saved?.sessionIds || [];
			const existingSessionIds = new Set(
				this.conversations
					.map((c) => c.sessionId)
					.filter((id): id is string => id !== null && id !== undefined),
			);

			// 2. 尝试从服务器恢复所有保存的 sessionId
			const restoredConversations: Conversation[] = [];

			for (const sessionId of savedSessionIds) {
				if (existingSessionIds.has(sessionId)) {
					continue;
				}

				try {
					const exists = await this.plugin.opencodeClient.ensureSession(
						sessionId,
					);
					if (exists) {
						const restoredConv: Conversation = {
							id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
							title: `Restored Session`,
							messages: [],
							createdAt: Date.now(),
							updatedAt: Date.now(),
							sessionId: sessionId,
						};
						restoredConversations.push(restoredConv);
						console.debug(
							`[OpenCodeObsidianView] Restored session ${sessionId} from server`,
						);
					}
				} catch (error) {
					console.debug(
						`[OpenCodeObsidianView] Could not restore session ${sessionId}:`,
						error,
					);
				}
			}

			// 3. 将恢复的会话添加到列表
			if (restoredConversations.length > 0) {
				const newConversations = [...this.conversations];
				newConversations.unshift(...restoredConversations);
				this.setConversations(newConversations);
				if (!this.activeConversationId && newConversations.length > 0) {
					this.setActiveConversationId(newConversations[0]?.id ?? null);
				}
				await this.saveConversations();
				this.updateConversationSelector();
				this.updateMessages();
			}

			// 4. 验证现有会话是否仍然存在
			for (const conv of this.conversations) {
				if (conv.sessionId) {
					try {
						const exists = await this.plugin.opencodeClient.ensureSession(
							conv.sessionId,
						);
						if (!exists) {
							console.debug(
								`[OpenCodeObsidianView] Session ${conv.sessionId} no longer exists on server`,
							);
						}
					} catch (error) {
						console.debug(
							`[OpenCodeObsidianView] Could not verify session ${conv.sessionId}:`,
							error,
						);
					}
				}
			}

			// 5. 如果同步后还是没有会话，创建新会话
			if (this.conversations.length === 0) {
				await this.createNewConversation();
			}

			console.debug(
				`[OpenCodeObsidianView] Conversation sync completed. Total: ${this.conversations.length}`,
			);
		} catch (error) {
			this.plugin.errorHandler.handleError(
				error,
				{
					module: "OpenCodeObsidianView",
					function: "syncConversationsFromServer",
					operation: "Syncing conversations from server",
				},
				ErrorSeverity.Warning,
			);
			if (this.conversations.length === 0) {
				await this.createNewConversation();
			}
		}
	}
}
