import { Modal, Setting } from 'obsidian'
import type { App } from 'obsidian'
import type { ObsidianUpdateNoteInput } from './types'

/**
 * Permission request data structure
 */
export interface PermissionRequest {
  sessionId: string
  callId: string
  toolName: string
  args: unknown
  preview?: {
    originalContent?: string
    newContent: string
    mode?: string
    addedLines?: number
    removedLines?: number
  }
}

/**
 * Permission response callback
 */
export type PermissionResponseCallback = (allowed: boolean, reason?: string) => void

/**
 * Permission modal for requesting user approval for tool operations
 * Simplified preview display for update_note tool (no unified diff parsing needed)
 */
export class PermissionModal extends Modal {
  private request: PermissionRequest
  private onResponse: PermissionResponseCallback

  constructor(app: App, request: PermissionRequest, onResponse: PermissionResponseCallback) {
    super(app)
    this.request = request
    this.onResponse = onResponse
  }

  onOpen() {
    const { contentEl } = this
    contentEl.empty()

    // Title
    contentEl.createEl('h2', { text: 'Permission request' })

    // Tool information
    const toolInfo = contentEl.createDiv('opencode-obsidian-permission-tool-info')
    toolInfo.createEl('p', { text: `Tool: ${this.request.toolName}` })
    
    // Display file path if available
    if (this.request.args && typeof this.request.args === 'object' && 'path' in this.request.args) {
      toolInfo.createEl('p', { text: `File: ${(this.request.args as { path: string }).path}` })
    }

    // Preview content based on tool type
    if (this.request.toolName === 'obsidian.update_note') {
      this.renderUpdateNotePreview(contentEl)
    } else if (this.request.preview) {
      this.renderGenericPreview(contentEl)
    }

    // Action buttons
    const buttonContainer = contentEl.createDiv('opencode-obsidian-permission-buttons')
    
    new Setting(buttonContainer)
      .addButton(btn => btn
        .setButtonText('Deny')
        .setWarning()
        .onClick(() => {
          this.onResponse(false, 'User denied permission')
          this.close()
        })
      )
      .addButton(btn => btn
        .setButtonText('Approve')
        .setCta()
        .onClick(() => {
          this.onResponse(true)
          this.close()
        })
      )
  }

  /**
   * Render preview for update_note tool
   */
  private renderUpdateNotePreview(container: HTMLElement) {
    const args = this.request.args as ObsidianUpdateNoteInput | undefined
    
    if (!args) {
      container.createEl('p', { text: 'No preview available', cls: 'mod-warning' })
      return
    }

    const previewSection = container.createDiv('opencode-obsidian-permission-preview')
    
    // Display update mode
    if (args.mode) {
      const modeInfo = previewSection.createDiv('opencode-obsidian-permission-mode')
      modeInfo.createEl('strong', { text: 'Update mode: ' })
      modeInfo.createEl('span', { text: args.mode })
    }

    // Display statistics if available
    if (this.request.preview) {
      const stats = previewSection.createDiv('opencode-obsidian-permission-stats')
      
      if (args.mode === 'replace' && this.request.preview.removedLines !== undefined) {
        stats.createEl('span', { 
          text: `Removed: ${this.request.preview.removedLines} lines` 
        })
      }
      
      if (this.request.preview.addedLines !== undefined) {
        if (stats.textContent) stats.appendText(' | ')
        stats.createEl('span', { 
          text: `Added: ${this.request.preview.addedLines} lines` 
        })
      }
    }

    // Display content preview based on mode
    const contentPreview = previewSection.createDiv('opencode-obsidian-permission-content')
    
    switch (args.mode) {
      case 'replace':
        // Show original and new content side by side (or in tabs)
        this.renderReplacePreview(contentPreview, args)
        break
      
      case 'append':
        // Show existing content + new content to append
        this.renderAppendPreview(contentPreview, args)
        break
      
      case 'prepend':
        // Show new content to prepend + existing content
        this.renderPrependPreview(contentPreview, args)
        break
      
      case 'insert':
        // Show insertion point and content
        this.renderInsertPreview(contentPreview, args)
        break
      
      default:
        // Generic preview
        this.renderGenericPreview(contentPreview)
    }
  }

  /**
   * Render replace mode preview (show original and new content)
   */
  private renderReplacePreview(container: HTMLElement, args: ObsidianUpdateNoteInput) {
    const originalContent = this.request.preview?.originalContent
    const newContent = this.request.preview?.newContent || args.content

    if (originalContent) {
      const originalSection = container.createDiv('opencode-obsidian-permission-original')
      originalSection.createEl('h4', { text: 'Original content' })
      const originalCode = originalSection.createEl('pre', { 
        cls: 'opencode-obsidian-code-preview' 
      })
      originalCode.createEl('code', { text: originalContent })
    }

    const newSection = container.createDiv('opencode-obsidian-permission-new')
    newSection.createEl('h4', { text: 'New content' })
    const newCode = newSection.createEl('pre', { 
      cls: 'opencode-obsidian-code-preview' 
    })
    newCode.createEl('code', { text: newContent })
  }

