import { ItemView, WorkspaceLeaf, Notice, Modal, Setting } from 'obsidian'
import type OpenCodeObsidianPlugin from './main'
import type { Conversation, Message, ToolUse, ToolResult } from './types'
import type { ResponseChunk } from './embedded-ai-client'
import { ModelSelectorModal } from './model-selector'

export const VIEW_TYPE_OPENCODE_OBSIDIAN = 'opencode-obsidian-view'

export class OpenCodeObsidianView extends ItemView {
  plugin: OpenCodeObsidianPlugin
  private conversations: Conversation[] = []
  private activeConversationId: string | null = null
  private isStreaming = false
  private currentAbortController: AbortController | null = null

  constructor(leaf: WorkspaceLeaf, plugin: OpenCodeObsidianPlugin) {
    super(leaf)
    this.plugin = plugin
  }

  getViewType() {
    return VIEW_TYPE_OPENCODE_OBSIDIAN
  }

  getDisplayText() {
    return 'OpenCode'
  }

  getIcon() {
    return 'bot'
  }

  async onOpen() {
    const container = this.containerEl.children[1]
    if (!container) return
    container.empty()
    container.addClass('opencode-obsidian-view')

    this.renderView()
    await this.loadConversations()
  }

  async onClose() {
    // Clean up any ongoing streams
    if (this.currentAbortController) {
      this.currentAbortController.abort()
    }
  }

  private renderView() {
    const container = this.containerEl.children[1]
    if (!container) return
    container.empty()

    // Header with connection status and controls
    const header = container.createDiv('opencode-obsidian-header')
    this.renderHeader(header)

    // Conversation list/selector
    const conversationSelector = container.createDiv('opencode-obsidian-conversation-selector')
    this.renderConversationSelector(conversationSelector)

    // Messages container
    const messagesContainer = container.createDiv('opencode-obsidian-messages')
    this.renderMessages(messagesContainer)

    // Input area
    const inputArea = container.createDiv('opencode-obsidian-input')
    this.renderInputArea(inputArea)
  }

  private renderHeader(container: HTMLElement) {
    container.empty()

    const statusEl = container.createDiv('opencode-obsidian-status')
    const availableProviders = this.plugin.providerManager.getAvailableProviders()
    const providerCount = availableProviders.length
    
    if (providerCount === 0) {
      statusEl.addClass('disconnected')
      statusEl.textContent = '● No providers configured'
    } else {
      statusEl.addClass('connected')
      statusEl.textContent = `● ${providerCount} provider(s) available`
    }

    const controls = container.createDiv('opencode-obsidian-controls')
    
    // New conversation button
    const newConvBtn = controls.createEl('button', {
      text: 'New Chat',
      cls: 'mod-cta'
    })
    newConvBtn.onclick = () => {
      this.createNewConversation()
    }
  }

  private renderConversationSelector(container: HTMLElement) {
    container.empty()

    if (this.conversations.length === 0) {
      container.createDiv('opencode-obsidian-no-conversations').textContent = 'No conversations yet'
      return
    }

    const selectContainer = container.createDiv('opencode-obsidian-conversation-select-container')
    const select = selectContainer.createEl('select', { cls: 'opencode-obsidian-conversation-select' })
    
    this.conversations.forEach(conv => {
      const providerLabel = conv.providerID ? ` [${conv.providerID.charAt(0).toUpperCase() + conv.providerID.slice(1)}]` : ''
      const option = select.createEl('option', {
        value: conv.id,
        text: `${conv.title}${providerLabel}`
      })
      if (conv.id === this.activeConversationId) {
        option.selected = true
      }
    })

    select.onchange = () => {
      this.switchConversation(select.value)
    }

    // Add provider selector for active conversation
    const activeConv = this.getActiveConversation()
    if (activeConv) {
      const providerContainer = selectContainer.createDiv('opencode-obsidian-provider-selector')
      providerContainer.createSpan({ text: 'Provider: ', cls: 'opencode-obsidian-provider-label' })
      
      const providerSelect = providerContainer.createEl('select', { 
        cls: 'opencode-obsidian-provider-select' 
      })
      
      const availableProviders = this.plugin.providerManager.getAvailableProviders()
      const currentProvider = activeConv.providerID || this.plugin.settings.providerID
      
      availableProviders.forEach(providerID => {
        const option = providerSelect.createEl('option', {
          value: providerID,
          text: providerID.charAt(0).toUpperCase() + providerID.slice(1)
        })
        if (providerID === currentProvider) {
          option.selected = true
        }
      })
      
      providerSelect.value = currentProvider
      providerSelect.onchange = () => {
        activeConv.providerID = providerSelect.value as 'anthropic' | 'openai' | 'google' | 'zenmux'
        this.renderView()
        new Notice(`Provider changed to ${providerSelect.value}`)
      }
    }
  }

