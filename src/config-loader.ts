import { TFile, Vault, TFolder } from 'obsidian'
import type { CompatibleProvider, Agent } from './types'

export interface OpenCodeConfig {
  providers?: Array<{
    id: string
    name: string
    baseURL: string
    apiType: 'openai-compatible' | 'anthropic-compatible'
    defaultModel?: string
  }>
}

export class ConfigLoader {
  private vault: Vault

  constructor(vault: Vault) {
    this.vault = vault
  }

  /**
   * Strip comments from JSONC content
   */
  private stripJsoncComments(content: string): string {
    // Remove single-line comments (// ...)
    let stripped = content.replace(/\/\/.*$/gm, '')
    
    // Remove multi-line comments (/* ... */)
    stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '')
    
    return stripped
  }

  /**
   * Load full config from .opencode/config.json, opencode.json, .opencode.json, opencode.jsonc, or .opencode/opencode.jsonc
   */
  async loadConfig(): Promise<OpenCodeConfig | null> {
    try {
      // Try .opencode/config.json first
      let configFile = this.vault.getAbstractFileByPath('.opencode/config.json')
      
      // Fallback to opencode.json in root
      if (!configFile || !(configFile instanceof TFile)) {
        configFile = this.vault.getAbstractFileByPath('opencode.json')
      }
      
      // Fallback to .opencode.json
      if (!configFile || !(configFile instanceof TFile)) {
        configFile = this.vault.getAbstractFileByPath('.opencode.json')
      }

      // Fallback to opencode.jsonc
      if (!configFile || !(configFile instanceof TFile)) {
        configFile = this.vault.getAbstractFileByPath('opencode.jsonc')
      }

      // Fallback to .opencode/opencode.jsonc
      if (!configFile || !(configFile instanceof TFile)) {
        configFile = this.vault.getAbstractFileByPath('.opencode/opencode.jsonc')
      }

      if (!configFile || !(configFile instanceof TFile)) {
        console.log('[ConfigLoader] No opencode config file found')
        return null
      }

      let content = await this.vault.read(configFile)
      if (!content || content.trim() === '') {
        console.warn('[ConfigLoader] Config file is empty')
        return null
      }
      
      // Strip comments if it's a JSONC file
      if (configFile.path.endsWith('.jsonc')) {
        content = this.stripJsoncComments(content)
      }
      
      const config: OpenCodeConfig = JSON.parse(content)
      
      // Validate config structure
      if (!config || typeof config !== 'object') {
        console.warn('[ConfigLoader] Invalid config file format')
        return null
      }
      
      console.log(`[ConfigLoader] Loaded config from ${configFile.path}`)
      return config
    } catch (error) {
      // Handle JSON parse errors specifically
      if (error instanceof SyntaxError) {
        console.error('[ConfigLoader] Invalid JSON in config file:', error.message)
      } else {
        console.error('[ConfigLoader] Error loading config:', error)
      }
      return null
    }
  }

  /**
   * Load compatible providers from config
   * API keys are merged from Obsidian settings (security: API keys not stored in config.json)
   */
  async loadCompatibleProviders(apiKeys: Record<string, string | undefined>): Promise<CompatibleProvider[]> {
    const config = await this.loadConfig()
    if (!config || !config.providers) {
      return []
    }

    const compatibleProviders: CompatibleProvider[] = []
    
    for (const providerConfig of config.providers) {
      // Validate required fields
      if (!providerConfig.baseURL || !providerConfig.apiType || !providerConfig.id) {
        console.warn(`[ConfigLoader] Skipping invalid provider config: missing required fields`, providerConfig)
        continue
      }
      
      // Get API key from settings (not from config.json for security)
      const apiKey = apiKeys[providerConfig.id] || ''
      
      compatibleProviders.push({
        id: providerConfig.id,
        name: providerConfig.name || providerConfig.id,
        apiKey: apiKey,
        baseURL: providerConfig.baseURL,
        apiType: providerConfig.apiType,
        defaultModel: providerConfig.defaultModel
      })
    }
    
    console.log(`[ConfigLoader] Loaded ${compatibleProviders.length} compatible provider(s) from config`)
    return compatibleProviders
  }

  /**
   * Check if .opencode directory exists
   */
  async hasOpenCodeDir(): Promise<boolean> {
    try {
      const folder = this.vault.getAbstractFileByPath('.opencode')
      return folder !== null && folder instanceof TFile === false // TFile check means it's a folder
    } catch {
      return false
    }
  }

  /**
   * Parse YAML frontmatter from markdown content
   * Returns frontmatter object and body content
   */
  private parseYamlFrontmatter(content: string): { frontmatter: Record<string, any>, body: string } {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/
    const match = content.match(frontmatterRegex)
    
    if (!match || !match[1]) {
      // No frontmatter found, return empty frontmatter and full content as body
      return { frontmatter: {}, body: content.trim() }
    }
    
    const frontmatterText = match[1]
    const body = match[2] || ''
    
    // Simple YAML parser for basic key-value pairs
    // This handles simple cases like: key: value, key: "value", key: true, key: false
    const frontmatter: Record<string, any> = {}
    const lines = frontmatterText.split('\n')
    
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      
      const colonIndex = trimmed.indexOf(':')
      if (colonIndex === -1) continue
      
      const key = trimmed.substring(0, colonIndex).trim()
      let value = trimmed.substring(colonIndex + 1).trim()
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      
      // Parse boolean values
      let parsedValue: any = value
      if (value === 'true') {
        parsedValue = true
      } else if (value === 'false') {
        parsedValue = false
      } else {
        // Handle nested objects (simple case for tools: { "*": false, "github-triage": true })
        if (value.startsWith('{') && value.endsWith('}')) {
          try {
            // Try to parse as JSON
            parsedValue = JSON.parse(value)
          } catch {
            // If JSON parsing fails, keep as string
            parsedValue = value
          }
        }
      }
      
      frontmatter[key] = parsedValue
    }
    
    return { frontmatter, body: body.trim() }
  }

  /**
   * Parse an agent file (markdown with YAML frontmatter)
   */
  private parseAgentFile(content: string, filename: string): Agent | null {
    try {
      const { frontmatter, body } = this.parseYamlFrontmatter(content)
      
      // Extract agent ID from filename (remove .md extension)
      const id = filename.replace(/\.md$/, '')
      
      // Get name from frontmatter or derive from ID
      const name = frontmatter.name || id.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ')
      
      // Parse model override if present
      let model: { providerID: string; modelID: string } | undefined
      if (frontmatter.model && typeof frontmatter.model === 'string') {
        const modelParts = frontmatter.model.split('/')
        if (modelParts.length === 2 && modelParts[0] && modelParts[1]) {
          model = {
            providerID: modelParts[0],
            modelID: modelParts[1]
          }
        } else {
          // Handle format like "opencode/claude-haiku-4-5" or just model ID
          if (modelParts.length === 1 && modelParts[0]) {
            // Assume default provider or use a fallback
            model = {
              providerID: 'anthropic', // Default fallback
              modelID: modelParts[0]
            }
          }
        }
      }
      
      // Parse tools configuration
      let tools: { [key: string]: boolean } | undefined
      if (frontmatter.tools) {
        if (typeof frontmatter.tools === 'object') {
          tools = frontmatter.tools
        }
      }
      
      const agent: Agent = {
        id,
        name,
        description: frontmatter.description,
        systemPrompt: body,
        model,
        tools,
        color: frontmatter.color,
        hidden: frontmatter.hidden === true,
        mode: frontmatter.mode
      }
      
      return agent
    } catch (error) {
      console.warn(`[ConfigLoader] Failed to parse agent file ${filename}:`, error)
      return null
    }
  }

  /**
   * Load agents from .opencode/agent/*.md files
   */
  async loadAgents(): Promise<Agent[]> {
    try {
      const agentDir = this.vault.getAbstractFileByPath('.opencode/agent')
      
      if (!agentDir || !(agentDir instanceof TFolder)) {
        console.log('[ConfigLoader] No .opencode/agent directory found')
        return []
      }
      
      const agents: Agent[] = []
      const files = agentDir.children.filter(file => file instanceof TFile && file.path.endsWith('.md'))
      
      for (const file of files) {
        if (!(file instanceof TFile)) continue
        
        try {
          const content = await this.vault.read(file)
          const agent = this.parseAgentFile(content, file.name)
          
          if (agent) {
            agents.push(agent)
            console.log(`[ConfigLoader] Loaded agent: ${agent.id} (${agent.name})`)
          }
        } catch (error) {
          console.warn(`[ConfigLoader] Failed to load agent file ${file.path}:`, error)
          // Continue loading other agents
        }
      }
      
      console.log(`[ConfigLoader] Loaded ${agents.length} agent(s) from .opencode/agent/`)
      return agents
    } catch (error) {
      console.error('[ConfigLoader] Error loading agents:', error)
      return []
    }
  }
}