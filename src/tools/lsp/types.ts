export interface LSPPosition {
  line: number // 0-based
  character: number // 0-based
}

export interface LSPRange {
  start: LSPPosition
  end: LSPPosition
}

export interface LSPTextEdit {
  range: LSPRange
  newText: string
}

export interface LSPCodeAction {
  title: string
  kind?: string
  command?: {
    command: string
    arguments?: unknown[]
  }
  edit?: {
    changes?: Record<string, LSPTextEdit[]>
  }
  diagnostics?: unknown[]
}

export interface LSPRenameResult {
  changes: Record<string, LSPTextEdit[]>
}

export interface LSPClientConfig {
  serverPath?: string
  serverOptions?: {
    module?: string
    transport?: { kind: 'stdio' | 'socket' }
    args?: string[]
    options?: {
      cwd?: string
      env?: Record<string, string>
    }
  }
  initializationOptions?: Record<string, unknown>
}
