# 快速开始 - 调试指南

## 🚀 打开 Obsidian 开发者工具

### 最简单的方法：使用快捷键

-   **macOS**: `Cmd + Option + I` (Command + Option + I)
-   **Windows/Linux**: `Ctrl + Shift + I`

### 通过菜单（如果快捷键不起作用）

-   **macOS**: 顶部菜单栏 → `View` → `Toggle Developer Tools` / `切换开发者工具`
-   **Windows/Linux**: 顶部菜单栏 → `View` → `Toggle Developer Tools` / `切换开发者工具`

> ⚠️ **注意**：如果菜单中没有找到，直接使用快捷键是最可靠的方法。

## 📋 快速检查插件

运行调试工具：

```bash
pnpm run debug
```

## 🔧 开发模式

启动开发模式（自动监听文件变化）：

```bash
pnpm run dev
```

## 📝 查看日志

1. 打开开发者工具（使用上面的快捷键）
2. 点击 **Console** 标签页
3. 查看插件输出的日志和错误信息

## 🐛 常见问题

### 插件无法加载？

```bash
# 1. 检查文件
pnpm run debug

# 2. 重新构建
pnpm run build

# 3. 在 Obsidian 中重新加载
```

重新加载 Obsidian：

-   **快捷键**: `Cmd + R` (macOS) 或 `Ctrl + R` (Windows/Linux)
-   **菜单**: 顶部菜单栏 → `View` → `Reload App` / `重新加载应用`

### 查看插件状态

在 Obsidian 开发者工具的 Console 中运行：

```javascript
// 检查插件是否加载
app.plugins.plugins["opencode-obsidian"];

// 查看客户端状态
app.plugins.plugins["opencode-obsidian"].opencodeClient?.isConnected();

// 查看当前会话 ID
app.plugins.plugins["opencode-obsidian"].opencodeClient?.getCurrentSessionId();
```

### OpenCode Server 连接

1. 打开插件设置
2. 配置 OpenCode Server URL（例如：`http://127.0.0.1:4096`）
3. 测试连接
4. 保存设置

## 📚 更多信息

查看 [DEBUG.md](./DEBUG.md) 获取完整的调试指南。
