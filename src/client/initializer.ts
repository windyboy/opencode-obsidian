import { OpenCodeServerClient } from "./client";
import { ConnectionManager } from "../session/connection-manager";
import { PermissionCoordinator } from "../tools/obsidian/permission-coordinator";
import { App } from "obsidian";
import { SessionEventBus } from "../session/session-event-bus";
import { PermissionManager } from "../tools/obsidian/permission-manager";
import { AuditLogger } from "../tools/obsidian/audit-logger";
import { ErrorHandler, ErrorSeverity } from "../utils/error-handler";
import { Agent } from "../types";

/**
 * 客户端初始化结果
 */
export interface ClientSetup {
    client: OpenCodeServerClient;
    connectionManager: ConnectionManager;
    permissionCoordinator: PermissionCoordinator;
}

/**
 * 初始化客户端及相关组件（简单函数，避免过度抽象）
 */
export async function initializeClient(
    serverConfig: { url: string; opencodePath?: string },
    errorHandler: ErrorHandler,
    sessionEventBus: SessionEventBus,
    permissionManager: PermissionManager,
    auditLogger: AuditLogger,
    app: App,
    onAgentsLoaded?: (agents: Agent[]) => Promise<void>,
    getDefaultAgents?: () => Agent[]
): Promise<ClientSetup | null> {
    // 验证配置
    if (!serverConfig.url) {
        return null;
    }

    // 创建客户端
    const client = new OpenCodeServerClient(serverConfig, errorHandler);
    const connectionManager = new ConnectionManager(client, errorHandler);

    // 绑定事件回调
    bindClientCallbacks(client, sessionEventBus);

    // 创建权限协调器
    const permissionCoordinator = new PermissionCoordinator(
        client,
        sessionEventBus,
        permissionManager,
        auditLogger,
        errorHandler
    );
    permissionCoordinator.setApp(app);

    // 健康检查（阻塞），确保服务器可用再加载代理
    try {
        const healthResult = await client.healthCheck();
        const isHealthy = healthResult.isHealthy;
        if (isHealthy) {
            console.debug("[OpenCode Obsidian] Initial health check passed");
            // 服务器可用，加载 agents
            await loadAgents(client, errorHandler, onAgentsLoaded, getDefaultAgents);
        } else {
            // 服务器不可用，使用默认 agents
            errorHandler.handleError(
                new Error("Initial health check failed - server may be unavailable, using default agents"),
                { module: "ClientInitializer", function: "initializeClient" },
                ErrorSeverity.Warning
            );
            if (getDefaultAgents && onAgentsLoaded) {
                await onAgentsLoaded(getDefaultAgents());
            }
        }
    } catch (error) {
        // 健康检查失败，使用默认 agents
        errorHandler.handleError(
            error,
            { module: "ClientInitializer", function: "initializeClient" },
            ErrorSeverity.Warning
        );
        if (getDefaultAgents && onAgentsLoaded) {
            await onAgentsLoaded(getDefaultAgents());
        }
    }

    console.debug("[OpenCode Obsidian] OpenCode Server client initialized");
    return { client, connectionManager, permissionCoordinator };
}

/**
 * 重新初始化客户端（用于配置变更）
 */
export async function reinitializeClient(
    oldClient: OpenCodeServerClient | null,
    serverConfig: { url: string; opencodePath?: string },
    errorHandler: ErrorHandler,
    sessionEventBus: SessionEventBus,
    permissionManager: PermissionManager,
    auditLogger: AuditLogger,
    app: App,
    onAgentsLoaded?: (agents: Agent[]) => Promise<void>,
    getDefaultAgents?: () => Agent[]
): Promise<ClientSetup | null> {
    // 断开旧客户端
    if (oldClient) {
        await oldClient.disconnect();
    }

    // 创建新客户端
    return await initializeClient(
        serverConfig,
        errorHandler,
        sessionEventBus,
        permissionManager,
        auditLogger,
        app,
        onAgentsLoaded,
        getDefaultAgents
    );
}

// ===== 辅助函数 =====

function bindClientCallbacks(
    client: OpenCodeServerClient,
    eventBus: SessionEventBus
): void {
    client.onStreamToken((sessionId, token, done) =>
        eventBus.emitStreamToken({ sessionId, token, done })
    );
    client.onStreamThinking((sessionId, content) =>
        eventBus.emitStreamThinking({ sessionId, content })
    );
    client.onProgressUpdate((sessionId, progress) =>
        eventBus.emitProgressUpdate({ sessionId, progress })
    );
    client.onSessionEnd((sessionId, reason) =>
        eventBus.emitSessionEnd({ sessionId, reason })
    );
    client.onPermissionRequest((sessionId, requestId, operation, resourcePath, context) =>
        eventBus.emitPermissionRequest({
            sessionId,
            requestId,
            operation,
            resourcePath,
            context: context as {
                toolName?: string;
                args?: unknown;
                preview?: { originalContent?: string; newContent?: string; mode?: string };
            } | undefined,
        })
    );
    client.onError((error) => eventBus.emitError({ error }));
}

async function performHealthCheck(
    client: OpenCodeServerClient,
    errorHandler: ErrorHandler
): Promise<void> {
    try {
        const healthResult = await client.healthCheck();
        const isHealthy = healthResult.isHealthy;
        if (isHealthy) {
            console.debug("[OpenCode Obsidian] Initial health check passed");
        } else {
            errorHandler.handleError(
                new Error("Initial health check failed - server may be unavailable"),
                { module: "ClientInitializer", function: "performHealthCheck" },
                ErrorSeverity.Warning
            );
        }
    } catch (error) {
        errorHandler.handleError(
            error,
            { module: "ClientInitializer", function: "performHealthCheck" },
            ErrorSeverity.Warning
        );
    }
}

async function loadAgents(
    client: OpenCodeServerClient,
    errorHandler: ErrorHandler,
    onAgentsLoaded?: (agents: Agent[]) => Promise<void>,
    getDefaultAgents?: () => Agent[]
): Promise<void> {
    try {
        const agents = await client.listAgents();
        if (onAgentsLoaded) {
            await onAgentsLoaded(agents);
        }
    } catch (error) {
        // 加载失败时使用默认 agents
        if (getDefaultAgents && onAgentsLoaded) {
            await onAgentsLoaded(getDefaultAgents());
        }
        errorHandler.handleError(error, {
            module: "ClientInitializer",
            function: "loadAgents"
        }, ErrorSeverity.Warning);
    }
}