  /**
   * Render append mode preview
   */
  private renderAppendPreview(container: HTMLElement, args: ObsidianUpdateNoteInput) {
    const originalContent = this.request.preview?.originalContent
    
    if (originalContent) {
      const existingSection = container.createDiv('opencode-obsidian-permission-existing')
      existingSection.createEl('h4', { text: 'Existing content' })
      const existingCode = existingSection.createEl('pre', { 
        cls: 'opencode-obsidian-code-preview' 
      })
      existingCode.createEl('code', { text: originalContent })
    }

    const appendSection = container.createDiv('opencode-obsidian-permission-append')
    appendSection.createEl('h4', { text: 'Content to append' })
    const appendCode = appendSection.createEl('pre', { 
      cls: 'opencode-obsidian-code-preview opencode-obsidian-code-added' 
    })
    appendCode.createEl('code', { text: args.content })
  }

  /**
   * Render prepend mode preview
   */
  private renderPrependPreview(container: HTMLElement, args: ObsidianUpdateNoteInput) {
    const prependSection = container.createDiv('opencode-obsidian-permission-prepend')
    prependSection.createEl('h4', { text: 'Content to prepend' })
    const prependCode = prependSection.createEl('pre', { 
      cls: 'opencode-obsidian-code-preview opencode-obsidian-code-added' 
    })
    prependCode.createEl('code', { text: args.content })

    const originalContent = this.request.preview?.originalContent
    if (originalContent) {
      const existingSection = container.createDiv('opencode-obsidian-permission-existing')
      existingSection.createEl('h4', { text: 'Existing content' })
      const existingCode = existingSection.createEl('pre', { 
        cls: 'opencode-obsidian-code-preview' 
      })
      existingCode.createEl('code', { text: originalContent })
    }
  }

  /**
   * Render insert mode preview
   */
  private renderInsertPreview(container: HTMLElement, args: ObsidianUpdateNoteInput) {
    const originalContent = this.request.preview?.originalContent || ''
    const lines = originalContent.split('\n')
    
    // Find insertion point
    let insertIndex = -1
    if (args.insertAt !== undefined) {
      insertIndex = Math.max(0, Math.min(lines.length, args.insertAt - 1))
    } else if (args.insertMarker) {
      insertIndex = lines.findIndex(line => line.includes(args.insertMarker!))
      if (insertIndex >= 0) insertIndex += 1
    }

    if (insertIndex >= 0) {
      const beforeSection = container.createDiv('opencode-obsidian-permission-before')
      beforeSection.createEl('h4', { text: 'Before insertion point' })
      const beforeCode = beforeSection.createEl('pre', { 
        cls: 'opencode-obsidian-code-preview' 
      })
      beforeCode.createEl('code', { text: lines.slice(0, insertIndex).join('\n') || '(start of file)' })

      const insertSection = container.createDiv('opencode-obsidian-permission-insert')
      insertSection.createEl('h4', { text: `Content to insert at line ${insertIndex + 1}` })
      const insertCode = insertSection.createEl('pre', { 
        cls: 'opencode-obsidian-code-preview opencode-obsidian-code-added' 
      })
      insertCode.createEl('code', { text: args.content })

      const afterSection = container.createDiv('opencode-obsidian-permission-after')
      afterSection.createEl('h4', { text: 'After insertion point' })
      const afterCode = afterSection.createEl('pre', { 
        cls: 'opencode-obsidian-code-preview' 
      })
      afterCode.createEl('code', { text: lines.slice(insertIndex).join('\n') || '(end of file)' })
    } else {
      // Fallback if insertion point not found
      container.createEl('p', { 
        text: `Insertion point not found. Content to insert:`, 
        cls: 'mod-warning' 
      })
      const insertCode = container.createEl('pre', { 
        cls: 'opencode-obsidian-code-preview' 
      })
      insertCode.createEl('code', { text: args.content })
    }
  }

  /**
   * Render generic preview (for other tools)
   */
  private renderGenericPreview(container: HTMLElement) {
    if (!this.request.preview) {
      container.createEl('p', { text: 'No preview available', cls: 'mod-warning' })
      return
    }

    if (this.request.preview.originalContent) {
      const originalSection = container.createDiv('opencode-obsidian-permission-original')
      originalSection.createEl('h4', { text: 'Original' })
      const originalCode = originalSection.createEl('pre', { 
        cls: 'opencode-obsidian-code-preview' 
      })
      originalCode.createEl('code', { text: this.request.preview.originalContent })
    }

    const newSection = container.createDiv('opencode-obsidian-permission-new')
    newSection.createEl('h4', { text: 'Modified' })
    const newCode = newSection.createEl('pre', { 
      cls: 'opencode-obsidian-code-preview' 
    })
    newCode.createEl('code', { text: this.request.preview.newContent })
  }

  onClose() {
    const { contentEl } = this
    contentEl.empty()
  }
}
