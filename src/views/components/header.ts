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
		const lastError = this.plugin.opencodeClient?.getLastConnectionError();

		if (!this.plugin.settings.opencodeServer?.url) {
			statusEl.addClass("disconnected");
			statusEl.textContent = "● Server URL not configured";
			statusEl.setAttribute("title", "Configure OpenCode Server URL in settings");
		} else if (connectionState === "error") {
			statusEl.addClass("disconnected");
			const errorMessage = lastError?.message || "Connection error";
			statusEl.textContent = "● Connection error";
			statusEl.setAttribute("title", `Error: ${errorMessage}`);
		} else if (connectionState === "reconnecting") {
			statusEl.addClass("reconnecting");
			statusEl.textContent = "● Reconnecting...";
			statusEl.setAttribute("title", "Attempting to reconnect to server");
		} else if (connectionState === "connecting") {
			statusEl.addClass("connecting");
			statusEl.textContent = "● Connecting...";
			statusEl.setAttribute("title", "Connecting to server");
		} else if (!isConnected) {
			statusEl.addClass("disconnected");
			statusEl.textContent = "● Not connected";
			const errorMessage = lastError?.message || "Not connected to server";
			statusEl.setAttribute("title", errorMessage);
		} else if (isHealthy) {
			statusEl.addClass("connected");
			statusEl.textContent = "● Connected";
			statusEl.setAttribute("title", `Connected to ${this.plugin.settings.opencodeServer.url}`);
		} else {
			statusEl.addClass("disconnected");
			statusEl.textContent = "● Connected but unhealthy";
			statusEl.setAttribute("title", "Server is responding but health check failed");
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