  private renderMessages(container: HTMLElement) {
    container.empty()

    const activeConv = this.getActiveConversation()
    if (!activeConv || activeConv.messages.length === 0) {
      container.createDiv('opencode-obsidian-empty-messages').textContent = 'Start a conversation...'
      return
    }

    activeConv.messages.forEach(message => {
      this.renderMessage(container, message)
    })

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight
  }

  private renderMessage(container: HTMLElement, message: Message) {
    const messageEl = container.createDiv(`opencode-obsidian-message opencode-obsidian-message-${message.role}`)
    
    const header = messageEl.createDiv('opencode-obsidian-message-header')
    header.createSpan('opencode-obsidian-message-role').textContent = message.role
    header.createSpan('opencode-obsidian-message-time').textContent = new Date(message.timestamp).toLocaleTimeString()

    const content = messageEl.createDiv('opencode-obsidian-message-content')
    
    // Handle different content types
    if (typeof message.content === 'string') {
      // Parse and render markdown-like content
      this.renderMessageContent(content, message.content)
    } else {
      // Rich content (could include tool uses, etc.)
      content.createDiv().textContent = JSON.stringify(message.content, null, 2)
    }

    // Render images if present
    if (message.images && message.images.length > 0) {
      const imagesContainer = content.createDiv('opencode-obsidian-message-images')
      message.images.forEach(img => {
        const imgEl = imagesContainer.createEl('img', {
          attr: { src: img.data, alt: img.name || 'Image' }
        })
        imgEl.style.maxWidth = '300px'
        imgEl.style.maxHeight = '300px'
      })
    }

    // Add message actions (copy, edit, etc.)
    this.addMessageActions(messageEl, message)
  }

  private renderMessageContent(container: HTMLElement, content: string) {
    // Simple markdown-like rendering
    const lines = content.split('\n')
    let currentParagraph = ''
    
    for (const line of lines) {
      if (line.trim() === '') {
        if (currentParagraph) {
          this.createParagraph(container, currentParagraph)
          currentParagraph = ''
        }
      } else if (line.startsWith('```')) {
        if (currentParagraph) {
          this.createParagraph(container, currentParagraph)
          currentParagraph = ''
        }
        // Handle code blocks
        const codeBlock = container.createEl('pre')
        codeBlock.addClass('opencode-obsidian-code-block')
        const code = codeBlock.createEl('code')
        
        // Extract language if specified
        const language = line.slice(3).trim()
        if (language) {
          code.addClass(`language-${language}`)
        }
        
        // Find the closing ```
        let codeContent = ''
        let i = lines.indexOf(line) + 1
        while (i < lines.length) {
          const currentLine = lines[i]
          if (!currentLine || currentLine.startsWith('```')) break
          codeContent += currentLine + '\n'
          i++
        }
        code.textContent = codeContent.trim()
        
        // Add copy button
        this.addCodeBlockActions(codeBlock, codeContent.trim())
      } else {
        currentParagraph += (currentParagraph ? '\n' : '') + line
      }
    }
    
    if (currentParagraph) {
      this.createParagraph(container, currentParagraph)
    }
  }

  private createParagraph(container: HTMLElement, text: string) {
    const p = container.createEl('p')
    
    // Simple inline formatting
    let formattedText = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
    
    p.innerHTML = formattedText
  }

