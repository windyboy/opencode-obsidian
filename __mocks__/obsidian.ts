/**
 * Mock Obsidian API for testing
 * This file provides mock implementations of Obsidian classes and types
 */

// Mock Modal class
export class Modal {
  app: unknown
  contentEl: HTMLElement
  titleEl: HTMLElement

  constructor(app: unknown) {
    this.app = app
    this.contentEl = document.createElement('div')
    this.titleEl = document.createElement('div')
  }

  onOpen(): void {
    // Mock implementation
  }

  onClose(): void {
    // Mock implementation
  }

  open(): void {
    this.onOpen()
  }

  close(): void {
    this.onClose()
  }
}

// Mock Setting class
export class Setting {
  private containerEl: HTMLElement
  private settingEl: HTMLElement

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl
    this.settingEl = document.createElement('div')
    this.containerEl.appendChild(this.settingEl)
  }

  setName(name: string): Setting {
    return this
  }

  setDesc(desc: string): Setting {
    return this
  }

  addButton(callback: (btn: unknown) => unknown): Setting {
    const btn = {
      setButtonText: (text: string) => btn,
      setWarning: () => btn,
      setCta: () => btn,
      onClick: (fn: () => void) => { fn() }
    }
    callback(btn)
    return this
  }

  addToggle(callback: (toggle: unknown) => unknown): Setting {
    const toggle = {
      setValue: (value: boolean) => toggle,
      onChange: (fn: (value: boolean) => void) => { fn(false) }
    }
    callback(toggle)
    return this
  }

  addText(callback: (text: unknown) => unknown): Setting {
    return this
  }
}

// Mock Notice class
export class Notice {
  message: string
  timeout: number

  constructor(message: string, timeout?: number) {
    this.message = message
    this.timeout = timeout || 0
  }
}

// Mock Plugin class
export class Plugin {
  app: unknown
  manifest: unknown

  constructor(app: unknown, manifest: unknown) {
    this.app = app
    this.manifest = manifest
  }

  async onload(): Promise<void> {
    // Mock implementation
  }

  onunload(): void {
    // Mock implementation
  }
}

// Mock WorkspaceLeaf
export class WorkspaceLeaf {
  view: unknown
  constructor() {
    this.view = null
  }
}

// Mock ItemView
export class ItemView {
  containerEl: HTMLElement
  constructor(leaf: WorkspaceLeaf) {
    this.containerEl = document.createElement('div')
  }

  getViewType(): string {
    return 'mock-view'
  }

  getDisplayText(): string {
    return 'Mock view'
  }

  getIcon(): string {
    return 'file'
  }
}

// Mock types (interfaces)
export interface Vault {
  getAbstractFileByPath(path: string): TAbstractFile | null
  read(file: TFile): Promise<string>
  modify(file: TFile, data: string): Promise<void>
  create(path: string, data: string): Promise<TFile>
  createFolder(path: string): Promise<TFolder>
  getMarkdownFiles(): TFile[]
  getRoot(): TFolder
}

export interface TFile extends TAbstractFile {
  path: string
  name: string
  basename: string
  extension: string
  stat: {
    size: number
    ctime: number
    mtime: number
  }
  parent: TFolder | null
}

export interface TFolder extends TAbstractFile {
  path: string
  name: string
  children: TAbstractFile[]
  parent: TFolder | null
}

export interface TAbstractFile {
  path: string
  name: string
  parent: TFolder | null
}

export interface App {
  vault: Vault
  workspace: unknown
  metadataCache: MetadataCache
}

export interface MetadataCache {
  getFileCache(file: TFile): CachedMetadata | null
  getBacklinksForFile(file: TFile): {
    data: Record<string, Array<{ path: string }>>
  } | null
}

export interface CachedMetadata {
  frontmatter?: Record<string, unknown>
  tags?: Array<{ tag: string }>
  links?: Array<{ link: string; resolved?: boolean }>
}

export interface PluginSettingTab {
  containerEl: HTMLElement
  display(): void
}

// Mock requestUrl function
export async function requestUrl(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  contentType?: string;
  body?: unknown;
}): Promise<{status: number; headers: Record<string, string>; text: string; json: unknown}> {
  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    text: JSON.stringify({ isHealthy: true }),
    json: { isHealthy: true }
  };
}

// Export all types
export type {
  Vault,
  TFile,
  TFolder,
  TAbstractFile,
  App,
  MetadataCache,
  CachedMetadata,
  PluginSettingTab
}
