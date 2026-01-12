# 调试指南

本指南介绍如何调试 OpenCode Obsidian 插件。

## 快速开始

### 1. 使用调试工具检查插件

运行调试工具检查插件文件：

```bash
pnpm run debug
```

这个工具会检查：

-   ✅ 所有必需文件是否存在
-   ✅ manifest.json 配置是否正确
-   ✅ main.js 导出格式是否正确
-   ✅ TypeScript 源文件是否完整

### 2. 开发模式（带热重载）

启动开发模式，代码更改会自动重新构建：

```bash
pnpm run dev
```

开发模式特点：

-   🔄 自动监听文件变化并重新构建
-   🗺️ 包含 sourcemap，便于调试
-   📝 详细的构建日志

### 3. 在 Obsidian 中调试

#### 打开开发者工具

**方法 1：使用快捷键（推荐）**

-   **macOS**：按 `Cmd + Option + I` (Command + Option + I)
-   **Windows/Linux**：按 `Ctrl + Shift + I`

**方法 2：通过菜单**

-   **macOS**：点击顶部菜单栏的 `View` → `Toggle Developer Tools` / `切换开发者工具`
-   **Windows/Linux**：点击顶部菜单栏的 `View` → `Toggle Developer Tools` / `切换开发者工具`

> 💡 **提示**：如果菜单中没有找到，直接使用快捷键 `Cmd+Option+I` (Mac) 或 `Ctrl+Shift+I` (Windows/Linux) 是最可靠的方法。

#### 查看控制台日志

插件会在控制台输出以下信息：

-   连接状态
-   服务器事件
-   错误信息
-   调试日志

#### 检查插件加载

在控制台中运行：

```javascript
const plugin = app.plugins.plugins["opencode-obsidian"];
console.log("OpenCode Client:", plugin.openCodeClient);

// 检查连接状态
console.log("Connection Status:", plugin.openCodeClient.isConnected);

// 查看任务编排器状态
console.log("Orchestrator:", plugin.agentOrchestrator);

// 查看 MCP 管理器状态
console.log("MCP Manager:", plugin.mcpManager);
```

## VS Code 调试配置

### 使用 VS Code 任务

1. 按 `Cmd+Shift+P` (Mac) 或 `Ctrl+Shift+P` (Windows/Linux)
2. 输入 "Tasks: Run Task"
3. 选择：
    - `Build Plugin` - 构建生产版本
    - `Watch Plugin (Dev)` - 开发模式（监听文件变化）
    - `Lint` - 代码检查

### 使用 VS Code 调试

1. 打开调试面板 (`Cmd+Shift+D` / `Ctrl+Shift+D`)
2. 选择配置：
    - `Build Plugin` - 构建插件
    - `Watch Plugin (Dev Mode)` - 开发模式
3. 按 F5 开始调试

## 常见调试场景

### 插件无法加载

1. 运行 `pnpm run debug` 检查文件
2. 检查 Obsidian 控制台错误
3. 确认 `main.js` 导出格式正确：
    ```bash
    tail -1 main.js
    # 应该显示: module.exports = F;
    ```

### 连接失败

在控制台检查：

```javascript
const plugin = app.plugins.plugins["opencode-obsidian"];
console.log("Server URL:", plugin.settings.serverUrl);
console.log("Is Connected:", plugin.openCodeClient.isConnected);

// 手动连接测试
plugin.openCodeClient.connect();
```

### 查看插件设置

```javascript
const plugin = app.plugins.plugins["opencode-obsidian"];
console.log("Settings:", plugin.settings);
```

### 查看活动视图

```javascript
const plugin = app.plugins.plugins["opencode-obsidian"];
const view = plugin.getActiveView();
console.log("Active view:", view);
```

## 开发工作流

### 推荐工作流

1. **启动开发模式**

    ```bash
    pnpm run dev
    ```

2. **在另一个终端检查代码**

    ```bash
    pnpm run check  # TypeScript 类型检查
    pnpm run lint   # 代码风格检查
    ```

3. **在 Obsidian 中测试**

    - 确保插件已链接到 vault
    - 修改代码后，Obsidian 会自动重新加载（如果启用了热重载）
    - 或手动重新加载：`Cmd/Ctrl + R`

4. **查看日志**
    - 打开 Obsidian 开发者工具
    - 查看 Console 标签页

### 链接插件到 Vault（开发）

```bash
# macOS/Linux
ln -s $(pwd) ~/YourVault/.obsidian/plugins/opencode-obsidian

# Windows (PowerShell)
New-Item -ItemType SymbolicLink -Path "$env:APPDATA\Obsidian\plugins\opencode-obsidian" -Target $(Get-Location)
```

## 调试技巧

### 1. 添加调试日志

在代码中添加：

```typescript
console.log("Debug info:", { variable1, variable2 });
console.error("Error:", error);
```

### 2. 使用断点

在 VS Code 中：

-   点击行号左侧设置断点
-   使用 `debugger;` 语句（开发模式）

### 3. 检查网络请求

在 Obsidian 开发者工具中：

-   打开 Network 标签页
-   查看与 OpenCode 服务器的通信

### 4. 检查 DOM

在 Obsidian 开发者工具中：

-   使用 Elements/Inspector 标签页
-   检查插件视图的 DOM 结构

## 故障排除

### 构建错误

```bash
# 清理并重新构建
rm -f main.js
pnpm run build
```

### TypeScript 错误

```bash
# 检查类型错误
pnpm run check
```

### 插件不更新

1. 确保开发模式正在运行
2. 手动重新加载 Obsidian：
    - **快捷键**: `Cmd + R` (macOS) 或 `Ctrl + R` (Windows/Linux)
    - **菜单**: 顶部菜单栏 → `View` → `Reload App` / `重新加载应用`
3. 检查文件是否被正确构建：
    ```bash
    ls -lh main.js
    ```

## 有用的命令

```bash
# 调试检查
pnpm run debug

# 开发模式（监听）
pnpm run dev

# 生产构建
pnpm run build

# 类型检查
pnpm run check

# 代码检查
pnpm run lint
```

## 获取帮助

如果遇到问题：

1. 运行 `pnpm run debug` 检查配置
2. 查看 Obsidian 控制台错误
3. 检查 `main.js` 文件大小和导出格式
4. 确认所有依赖已安装：`pnpm install`