  private addCodeBlockActions(codeBlock: HTMLElement, code: string) {
    const actions = codeBlock.createDiv('opencode-obsidian-code-actions')
    
    const copyBtn = actions.createEl('button', {
      text: 'Copy',
      cls: 'opencode-obsidian-code-copy'
    })
    
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(code)
        copyBtn.textContent = 'Copied!'
        setTimeout(() => {
          copyBtn.textContent = 'Copy'
        }, 2000)
      } catch (error) {
        console.error('Failed to copy code:', error)
        new Notice('Failed to copy code')
      }
    }
  }

  private addMessageActions(messageEl: HTMLElement, message: Message) {
    const actions = messageEl.createDiv('opencode-obsidian-message-actions')
    
    // Copy message button
    const copyBtn = actions.createEl('button', {
      text: '📋',
      cls: 'opencode-obsidian-message-action',
      attr: { title: 'Copy message' }
    })
    
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(message.content)
        new Notice('Message copied to clipboard')
      } catch (error) {
        console.error('Failed to copy message:', error)
        new Notice('Failed to copy message')
      }
    }

    // Regenerate button for assistant messages
    if (message.role === 'assistant') {
      const regenBtn = actions.createEl('button', {
        text: '🔄',
        cls: 'opencode-obsidian-message-action',
        attr: { title: 'Regenerate response' }
      })
      
      regenBtn.onclick = () => {
        this.regenerateResponse(message)
      }
    }
  }

  private renderInputArea(container: HTMLElement) {
    container.empty()

    const inputContainer = container.createDiv('opencode-obsidian-input-container')
    
    // Input toolbar
    const toolbar = inputContainer.createDiv('opencode-obsidian-input-toolbar')
    
    // Model selector button
    const modelSelectBtn = toolbar.createEl('button', {
      cls: 'opencode-obsidian-model-select-btn',
      text: `Model: ${this.getCurrentModelDisplayName()}`
    })
    
    modelSelectBtn.onclick = () => {
      new ModelSelectorModal(this.app, this.plugin, async (model) => {
        this.plugin.settings.model.modelID = model.modelID
        this.plugin.settings.model.providerID = model.providerID
        await this.plugin.saveSettings()
        // Update button text
        modelSelectBtn.textContent = `Model: ${this.getModelDisplayName(model.modelID)}`
        new Notice(`Model changed to ${this.getModelDisplayName(model.modelID)}`)
      }).open()
    }

    // Agent selector
    const agentSelect = toolbar.createEl('select', { cls: 'opencode-obsidian-agent-select' })
    agentSelect.createEl('option', { value: 'assistant', text: 'Assistant' })
    agentSelect.createEl('option', { value: 'bootstrap', text: 'Bootstrap' })
    agentSelect.createEl('option', { value: 'thinking-partner', text: 'Thinking Partner' })
    agentSelect.createEl('option', { value: 'research-assistant', text: 'Research Assistant' })
    agentSelect.createEl('option', { value: 'read-only', text: 'Read Only' })
    agentSelect.value = this.plugin.settings.agent
    
    agentSelect.onchange = async () => {
      this.plugin.settings.agent = agentSelect.value
      await this.plugin.saveSettings()
    }
    
    const textarea = inputContainer.createEl('textarea', {
      cls: 'opencode-obsidian-input-textarea',
      attr: { placeholder: 'Type your message... (Shift+Enter for new line, Enter to send)' }
    })

    // Input status bar
    const statusBar = inputContainer.createDiv('opencode-obsidian-input-status')
    const charCount = statusBar.createSpan('opencode-obsidian-char-count')
    const streamingStatus = statusBar.createSpan('opencode-obsidian-streaming-status')
    
    // Update character count
    const updateCharCount = () => {
      const count = textarea.value.length
      charCount.textContent = `${count} characters`
      if (count > 8000) {
        charCount.addClass('opencode-obsidian-char-warning')
      } else {
        charCount.removeClass('opencode-obsidian-char-warning')
      }
    }
    
    textarea.oninput = updateCharCount
    updateCharCount()

    const buttonContainer = inputContainer.createDiv('opencode-obsidian-input-buttons')
    
    const sendBtn = buttonContainer.createEl('button', {
      text: this.isStreaming ? 'Stop' : 'Send',
      cls: this.isStreaming ? 'mod-warning' : 'mod-cta'
    })

    const attachBtn = buttonContainer.createEl('button', {
      text: '📎',
      cls: 'opencode-obsidian-attach-btn',
      attr: { title: 'Attach image' }
    })

    const clearBtn = buttonContainer.createEl('button', {
      text: '🗑️',
      cls: 'opencode-obsidian-clear-btn',
      attr: { title: 'Clear input' }
    })

    // Update streaming status
    if (this.isStreaming) {
      streamingStatus.textContent = 'Streaming response...'
      streamingStatus.addClass('opencode-obsidian-streaming')
    } else {
      streamingStatus.textContent = ''
      streamingStatus.removeClass('opencode-obsidian-streaming')
    }

    // Handle send/stop
    sendBtn.onclick = async () => {
      if (this.isStreaming) {
        this.stopStreaming()
      } else {
        const message = textarea.value.trim()
        if (message) {
          await this.sendMessage(message)
          textarea.value = ''
          updateCharCount()
        }
      }
    }

    // Handle attach (for images)
    attachBtn.onclick = () => {
      this.showAttachmentModal()
    }

    // Handle clear
    clearBtn.onclick = () => {
      if (textarea.value.trim()) {
        new ConfirmationModal(
          this.app,
          'Clear input?',
          'Are you sure you want to clear the current input?',
          () => {
            textarea.value = ''
            updateCharCount()
            textarea.focus()
          }
        ).open()
      }
    }

    // Handle Enter key (Shift+Enter for new line)
    textarea.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendBtn.click()
      }
    }

    // Auto-resize textarea
    textarea.oninput = () => {
      updateCharCount()
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
    }
  }

  private async loadConversations() {
    // In a real implementation, this would load from storage
    // For now, create a default conversation if none exist
    if (this.conversations.length === 0) {
      this.createNewConversation()
    }
  }

  private createNewConversation() {
    // Use default provider or first available provider
    const availableProviders = this.plugin.providerManager.getAvailableProviders()
    const defaultProvider = availableProviders.length > 0 
      ? (this.plugin.settings.providerID && availableProviders.includes(this.plugin.settings.providerID)
          ? this.plugin.settings.providerID
          : availableProviders[0])
      : this.plugin.settings.providerID

    const conversation: Conversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      title: `Chat ${new Date().toLocaleString()}`,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      providerID: defaultProvider
    }

    this.conversations.unshift(conversation)
    this.activeConversationId = conversation.id
    this.renderView()
  }

  private switchConversation(conversationId: string) {
    this.activeConversationId = conversationId
    this.renderView()
  }

  private getActiveConversation(): Conversation | null {
    return this.conversations.find(c => c.id === this.activeConversationId) || null
  }

  private async sendMessage(content: string): Promise<void> {
    const activeConv = this.getActiveConversation()
    if (!activeConv) {
      this.createNewConversation()
      await this.sendMessage(content)
      return
    }

    // Add user message
    const userMessage: Message = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content,
      timestamp: Date.now()
    }
    activeConv.messages.push(userMessage)

    // Create assistant message placeholder
    const assistantMessage: Message = {
      id: `msg-${Date.now()}-assistant`,
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    }
    activeConv.messages.push(assistantMessage)

    this.isStreaming = true
    this.currentAbortController = new AbortController()
    this.renderView()

    try {
      // Check if there's a pending image path to attach
      const imagePath = activeConv.pendingImagePath
      if (imagePath) {
        // Clear pending image path after using it
        activeConv.pendingImagePath = undefined
      }

      // Build prompt parts: include text and optionally image path
      const promptParts: Array<{ type: string; text?: string; filePath?: string }> = [
        { type: 'text', text: content }
      ]
      
      if (imagePath) {
        // Add image path as image part - Plugin layer will handle encoding
        promptParts.push({ type: 'image', filePath: imagePath })
      }

      // Get provider for this conversation (default to plugin default if not set)
      const conversationProvider = activeConv.providerID || this.plugin.settings.providerID
      
      // Ensure provider is available
      if (!this.plugin.providerManager.isProviderAvailable(conversationProvider)) {
        const availableProviders = this.plugin.providerManager.getAvailableProviders()
        if (availableProviders.length === 0) {
          throw new Error('No providers configured. Please configure at least one API key in settings.')
        }
        // Use first available provider if conversation's provider is not available
        activeConv.providerID = availableProviders[0]
        new Notice(`Provider ${conversationProvider} not available, using ${availableProviders[0]}`)
      }

      const responseStream = await this.plugin.sendPrompt(
        activeConv.providerID || this.plugin.settings.providerID,
        imagePath ? promptParts : content,
        {
          sessionId: activeConv.sessionId || undefined,
          abortController: this.currentAbortController
        }
      )

      let fullContent = ''
      for await (const chunk of responseStream) {
        if (this.currentAbortController?.signal.aborted) {
          break
        }

        await this.handleResponseChunk(chunk, assistantMessage)
        
        if (chunk.type === 'text' && chunk.content) {
          fullContent += chunk.content
          assistantMessage.content = fullContent
          this.renderView()
        }

        if (chunk.type === 'session_init' && chunk.sessionId) {
          activeConv.sessionId = chunk.sessionId
        }

        if (chunk.type === 'done') {
          break
        }
      }
    } catch (error) {
      console.error('Error sending message:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      assistantMessage.content = `Error: ${errorMessage}`
      new Notice(`Error: ${errorMessage}`)
    } finally {
      this.isStreaming = false
      this.currentAbortController = null
      this.renderView()
    }
  }

  private async handleResponseChunk(chunk: ResponseChunk, message: Message) {
    switch (chunk.type) {
      case 'text':
        // Text content is handled in sendMessage
        break
      
      case 'thinking':
        // Handle thinking/reasoning display
        this.showThinkingIndicator(chunk.content || '')
        break
      
      case 'tool_use':
        // Handle tool use display
        this.showToolUse({
          id: chunk.id || 'unknown',
          name: chunk.name || 'unknown',
          input: chunk.input || {}
        })
        break
      
      case 'tool_result':
        // Handle tool result display
        this.showToolResult({
          id: chunk.id || 'unknown',
          content: chunk.content || '',
          isError: chunk.isError || false
        })
        break
      
      case 'blocked':
        // Handle permission request blocking
        this.showBlockedIndicator(chunk.content || 'Waiting for permission...')
        break
      
      case 'usage':
        // Handle usage information
        if (chunk.usage) {
          console.log('Token usage:', chunk.usage)
          this.showUsageInfo(chunk.usage)
        }
        break
      
      case 'error':
        throw new Error(chunk.content || 'Unknown error')
    }
  }

  private showThinkingIndicator(content: string) {
    // Show thinking indicator in the UI
    console.log('AI is thinking:', content)
    
    let indicator = this.containerEl.querySelector('.opencode-obsidian-thinking-indicator') as HTMLElement
    if (!indicator) {
      const messagesContainer = this.containerEl.querySelector('.opencode-obsidian-messages')
      if (messagesContainer) {
        indicator = messagesContainer.createDiv('opencode-obsidian-thinking-indicator')
      }
    }
    
    if (indicator) {
      indicator.textContent = `💭 ${content || 'Thinking...'}`
      indicator.style.display = 'block'
      
      // Auto-hide after a delay
      setTimeout(() => {
        if (indicator) {
          indicator.style.display = 'none'
        }
      }, 3000)
    }
  }

  private showBlockedIndicator(content: string) {
    // Show blocked indicator
    let indicator = this.containerEl.querySelector('.opencode-obsidian-blocked-indicator') as HTMLElement
    if (!indicator) {
      const header = this.containerEl.querySelector('.opencode-obsidian-header')
      if (header) {
        indicator = header.createDiv('opencode-obsidian-blocked-indicator')
      }
    }
    
    if (indicator) {
      indicator.textContent = `🔒 ${content}`
      indicator.style.display = 'block'
    }
  }

  private hideBlockedIndicator() {
    const indicator = this.containerEl.querySelector('.opencode-obsidian-blocked-indicator') as HTMLElement
    if (indicator) {
      indicator.style.display = 'none'
    }
  }

  private showUsageInfo(usage: any) {
    // Show usage information in the status bar or as a temporary notice
    const usageText = `${usage.model}: ${usage.inputTokens} tokens`
    console.log('Usage:', usageText)
    
    // Could show this in a status bar or as a brief notice
    // For now, just log it
  }

  private showToolUse(toolUse: ToolUse) {
    // Show tool use in the UI (could be a modal or inline display)
    console.log('Tool use:', toolUse)
    new Notice(`Using tool: ${toolUse.name}`)
  }

  private showToolResult(toolResult: ToolResult) {
    // Show tool result in the UI
    console.log('Tool result:', toolResult)
    if (toolResult.isError) {
      new Notice(`Tool error: ${toolResult.content}`)
    }
  }

  private stopStreaming() {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
    this.isStreaming = false
    this.renderView()
  }

  private async regenerateResponse(message: Message) {
    const activeConv = this.getActiveConversation()
    if (!activeConv) return

    // Find the user message that preceded this assistant message
    const messageIndex = activeConv.messages.findIndex(m => m.id === message.id)
    if (messageIndex <= 0) return

    const userMessage = activeConv.messages[messageIndex - 1]
    if (!userMessage || userMessage.role !== 'user') return

    // Remove the assistant message and regenerate
    activeConv.messages.splice(messageIndex, 1)
    await this.sendMessage(userMessage.content)
  }

  private showAttachmentModal() {
    new AttachmentModal(this.app, async (file: File) => {
      try {
        const activeConv = this.getActiveConversation()
        if (!activeConv) {
          this.createNewConversation()
        }

        // Save file to vault's attachments folder (05_Attachments)
        // The path will be sent to OpenCode Client, which will forward it to Plugin layer
        const attachmentsFolder = '05_Attachments'
        const timestamp = Date.now()
        const fileName = `${timestamp}-${file.name}`
        const filePath = `${attachmentsFolder}/${fileName}`
        
        // Ensure attachments folder exists
        const folderExists = await this.app.vault.adapter.exists(attachmentsFolder)
        if (!folderExists) {
          await this.app.vault.createFolder(attachmentsFolder)
        }
        
        // Convert File to ArrayBuffer and save
        const arrayBuffer = await file.arrayBuffer()
        await this.app.vault.createBinary(filePath, arrayBuffer)
        
        // Get absolute path from vault base path
        const vaultBasePath = (this.app.vault.adapter as any).basePath
        const absolutePath = vaultBasePath ? `${vaultBasePath}/${filePath}` : filePath
        
        // Store image path for the next message
        // The path will be sent to OpenCode Client as an image part
        const updatedActiveConv = this.getActiveConversation()
        if (updatedActiveConv) {
          updatedActiveConv.pendingImagePath = absolutePath
        }
        
        new Notice(`Image attached: ${file.name}`)
      } catch (error) {
        console.error('Failed to save image:', error)
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        new Notice(`Failed to save image: ${errorMessage}`)
      }
    }).open()
  }

  updateConnectionStatus(connected: boolean) {
    // In embedded mode, always connected
    const statusEl = this.containerEl.querySelector('.opencode-obsidian-status')
    if (statusEl) {
      statusEl.removeClass('connected', 'disconnected')
      statusEl.addClass('connected')
      statusEl.textContent = '● Connected'
    }
  }

  private showToolExecutionIndicator(toolName: string, show: boolean) {
    let indicator = this.containerEl.querySelector('.opencode-obsidian-tool-indicator') as HTMLElement
    
    if (show) {
      if (!indicator) {
        const header = this.containerEl.querySelector('.opencode-obsidian-header')
        if (header) {
          indicator = header.createDiv('opencode-obsidian-tool-indicator')
        }
      }
      if (indicator) {
        indicator.textContent = `🔧 ${toolName}`
        indicator.style.display = 'block'
      }
    } else {
      if (indicator) {
        indicator.style.display = 'none'
      }
    }
  }

  private showCompactionIndicator(show: boolean) {
    let indicator = this.containerEl.querySelector('.opencode-obsidian-compaction-indicator') as HTMLElement
    
    if (show) {
      if (!indicator) {
        const header = this.containerEl.querySelector('.opencode-obsidian-header')
        if (header) {
          indicator = header.createDiv('opencode-obsidian-compaction-indicator')
        }
      }
      if (indicator) {
        indicator.textContent = '🗜️ Optimizing context...'
        indicator.style.display = 'block'
      }
    } else {
      if (indicator) {
        indicator.style.display = 'none'
      }
    }
  }

  // Permission request handling removed - not needed in embedded mode

  private getCurrentModelDisplayName(): string {
    return this.getModelDisplayName(this.plugin.settings.model.modelID)
  }

  private getModelDisplayName(modelID: string): string {
    // 格式化模型名称用于显示
    if (!modelID) return 'Unknown'
    
    // 尝试提取友好的名称
    const parts = modelID.split('-')
    if (parts.length >= 3) {
      // 例如: claude-3-5-sonnet-20241022 -> Claude 3.5 Sonnet
      const nameParts = parts.slice(0, 3)
      return nameParts
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    }
    
    // 如果是 GPT 模型
    if (modelID.includes('gpt')) {
      return modelID.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    }
    
    // 默认返回模型ID的前30个字符
    return modelID.length > 30 ? modelID.substring(0, 30) + '...' : modelID
  }
}

