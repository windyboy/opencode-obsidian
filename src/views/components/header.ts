import type OpenCodeObsidianPlugin from "../../main";

export class HeaderComponent {
	constructor(
		private plugin: OpenCodeObsidianPlugin,
		private getLastHealthCheckResult: () => boolean | null,
		private performHealthCheck: () => Promise<void>,
		private createNewConversation: () => Promise<void>,
	) {}

	render(container: HTMLElement): void {
		container.empty();

		const statusEl = container.createDiv("opencode-obsidian-status");

		const connectionState =
			this.plugin.connectionManager?.getDiagnostics().state ??
			(this.plugin.opencodeClient?.getConnectionState() ?? "disconnected");
		const isConnected = connectionState === "connected";
		const isHealthy = this.getLastHealthCheckResult() ?? false;

		if (!this.plugin.settings.opencodeServer?.url) {
			statusEl.addClass("disconnected");
			statusEl.textContent = "● Server URL not configured";
		} else if (connectionState === "error") {
			statusEl.addClass("disconnected");
			statusEl.textContent = "● Connection error";
		} else if (!isConnected) {
			statusEl.addClass("disconnected");
			statusEl.textContent = "● Not connected";
		} else if (isHealthy) {
			statusEl.addClass("connected");
			statusEl.textContent = "● Connected and healthy";
		} else {
			statusEl.addClass("disconnected");
			statusEl.textContent = "● Connected but unhealthy";
		}

		const controls = container.createDiv("opencode-obsidian-controls");

		const checkConnBtn = controls.createEl("button", {
			text: "Check connection",
			cls: "mod-small",
		});
		checkConnBtn.onclick = () => {
			void this.performHealthCheck();
		};

		const newConvBtn = controls.createEl("button", {
			text: "New chat",
			cls: "mod-cta",
		});
		newConvBtn.onclick = () => {
			void this.createNewConversation();
		};
	}

}
