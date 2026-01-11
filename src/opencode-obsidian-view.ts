import { ItemView, WorkspaceLeaf, Notice, Modal, Setting, MarkdownRenderer, TFile, App } from 'obsidian'
import type OpenCodeObsidianPlugin from './main'
import type { Conversation, Message, ToolUse, ToolResult, ImageAttachment } from './types'

export const VIEW_TYPE_OPENCODE_OBSIDIAN = 'opencode-obsidian-view'

interface UsageInfo {
  model: string
  inputTokens: number
  outputTokens?: number
}

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
    return 'Opencode'
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
    
      // Register OpenCode Server client callbacks if client is initialized
    if (this.plugin.opencodeClient) {
      this.registerClientCallbacks()
      
      // Connect to server directly
      if (!this.plugin.opencodeClient.isConnected()) {
        try {
          await this.plugin.opencodeClient.connect()
          console.debug('[OpenCodeObsidianView] Connected to OpenCode Server')
        } catch (error) {
          console.error('[OpenCodeObsidianView] Failed to connect to OpenCode Server:', error)
          const errorMessage = error instanceof Error ? error.message : String(error)
          new Notice(`Connection failed: ${errorMessage}`)
        }
      }
    }
  }
  
  /**
   * Find conversation by sessionId
   */
  private findConversationBySessionId(sessionId: string): Conversation | null {
    return this.conversations.find(c => c.sessionId === sessionId) || null
  }

  /**
   * Register callbacks for OpenCode Server client events
   */
  private registerClientCallbacks(): void {
    if (!this.plugin.opencodeClient) return
    
    // Stream token callback - append tokens to the current assistant message
    this.plugin.opencodeClient.onStreamToken((sessionId, token, done) => {
      // Route by sessionId, not just active conversation
      const targetConv = this.findConversationBySessionId(sessionId) || this.getActiveConversation()
      if (!targetConv || targetConv.sessionId !== sessionId) {
        // Only process if sessionId matches or if it's the active conversation (for backward compatibility)
        if (targetConv && targetConv.sessionId !== sessionId) {
          console.debug('[OpenCodeObsidianView] Ignoring stream token for mismatched sessionId:', sessionId)
          return
        }
        if (!targetConv) return
      }
      
      // Find the last assistant message and append token
      const lastMessage = targetConv.messages[targetConv.messages.length - 1]
      if (lastMessage && lastMessage.role === 'assistant') {
        lastMessage.content += token
        // Incremental update - only update the message content, not entire view
        this.updateMessages()
      }
      
      if (done) {
        // Only update streaming status if this is the active conversation
        const activeConv = this.getActiveConversation()
        if (activeConv && activeConv.sessionId === sessionId) {
          this.isStreaming = false
          this.updateStreamingStatus(false)
        }
        targetConv.updatedAt = Date.now()
        void this.saveConversations()
      }
    })
    
    // Stream thinking callback
    this.plugin.opencodeClient.onStreamThinking((sessionId, content) => {
      // Route by sessionId
      const targetConv = this.findConversationBySessionId(sessionId) || this.getActiveConversation()
      if (!targetConv || targetConv.sessionId !== sessionId) {
        if (targetConv && targetConv.sessionId !== sessionId) {
          console.debug('[OpenCodeObsidianView] Ignoring stream thinking for mismatched sessionId:', sessionId)
          return
        }
        if (!targetConv) return
      }
      
      const lastMessage = targetConv.messages[targetConv.messages.length - 1]
      if (lastMessage && lastMessage.role === 'assistant') {
        void this.handleResponseChunk({ type: 'thinking', content }, lastMessage)
      }
    })
    
    // Error callback - check if error has sessionId, otherwise fallback to activeConv
    this.plugin.opencodeClient.onError((error) => {
      // Try to extract sessionId from error if available
      let targetConv: Conversation | null = null
      const errorWithSessionId = error as { sessionId?: string }
      if (errorWithSessionId.sessionId) {
        const sessionId = errorWithSessionId.sessionId
        targetConv = this.findConversationBySessionId(sessionId)
      }
      
      // Fallback to active conversation if no sessionId or not found
      if (!targetConv) {
        targetConv = this.getActiveConversation()
      }
      
      if (!targetConv) return
      
      const lastMessage = targetConv.messages[targetConv.messages.length - 1]
      if (lastMessage && lastMessage.role === 'assistant') {
        lastMessage.content = `Error: ${error.message}`
        this.updateMessages()
      }
      
      new Notice(error.message)
      // Only update streaming status if this is the active conversation
      const activeConv = this.getActiveConversation()
      if (activeConv === targetConv) {
        this.isStreaming = false
        this.updateStreamingStatus(false)
      }
    })
    
    // Progress update callback
    this.plugin.opencodeClient.onProgressUpdate((sessionId, progress) => {
      // Route by sessionId
      const targetConv = this.findConversationBySessionId(sessionId) || this.getActiveConversation()
      if (!targetConv || targetConv.sessionId !== sessionId) {
        if (targetConv && targetConv.sessionId !== sessionId) {
          console.debug('[OpenCodeObsidianView] Ignoring progress update for mismatched sessionId:', sessionId)
          return
        }
        if (!targetConv) return
      }
      
      const lastMessage = targetConv.messages[targetConv.messages.length - 1]
      if (lastMessage && lastMessage.role === 'assistant') {
        void this.handleResponseChunk({
          type: 'progress',
          message: progress.message,
          stage: progress.stage,
          progress: progress.progress
        }, lastMessage)
      }
    })
    
    // Session end callback
    this.plugin.opencodeClient.onSessionEnd((sessionId, reason) => {
      // Route by sessionId
      const targetConv = this.findConversationBySessionId(sessionId)
      if (targetConv && targetConv.sessionId === sessionId) {
        targetConv.sessionId = null
      }
      
      // Only update streaming status if this is the active conversation
      const activeConv = this.getActiveConversation()
      if (activeConv && activeConv.sessionId === sessionId) {
        this.isStreaming = false
        this.updateStreamingStatus(false)
      }
      
      if (reason === 'error') {
        new Notice('Session ended due to error')
      }
    })
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

  /**
   * Incremental DOM update methods to avoid full re-renders
   */
  private getOrCreateContainerElement(className: string): HTMLElement | null {
    const container = this.containerEl.children[1]
    if (!container) return null
    
    // Use querySelector to find element by class name
    const element = container.querySelector(`.${className}`) as HTMLElement
    if (!element) {
      // Element doesn't exist, fallback to full render
      return null
    }
    return element
  }

  /**
   * Incrementally update header (connection status and controls)
   */
  private updateHeader(): void {
    const header = this.getOrCreateContainerElement('opencode-obsidian-header')
    if (header) {
      this.renderHeader(header)
    }
  }

  /**
   * Incrementally update conversation selector
   */
  private updateConversationSelector(): void {
    const conversationSelector = this.getOrCreateContainerElement('opencode-obsidian-conversation-selector')
    if (conversationSelector) {
      this.renderConversationSelector(conversationSelector)
    }
  }

  /**
   * Incrementally update messages container
   */
  private updateMessages(): void {
    const messagesContainer = this.getOrCreateContainerElement('opencode-obsidian-messages')
    if (messagesContainer) {
      this.renderMessages(messagesContainer)
    }
  }

  /**
   * Incrementally update input area (toolbar, textarea, buttons)
   */
  private updateInputArea(): void {
    const inputArea = this.getOrCreateContainerElement('opencode-obsidian-input')
    if (inputArea) {
      this.renderInputArea(inputArea)
    }
  }

  /**
   * Update streaming status in input area without full re-render
   */
  private updateStreamingStatus(isStreaming: boolean): void {
    const statusBar = this.containerEl.querySelector('.opencode-obsidian-input-status')
    if (!statusBar) return

    const streamingStatus = statusBar.querySelector('.opencode-obsidian-streaming-status') as HTMLElement
    if (streamingStatus) {
      if (isStreaming) {
        streamingStatus.textContent = 'Streaming response...'
        streamingStatus.addClass('opencode-obsidian-streaming')
      } else {
        streamingStatus.textContent = ''
        streamingStatus.removeClass('opencode-obsidian-streaming')
      }
    }

    // Update send button text
    const sendBtn = this.containerEl.querySelector('.opencode-obsidian-input-buttons button.mod-cta, .opencode-obsidian-input-buttons button.mod-warning') as HTMLElement
    if (sendBtn) {
      sendBtn.textContent = isStreaming ? 'Stop' : 'Send'
      sendBtn.removeClass('mod-cta', 'mod-warning')
      sendBtn.addClass(isStreaming ? 'mod-warning' : 'mod-cta')
    }
  }

  private renderHeader(container: HTMLElement) {
    container.empty()

    const statusEl = container.createDiv('opencode-obsidian-status')
    // TODO: Get connection status from OpenCode Server client
    const isConnected = this.plugin.settings.opencodeServer?.url ? true : false
    
    if (!isConnected) {
      statusEl.addClass('disconnected')
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      statusEl.textContent = '● not connected to OpenCode server.'
    } else {
      statusEl.addClass('connected')
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      statusEl.textContent = '● connected to OpenCode server.'
    }

    const controls = container.createDiv('opencode-obsidian-controls')
    
    // New conversation button
    const newConvBtn = controls.createEl('button', {
      text: 'New chat',
      cls: 'mod-cta'
    })
    newConvBtn.onclick = () => {
      void this.createNewConversation()
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
      const option = select.createEl('option', {
        value: conv.id,
        text: conv.title
      })
      if (conv.id === this.activeConversationId) {
        option.selected = true
      }
    })

    select.onchange = async () => {
      await this.switchConversation(select.value)
    }

    // Add provider selector for active conversation
    const activeConv = this.getActiveConversation()
    if (activeConv) {
      // TODO: Provider selection should be handled by OpenCode Server
      // Providers are managed server-side, not in the plugin
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
    messageEl.setAttribute('data-message-id', message.id)
    
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
        // eslint-disable-next-line obsidianmd/no-static-styles-assignment
        imgEl.style.maxWidth = '300px'
        // eslint-disable-next-line obsidianmd/no-static-styles-assignment
        imgEl.style.maxHeight = '300px'
      })
    }

    // Add message actions (copy, edit, etc.)
    this.addMessageActions(messageEl, message)
  }

  private renderMessageContent(container: HTMLElement, content: string) {
    // Use Obsidian's MarkdownRenderer for full markdown support
    // But preserve code blocks with copy functionality
    const lines = content.split('\n')
    let inCodeBlock = false
    let codeBlockLanguage = ''
    let codeBlockContent: string[] = []
    let textBeforeCodeBlock = ''
    
    // First pass: separate code blocks from regular markdown
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          // End of code block
          inCodeBlock = false
          // Render text before code block
          if (textBeforeCodeBlock.trim()) {
            const textContainer = container.createDiv('opencode-obsidian-markdown-text')
            void MarkdownRenderer.render(
              this.plugin.app,
              textBeforeCodeBlock.trim(),
              textContainer,
              '',
              this
            )
            textBeforeCodeBlock = ''
          }
          // Render code block with copy button
          const codeBlock = container.createEl('pre')
          codeBlock.addClass('opencode-obsidian-code-block')
          const code = codeBlock.createEl('code')
          if (codeBlockLanguage) {
            code.addClass(`language-${codeBlockLanguage}`)
          }
          code.textContent = codeBlockContent.join('\n')
          this.addCodeBlockActions(codeBlock, codeBlockContent.join('\n'))
          codeBlockContent = []
          codeBlockLanguage = ''
        } else {
          // Start of code block
          inCodeBlock = true
          codeBlockLanguage = line.slice(3).trim()
        }
      } else if (inCodeBlock) {
        codeBlockContent.push(line)
      } else {
        textBeforeCodeBlock += (textBeforeCodeBlock ? '\n' : '') + line
      }
    }
    
    // Handle remaining text or code block
    if (inCodeBlock && codeBlockContent.length > 0) {
      // Unclosed code block, render as code
      const codeBlock = container.createEl('pre')
      codeBlock.addClass('opencode-obsidian-code-block')
      const code = codeBlock.createEl('code')
      if (codeBlockLanguage) {
        code.addClass(`language-${codeBlockLanguage}`)
      }
      code.textContent = codeBlockContent.join('\n')
      this.addCodeBlockActions(codeBlock, codeBlockContent.join('\n'))
    }
    
    if (textBeforeCodeBlock.trim()) {
      const textContainer = container.createDiv('opencode-obsidian-markdown-text')
      void MarkdownRenderer.render(
        this.plugin.app,
        textBeforeCodeBlock.trim(),
        textContainer,
        '',
        this
      )
    }
  }

  private createParagraph(container: HTMLElement, text: string) {
    const p = container.createEl('p')
    
    // Simple inline formatting
    let formattedText = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
    
    // eslint-disable-next-line @microsoft/sdl/no-inner-html
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
        void this.regenerateResponse(message)
      }
    }
  }

  private renderInputArea(container: HTMLElement) {
    container.empty()

    const inputContainer = container.createDiv('opencode-obsidian-input-container')
    
    // Input toolbar
    const toolbar = inputContainer.createDiv('opencode-obsidian-input-toolbar')
    
    // TODO: Model selector removed - models are managed by OpenCode Server

    // Agent selector
    const agentSelect = toolbar.createEl('select', { cls: 'opencode-obsidian-agent-select' })
    
    // Default agents (fallback if no custom agents loaded)
    const defaultAgents: Array<{ id: string; name: string }> = [
      { id: 'assistant', name: 'Assistant' },
      { id: 'bootstrap', name: 'Bootstrap' },
      { id: 'thinking-partner', name: 'Thinking Partner' },
      { id: 'research-assistant', name: 'Research Assistant' },
      { id: 'read-only', name: 'Read Only' }
    ]
    
    // Get loaded agents (filter out hidden ones)
    const loadedAgents = this.plugin.settings.agents?.filter(a => !a.hidden) || []
    
    // Use loaded agents if available, otherwise use defaults
    const agentsToShow = loadedAgents.length > 0 ? loadedAgents : defaultAgents
    
    // Add agents to dropdown
    agentsToShow.forEach(agent => {
      const option = agentSelect.createEl('option', { 
        value: agent.id, 
        text: agent.name 
      })
      
      // Add color indicator if agent has color (only for Agent type, not default agents)
      if ('color' in agent && typeof agent.color === 'string') {
        option.style.color = agent.color
      }
    })
    
    // Set current value (ensure it exists in options)
    const currentValue = this.plugin.settings.agent
    if (agentsToShow.some(a => a.id === currentValue)) {
      agentSelect.value = currentValue
    } else if (agentsToShow.length > 0 && agentsToShow[0]) {
      // If current agent not found, use first available
      agentSelect.value = agentsToShow[0].id
      this.plugin.settings.agent = agentsToShow[0].id
      void this.plugin.saveSettings()
    }
    
    agentSelect.onchange = async () => {
      this.plugin.settings.agent = agentSelect.value
      // Use debounced save for agent selector changes
      await this.plugin.debouncedSaveSettings()
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
      void this.showAttachmentModal()
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
      // eslint-disable-next-line obsidianmd/no-static-styles-assignment
      textarea.style.height = 'auto'
       
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
    }
  }

  private async loadConversations() {
    try {
       
      const saved = await this.plugin.loadData() as { conversations?: Conversation[]; activeConversationId?: string } | null
       
      const conversations = saved?.conversations
      if (conversations && Array.isArray(conversations) && conversations.length > 0) {
        this.conversations = conversations
        // Restore active conversation if it exists
        if (this.conversations.length > 0) {
          // Try to restore the last active conversation, or use the first one
           
          const lastActiveId = saved?.activeConversationId
          if (lastActiveId && typeof lastActiveId === 'string' && this.conversations.find(c => c.id === lastActiveId)) {
            this.activeConversationId = lastActiveId
          } else {
            const firstConv = this.conversations[0]
            if (firstConv) {
              this.activeConversationId = firstConv.id
            }
          }
        }
      } else {
        // No saved conversations, create a default one
        if (this.conversations.length === 0) {
          await this.createNewConversation()
        }
      }
    } catch (error) {
      console.error('[OpenCode Obsidian] Failed to load conversations:', error)
      // Fallback: create a default conversation
      if (this.conversations.length === 0) {
        await this.createNewConversation()
      }
    }
  }

  private async saveConversations() {
    try {
       
      const currentData = await this.plugin.loadData() as Record<string, unknown> | null
      const dataToSave = {
        ...(currentData || {}),
        conversations: this.conversations,
        activeConversationId: this.activeConversationId
      }
      await this.plugin.saveData(dataToSave)
    } catch (error) {
      console.error('[OpenCode Obsidian] Failed to save conversations:', error)
    }
  }

  private async createNewConversation() {
    // TODO: Provider selection should be handled by OpenCode Server
    const conversation: Conversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      title: `Chat ${new Date().toLocaleString()}`,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    this.conversations.unshift(conversation)
    this.activeConversationId = conversation.id
    await this.saveConversations()
    // Update conversation selector and messages (new conversation is empty)
    this.updateConversationSelector()
    this.updateMessages()
  }

  private async switchConversation(conversationId: string) {
    this.activeConversationId = conversationId
    await this.saveConversations()
    // Only update conversation selector (to show selected state) and messages
    this.updateConversationSelector()
    this.updateMessages()
  }

  private getActiveConversation(): Conversation | null {
    return this.conversations.find(c => c.id === this.activeConversationId) || null
  }

  private async sendMessage(content: string): Promise<void> {
    const activeConv = this.getActiveConversation()
    if (!activeConv) {
      await this.createNewConversation()
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
    // Only update messages (to show new messages) and input area (streaming status)
    this.updateMessages()
    this.updateStreamingStatus(true)

    try {
      // Check if OpenCode Server client is available
      if (!this.plugin.opencodeClient) {
        throw new Error('OpenCode Server client not initialized. Please check settings.')
      }

      // Ensure client is connected
      if (!this.plugin.opencodeClient.isConnected()) {
        try {
          await this.plugin.opencodeClient.connect()
        } catch (error) {
          throw new Error(`Failed to connect to OpenCode Server: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      // Check if there's a pending image path to attach
      const imagePath = activeConv.pendingImagePath
      let images: ImageAttachment[] | undefined
      
      if (imagePath) {
        // Read image file and convert to base64
        try {
          const imageFile = this.app.vault.getAbstractFileByPath(imagePath)
          if (imageFile instanceof TFile) {
            const file = imageFile
            const arrayBuffer = await this.app.vault.readBinary(file)
            const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
            
            // Determine MIME type from extension
            let mimeType = 'image/png'
            const ext = file.extension.toLowerCase()
            if (ext === 'jpg' || ext === 'jpeg') {
              mimeType = 'image/jpeg'
            } else if (ext === 'gif') {
              mimeType = 'image/gif'
            } else if (ext === 'webp') {
              mimeType = 'image/webp'
            }
            
            images = [{
              data: base64,
              mimeType,
              name: file.name
            }]
          }
        } catch (imageError) {
          console.warn('[OpenCodeObsidianView] Failed to attach image:', imageError)
          // Continue without image if reading fails
        }
        
        // Clear pending image path after using it
        activeConv.pendingImagePath = undefined
      }

      // Get or create session ID
      let sessionId = activeConv.sessionId || this.plugin.opencodeClient.getCurrentSessionId()
      
      if (!sessionId) {
        // Start a new session
        try {
          // Ensure connection is established
          if (!this.plugin.opencodeClient.isConnected()) {
            console.debug('[OpenCodeObsidianView] Not connected, connecting...')
            await this.plugin.opencodeClient.connect()
            console.debug('[OpenCodeObsidianView] Connected to OpenCode Server')
          }
          
          // Build session context from current note if available
          const activeFile = this.app.workspace.getActiveFile()
          const context = activeFile ? {
            currentNote: activeFile.path,
            properties: this.app.metadataCache.getFileCache(activeFile)?.frontmatter
          } : undefined
          
          sessionId = await this.plugin.opencodeClient.startSession(
            context,
            this.plugin.settings.agent,
            activeConv.id
          )
          
          activeConv.sessionId = sessionId
          console.debug('[OpenCodeObsidianView] Started new session:', sessionId)
        } catch (sessionError) {
          const errorMsg = sessionError instanceof Error ? sessionError.message : 'Unknown error'
          console.error('[OpenCodeObsidianView] Session start failed:', sessionError)
          throw new Error(`Failed to start session: ${errorMsg}`)
        }
      }

      // Send message to OpenCode Server
      await this.plugin.opencodeClient.sendSessionMessage(sessionId, content, images)
      
      console.debug('[OpenCodeObsidianView] Message sent to OpenCode Server:', { sessionId, contentLength: content.length })
    } catch (error) {
      console.error('[OpenCodeObsidianView] Error sending message:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      assistantMessage.content = `Error: ${errorMessage}`
      new Notice(`Error: ${errorMessage}`)
      this.isStreaming = false
      this.updateStreamingStatus(false)
    } finally {
      if (!this.isStreaming) {
        this.currentAbortController = null
        activeConv.updatedAt = Date.now()
        await this.saveConversations()
        this.updateMessages()
      }
    }
  }

  // TODO: Implement response chunk handling for OpenCode Server protocol
  private async handleResponseChunk(chunk: unknown, message: Message) {
     
    const chunkAny = chunk as { type?: string; content?: string; id?: string; name?: string; input?: unknown; isError?: boolean; usage?: unknown }
     
    switch (chunkAny.type) {
      case 'text':
        // Text content is handled in sendMessage
        break
      
      case 'thinking':
        // Handle thinking/reasoning display
         
        this.showThinkingIndicator(chunkAny.content || '')
        break
      
      case 'tool_use':
        // Handle tool use display
        this.showToolUse({
           
          id: chunkAny.id || 'unknown',
           
          name: chunkAny.name || 'unknown',
           
          input: chunkAny.input || {}
        })
        break
      
      case 'tool_result':
        // Handle tool result display
        this.showToolResult({
           
          id: chunkAny.id || 'unknown',
           
          content: chunkAny.content || '',
           
          isError: chunkAny.isError || false
        })
        break
      
      case 'blocked':
        // Handle permission request blocking
         
        this.showBlockedIndicator(chunkAny.content || 'Waiting for permission...')
        break
      
      case 'usage':
        // Handle usage information
         
        if (chunkAny.usage && typeof chunkAny.usage === 'object') {
          const usage = chunkAny.usage as { model?: string; inputTokens?: number; outputTokens?: number }
          if (usage.model !== undefined && usage.inputTokens !== undefined) {
            console.debug('Token usage:', usage)
            this.showUsageInfo({
              model: usage.model,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens
            })
          }
        }
        break
      
      case 'error':
         
        throw new Error((chunkAny.content) || 'Unknown error')
    }
  }

  private showThinkingIndicator(content: string) {
    // Show thinking indicator in the UI
    console.debug('AI is thinking:', content)
    
    let indicator = this.containerEl.querySelector('.opencode-obsidian-thinking-indicator') as HTMLElement
    if (!indicator) {
      const messagesContainer = this.containerEl.querySelector('.opencode-obsidian-messages')
      if (messagesContainer) {
        indicator = messagesContainer.createDiv('opencode-obsidian-thinking-indicator')
      }
    }
    
    if (indicator) {
      indicator.textContent = `💭 ${content || 'Thinking...'}`
      // eslint-disable-next-line obsidianmd/no-static-styles-assignment
      indicator.style.display = 'block'
      
      // Auto-hide after a delay
      setTimeout(() => {
        if (indicator) {
          // eslint-disable-next-line obsidianmd/no-static-styles-assignment
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
      // eslint-disable-next-line obsidianmd/no-static-styles-assignment
      indicator.style.display = 'block'
    }
  }

  private hideBlockedIndicator() {
    const indicator = this.containerEl.querySelector('.opencode-obsidian-blocked-indicator') as HTMLElement
    if (indicator) {
      // eslint-disable-next-line obsidianmd/no-static-styles-assignment
      indicator.style.display = 'none'
    }
  }

  private showUsageInfo(usage: UsageInfo) {
    // Show usage information in the status bar or as a temporary notice
    const usageText = `${usage.model}: ${usage.inputTokens} tokens`
    console.debug('Usage:', usageText)
    
    // Could show this in a status bar or as a brief notice
    // For now, just log it
  }

  private showToolUse(toolUse: ToolUse) {
    // Show tool use in the UI (could be a modal or inline display)
    console.debug('Tool use:', toolUse)
    new Notice(`Using tool: ${toolUse.name}`)
  }

  private showToolResult(toolResult: ToolResult) {
    // Show tool result in the UI
    console.debug('Tool result:', toolResult)
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
    // Only update input area to reflect streaming stopped
    this.updateStreamingStatus(false)
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
    new AttachmentModal(this.app, (file: File) => {
      void (async () => {
      try {
        const activeConv = this.getActiveConversation()
        if (!activeConv) {
          await this.createNewConversation()
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
         
        const vaultBasePath = (this.app.vault.adapter as { basePath?: string }).basePath
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
      })()
    }).open()
  }

  updateConnectionStatus(connected: boolean) {
    // In embedded mode, always connected
    const statusEl = this.containerEl.querySelector('.opencode-obsidian-status')
    if (statusEl) {
      statusEl.removeClass('connected', 'disconnected')
      statusEl.addClass('connected')
      statusEl.textContent = '● connected.'
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
        // eslint-disable-next-line obsidianmd/no-static-styles-assignment
        indicator.style.display = 'block'
      }
    } else {
      if (indicator) {
        // eslint-disable-next-line obsidianmd/no-static-styles-assignment
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
        indicator.textContent = '🗜️ optimizing context…'
        // eslint-disable-next-line obsidianmd/no-static-styles-assignment
        indicator.style.display = 'block'
      }
    } else {
      if (indicator) {
        // eslint-disable-next-line obsidianmd/no-static-styles-assignment
        indicator.style.display = 'none'
      }
    }
  }

  private updateMessageContent(messageId: string, content: string) {
    const messageEl = this.containerEl.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement
    if (messageEl) {
      const contentEl = messageEl.querySelector('.opencode-obsidian-message-content') as HTMLElement
      if (contentEl) {
        // Clear existing content
        contentEl.empty()
        // Render new content
        this.renderMessageContent(contentEl, content)
        // Auto-scroll to bottom
        const messagesContainer = this.containerEl.querySelector('.opencode-obsidian-messages') as HTMLElement
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight
        }
      }
    }
  }

  // TODO: Model display methods removed - models are managed by OpenCode Server
  private getCurrentModelDisplayName(): string {
    return 'Model (managed by server)'
  }

  // TODO: Model display methods removed - models are managed by OpenCode Server
}

class AttachmentModal extends Modal {
  private onFileSelect: (file: File) => void

  constructor(app: App, onFileSelect: (file: File) => void) {
    super(app)
    this.onFileSelect = onFileSelect
  }

  onOpen() {
    const { contentEl } = this
    contentEl.createEl('h2', { text: 'Attach image' })

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
        new Notice('Image file is too large (max 10mb).')
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

  constructor(app: App, title: string, message: string, onConfirm: () => void) {
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