class AttachmentModal extends Modal {
  private onFileSelect: (file: File) => void

  constructor(app: any, onFileSelect: (file: File) => void) {
    super(app)
    this.onFileSelect = onFileSelect
  }

  onOpen() {
    const { contentEl } = this
    contentEl.createEl('h2', { text: 'Attach Image' })

    const dropZone = contentEl.createDiv('opencode-obsidian-drop-zone')
    dropZone.textContent = 'Drop an image here or click to select'
    
    const fileInput = contentEl.createEl('input', {
      type: 'file',
      attr: { accept: 'image/*', style: 'display: none' }
    })

    // Handle file selection
    const handleFile = (file: File) => {
      if (!file.type.startsWith('image/')) {
        new Notice('Please select an image file')
        return
      }
      
      if (file.size > 10 * 1024 * 1024) { // 10MB limit
        new Notice('Image file is too large (max 10MB)')
        return
      }
      
      this.onFileSelect(file)
      this.close()
    }

    // Click to select
    dropZone.onclick = () => fileInput.click()
    
    fileInput.onchange = () => {
      const file = fileInput.files?.[0]
      if (file) handleFile(file)
    }

    // Drag and drop
    dropZone.ondragover = (e) => {
      e.preventDefault()
      dropZone.addClass('opencode-obsidian-drop-zone-hover')
    }
    
    dropZone.ondragleave = () => {
      dropZone.removeClass('opencode-obsidian-drop-zone-hover')
    }
    
    dropZone.ondrop = (e) => {
      e.preventDefault()
      dropZone.removeClass('opencode-obsidian-drop-zone-hover')
      
      const file = e.dataTransfer?.files[0]
      if (file) handleFile(file)
    }

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => this.close())
      )
  }

  onClose() {
    const { contentEl } = this
    contentEl.empty()
  }
}

class ConfirmationModal extends Modal {
  private title: string
  private message: string
  private onConfirm: () => void

  constructor(app: any, title: string, message: string, onConfirm: () => void) {
    super(app)
    this.title = title
    this.message = message
    this.onConfirm = onConfirm
  }

  onOpen() {
    const { contentEl } = this
    contentEl.createEl('h2', { text: this.title })
    contentEl.createEl('p', { text: this.message })

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => this.close())
      )
      .addButton(btn => btn
        .setButtonText('Confirm')
        .setCta()
        .onClick(() => {
          this.onConfirm()
          this.close()
        })
      )
  }

  onClose() {
    const { contentEl } = this
    contentEl.empty()
  }
}

// PermissionRequestModal removed - not needed in embedded mode