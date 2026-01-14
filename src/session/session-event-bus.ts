import type { ProgressUpdate } from "../opencode-server/types";

export interface StreamTokenEvent {
	sessionId: string;
	token: string;
	done: boolean;
}

export interface StreamThinkingEvent {
	sessionId: string;
	content: string;
}

export interface ProgressUpdateEvent {
	sessionId: string;
	progress: ProgressUpdate;
}

export interface SessionEndEvent {
	sessionId: string;
	reason?: string;
}

export interface ErrorEvent {
	error: Error;
}

type Unsubscribe = () => void;

export class SessionEventBus {
	private streamTokenListeners: Array<(event: StreamTokenEvent) => void> = [];
	private streamThinkingListeners: Array<(event: StreamThinkingEvent) => void> =
		[];
	private errorListeners: Array<(event: ErrorEvent) => void> = [];
	private progressUpdateListeners: Array<
		(event: ProgressUpdateEvent) => void
	> = [];
	private sessionEndListeners: Array<(event: SessionEndEvent) => void> = [];

	onStreamToken(listener: (event: StreamTokenEvent) => void): Unsubscribe {
		this.streamTokenListeners.push(listener);
		return () => {
			this.streamTokenListeners = this.streamTokenListeners.filter(
				(l) => l !== listener,
			);
		};
	}

	onStreamThinking(
		listener: (event: StreamThinkingEvent) => void,
	): Unsubscribe {
		this.streamThinkingListeners.push(listener);
		return () => {
			this.streamThinkingListeners = this.streamThinkingListeners.filter(
				(l) => l !== listener,
			);
		};
	}

	onProgressUpdate(
		listener: (event: ProgressUpdateEvent) => void,
	): Unsubscribe {
		this.progressUpdateListeners.push(listener);
		return () => {
			this.progressUpdateListeners = this.progressUpdateListeners.filter(
				(l) => l !== listener,
			);
		};
	}

	onSessionEnd(listener: (event: SessionEndEvent) => void): Unsubscribe {
		this.sessionEndListeners.push(listener);
		return () => {
			this.sessionEndListeners = this.sessionEndListeners.filter(
				(l) => l !== listener,
			);
		};
	}

	onError(listener: (event: ErrorEvent) => void): Unsubscribe {
		this.errorListeners.push(listener);
		return () => {
			this.errorListeners = this.errorListeners.filter((l) => l !== listener);
		};
	}

	emitStreamToken(event: StreamTokenEvent): void {
		for (const listener of this.streamTokenListeners) {
			listener(event);
		}
	}

	emitStreamThinking(event: StreamThinkingEvent): void {
		for (const listener of this.streamThinkingListeners) {
			listener(event);
		}
	}

	emitProgressUpdate(event: ProgressUpdateEvent): void {
		for (const listener of this.progressUpdateListeners) {
			listener(event);
		}
	}

	emitSessionEnd(event: SessionEndEvent): void {
		for (const listener of this.sessionEndListeners) {
			listener(event);
		}
	}

	emitError(event: ErrorEvent): void {
		for (const listener of this.errorListeners) {
			listener(event);
		}
	}
}

