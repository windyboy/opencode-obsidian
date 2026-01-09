import { Modal, Notice } from 'obsidian'
import type OpenCodeObsidianPlugin from './main'
import type { ModelInfo } from './types'

export class ModelSelectorModal extends Modal {
  private plugin: OpenCodeObsidianPlugin
  private onSelect: (model: { providerID: string; modelID: string }) => void
  private models: ModelInfo[] = []
  private filteredModels: ModelInfo[] = []
  private searchQuery: string = ''
  private expandedProviders: Set<string> = new Set(['anthropic', 'openai', 'google', 'zenmux'])
  private currentPage: number = 0
  private readonly ITEMS_PER_PAGE = 20
  private modelsContainer: HTMLElement | null = null

  constructor(
    app: any,
    plugin: OpenCodeObsidianPlugin,
    onSelect: (model: { providerID: string; modelID: string }) => void
  ) {
    super(app)
    this.plugin = plugin
    this.onSelect = onSelect
  }

  async onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('opencode-obsidian-model-selector-modal')

    // 标题
    contentEl.createEl('h2', { text: 'Select Model' })

    // 搜索框
    const searchContainer = contentEl.createDiv('opencode-obsidian-model-search-container')
    const searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: '🔍 Search models...',
      cls: 'opencode-obsidian-model-search-input'
    })
    
    searchInput.oninput = (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase()
      this.currentPage = 0 // Reset to first page on search
      this.applyFilters()
      this.renderModels()
    }

    // 模型列表容器
    const modelsContainer = contentEl.createDiv('opencode-obsidian-models-container')
    this.modelsContainer = modelsContainer

    // 加载模型
    await this.loadModels()
    this.applyFilters()
    this.renderModels()
  }

  private async loadModels() {
    this.models = []
    const availableProviders = this.plugin.providerManager.getAvailableProviders()
    
    for (const providerID of availableProviders) {
      try {
        const rawModels = await this.plugin.providerManager.fetchModels(providerID as any)
        rawModels.forEach(model => {
          this.models.push({
            id: model.id,
            name: model.name || this.formatModelName(model.id),
            providerID: providerID as any
          })
        })
      } catch (error) {
        console.error(`Failed to load models for ${providerID}:`, error)
      }
    }

    // 如果没有加载到模型，使用默认模型列表作为后备
    if (this.models.length === 0) {
      this.models = this.getDefaultModels()
    }

    // 按提供商和名称排序
    this.models.sort((a, b) => {
      if (a.providerID !== b.providerID) {
        return a.providerID.localeCompare(b.providerID)
      }
      return (a.name || a.id).localeCompare(b.name || b.id)
    })
  }

  private formatModelName(modelID: string): string {
    // 格式化模型名称，例如: claude-3-5-sonnet-20241022 -> Claude 3.5 Sonnet
    return modelID
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .replace(/\d{8}/g, '') // 移除日期
      .trim()
  }

  private getDefaultModels(): ModelInfo[] {
    return [
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        providerID: 'anthropic'
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        providerID: 'anthropic'
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        providerID: 'anthropic'
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        providerID: 'openai'
      },
      {
        id: 'gpt-4',
        name: 'GPT-4',
        providerID: 'openai'
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        providerID: 'openai'
      },
      {
        id: 'gemini-pro',
        name: 'Gemini Pro',
        providerID: 'google'
      }
    ]
  }

  private applyFilters() {
    let filtered = [...this.models]

    // 搜索过滤
    if (this.searchQuery) {
      filtered = filtered.filter(m => 
        m.id.toLowerCase().includes(this.searchQuery) ||
        (m.name && m.name.toLowerCase().includes(this.searchQuery))
      )
    }

    this.filteredModels = filtered
  }

  private renderModels() {
    if (!this.modelsContainer) return
    this.modelsContainer.empty()

    // 按提供商分组
    const grouped = this.groupByProvider(this.filteredModels)

    // 如果模型总数超过50，使用分页
    const totalModels = this.filteredModels.length
    const usePagination = totalModels > 50

    if (usePagination) {
      this.renderModelsWithPagination(grouped, totalModels)
    } else {
      this.renderAllModels(grouped)
    }

    if (this.filteredModels.length === 0) {
      const noModelsEl = this.modelsContainer.createDiv('opencode-obsidian-no-models')
      noModelsEl.textContent = 'No models found'
    }
  }

  private renderAllModels(grouped: Record<string, ModelInfo[]>) {
    Object.entries(grouped).forEach(([providerID, models]) => {
      this.renderProviderSection(providerID, models)
    })
  }

  private renderModelsWithPagination(grouped: Record<string, ModelInfo[]>, totalModels: number) {
    // 计算当前页应该显示哪些模型
    const start = this.currentPage * this.ITEMS_PER_PAGE
    const end = start + this.ITEMS_PER_PAGE
    let currentIndex = 0

    // 渲染当前页的模型
    Object.entries(grouped).forEach(([providerID, models]) => {
      const providerStart = currentIndex
      const providerEnd = currentIndex + models.length

      if (providerEnd > start && providerStart < end) {
        // 这个提供商有模型在当前页
        const pageStart = Math.max(0, start - providerStart)
        const pageEnd = Math.min(models.length, end - providerStart)
        const pageModels = models.slice(pageStart, pageEnd)
        
        if (pageModels.length > 0) {
          this.renderProviderSection(providerID, pageModels, models.length)
        }
      }

      currentIndex += models.length
    })

    // 分页控件
    const totalPages = Math.ceil(totalModels / this.ITEMS_PER_PAGE)
    if (totalPages > 1) {
      const pagination = this.modelsContainer!.createDiv('opencode-obsidian-pagination')
      
      const prevBtn = pagination.createEl('button', { 
        text: '← Previous',
        cls: 'opencode-obsidian-pagination-btn'
      })
      prevBtn.disabled = this.currentPage === 0
      prevBtn.onclick = () => {
        if (this.currentPage > 0) {
          this.currentPage--
          this.renderModels()
        }
      }

      pagination.createSpan({
        text: `Page ${this.currentPage + 1} of ${totalPages}`,
        cls: 'opencode-obsidian-page-info'
      })

      const nextBtn = pagination.createEl('button', { 
        text: 'Next →',
        cls: 'opencode-obsidian-pagination-btn'
      })
      nextBtn.disabled = this.currentPage >= totalPages - 1
      nextBtn.onclick = () => {
        if (this.currentPage < totalPages - 1) {
          this.currentPage++
          this.renderModels()
        }
      }
    }
  }

  private renderProviderSection(providerID: string, models: ModelInfo[], totalCount?: number) {
    const providerSection = this.modelsContainer!.createDiv('opencode-obsidian-model-provider-section')
    
    const providerHeader = providerSection.createDiv('opencode-obsidian-model-provider-header')
    const toggleBtn = providerHeader.createEl('button', {
      cls: 'opencode-obsidian-provider-toggle',
      text: this.expandedProviders.has(providerID) ? '▼' : '▶'
    })
    
    const countText = totalCount && totalCount !== models.length ? ` (${models.length}/${totalCount})` : ` (${models.length})`
    providerHeader.createEl('h3', {
      text: `${this.formatProviderName(providerID)}${countText}`
    })

    const modelsList = providerSection.createDiv('opencode-obsidian-models-list')
    const isExpanded = this.expandedProviders.has(providerID)
    modelsList.style.display = isExpanded ? '' : 'none'

    toggleBtn.onclick = () => {
      const isCurrentlyExpanded = this.expandedProviders.has(providerID)
      if (isCurrentlyExpanded) {
        this.expandedProviders.delete(providerID)
        modelsList.style.display = 'none'
        toggleBtn.textContent = '▶'
      } else {
        this.expandedProviders.add(providerID)
        modelsList.style.display = ''
        toggleBtn.textContent = '▼'
      }
    }

    models.forEach(model => {
      this.createModelCard(modelsList, model)
    })
  }

  private createModelCard(container: HTMLElement, model: ModelInfo): HTMLElement {
    const card = container.createDiv('opencode-obsidian-model-card')
    const isSelected = model.id === this.plugin.settings.model.modelID && 
                      model.providerID === this.plugin.settings.model.providerID

    if (isSelected) {
      card.addClass('selected')
    }

    // 模型名称
    const nameEl = card.createDiv('opencode-obsidian-model-card-name')
    nameEl.textContent = model.name || model.id

    // 模型ID（小字）
    const idEl = card.createDiv('opencode-obsidian-model-card-id')
    idEl.textContent = model.id

    // 点击选择
    card.onclick = () => {
      this.onSelect({
        providerID: model.providerID,
        modelID: model.id
      })
      new Notice(`Model set to ${model.name || model.id}`)
      this.close()
    }

    return card
  }

  private groupByProvider(models: ModelInfo[]): Record<string, ModelInfo[]> {
    return models.reduce((acc, model) => {
      if (!acc[model.providerID]) {
        acc[model.providerID] = []
      }
      acc[model.providerID]!.push(model)
      return acc
    }, {} as Record<string, ModelInfo[]>)
  }

  private formatProviderName(providerID: string): string {
    // Check if it's a compatible provider first
    const compatibleProvider = this.plugin.settings.compatibleProviders?.find(p => p.id === providerID)
    if (compatibleProvider) {
      return `${compatibleProvider.name} (${compatibleProvider.apiType})`
    }
    
    // Built-in providers
    const names: Record<string, string> = {
      anthropic: 'Anthropic (Claude)',
      openai: 'OpenAI (GPT)',
      google: 'Google (Gemini)',
      zenmux: 'ZenMux'
    }
    return names[providerID] || providerID.charAt(0).toUpperCase() + providerID.slice(1)
  }

  onClose() {
    const { contentEl } = this
    contentEl.empty()
  }
}
