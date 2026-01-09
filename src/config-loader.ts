import { TFile, Vault, TFolder } from 'obsidian'
import type { CompatibleProvider, Agent, Skill } from './types'
import * as yaml from 'js-yaml'

export interface OpenCodeConfig {
  providers?: Array<{
    id: string
    name: string
    baseURL: string
    apiType: 'openai-compatible' | 'anthropic-compatible'
    defaultModel?: string
  }>
  instructions?: string[] // Array of file paths or glob patterns
}

export interface InstructionCache {
  content: string
  path: string
  lastModified: number
}

/**
 * YAML frontmatter structure for Agent files
 */
export interface AgentFrontmatter extends Record<string, unknown> {
  name?: string
  description?: string
  model?: string // Format: "providerID/modelID" or just "modelID"
  tools?: Record<string, boolean> // Tool enablement config
  skills?: string[] | string // Array of skill IDs or single skill ID
  color?: string // UI color (e.g., "#38A3EE")
  hidden?: boolean
  mode?: string // e.g., "primary"
}

/**
 * YAML frontmatter structure for Skill files
 */
export interface SkillFrontmatter extends Record<string, unknown> {
  name?: string
  description?: string
}

/**
 * Parsed frontmatter result with type-safe structure
 */
export interface ParsedFrontmatter<T = AgentFrontmatter | SkillFrontmatter> {
  frontmatter: T
  body: string
}

export class ConfigLoader {
  private vault: Vault
  private instructionCache: Map<string, InstructionCache> = new Map()
  private mergedInstructions: string = '' // Cached merged instructions content

  /**
   * Configuration file paths in priority order
   * Higher priority files are checked first
   */
  private static readonly CONFIG_FILE_PRIORITY = [
    '.opencode/config.json',
    'opencode.json',
    '.opencode.json',
    'opencode.jsonc',
    '.opencode/opencode.jsonc',
  ] as const

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
   * Load full config from configuration files in priority order
   * Checks files in CONFIG_FILE_PRIORITY order and returns the first found
   */
  async loadConfig(): Promise<OpenCodeConfig | null> {
    try {
      // Try each config file path in priority order
      let configFile: TFile | null = null
      
      for (const configPath of ConfigLoader.CONFIG_FILE_PRIORITY) {
        const file = this.vault.getAbstractFileByPath(configPath)
        if (file instanceof TFile) {
          configFile = file
          break
        }
      }

      if (!configFile) {
        console.log('[ConfigLoader] No opencode config file found (checked:', ConfigLoader.CONFIG_FILE_PRIORITY.join(', '), ')')
        return null
      }

      const content = await this.vault.read(configFile)
      if (!content || content.trim() === '') {
        console.warn(`[ConfigLoader] Config file is empty: ${configFile.path}`)
        return null
      }
      
      // Strip comments if it's a JSONC file
      const processedContent = configFile.path.endsWith('.jsonc')
        ? this.stripJsoncComments(content)
        : content
      
      const config: OpenCodeConfig = JSON.parse(processedContent)
      
      // Validate config structure
      if (!config || typeof config !== 'object') {
        console.warn(`[ConfigLoader] Invalid config file format: ${configFile.path}`)
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
   * Parse YAML frontmatter from markdown content using js-yaml library
   * Returns frontmatter object and body content with type safety
   * 
   * Supports full YAML syntax including:
   * - Complex nested objects and arrays
   * - Multi-line strings
   * - YAML anchors and aliases
   * - Various data types (strings, numbers, booleans, null, dates)
   */
  private parseYamlFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
    content: string
  ): ParsedFrontmatter<T> {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/
    const match = content.match(frontmatterRegex)
    
    if (!match || !match[1]) {
      // No frontmatter found, return empty frontmatter and full content as body
      return { frontmatter: {} as T, body: content.trim() }
    }
    
    const frontmatterText = match[1]
    const body = match[2] || ''
    
    try {
      // Use js-yaml to parse YAML frontmatter
      // yaml.load() is safe by default in js-yaml 4.x, preventing code execution
      const frontmatter = yaml.load(frontmatterText, {
        schema: yaml.DEFAULT_SCHEMA,
        json: true, // Use JSON-compatible types for better TypeScript compatibility
      }) as Record<string, unknown>
      
      // Ensure frontmatter is an object
      if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
        console.warn('[ConfigLoader] YAML frontmatter is not an object, using empty object')
        return { frontmatter: {} as T, body: body.trim() }
      }
      
      return { frontmatter: frontmatter as T, body: body.trim() }
    } catch (error) {
      // Handle YAML parsing errors gracefully
      if (error instanceof yaml.YAMLException) {
        console.warn(`[ConfigLoader] Failed to parse YAML frontmatter: ${error.message}`)
      } else {
        console.warn('[ConfigLoader] Unexpected error parsing YAML frontmatter:', error)
      }
      
      // Return empty frontmatter on parse error, but keep the body
      return { frontmatter: {} as T, body: body.trim() }
    }
  }

  /**
   * Parse an agent file (markdown with YAML frontmatter)
   */
  private parseAgentFile(content: string, filename: string): Agent | null {
    try {
      const { frontmatter, body } = this.parseYamlFrontmatter<AgentFrontmatter>(content)
      
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
      
      // Parse skills array
      let skills: string[] | undefined
      if (frontmatter.skills) {
        if (Array.isArray(frontmatter.skills)) {
          skills = frontmatter.skills.filter((s): s is string => typeof s === 'string')
        } else if (typeof frontmatter.skills === 'string') {
          // Handle single skill as string
          skills = [frontmatter.skills]
        }
      }
      
      const agent: Agent = {
        id,
        name,
        description: frontmatter.description,
        systemPrompt: body,
        model,
        tools,
        skills,
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
   * Parse a skill file (markdown with YAML frontmatter)
   */
  private parseSkillFile(content: string, skillDirName: string): Skill | null {
    try {
      const { frontmatter, body } = this.parseYamlFrontmatter<SkillFrontmatter>(content)
      
      // Use directory name as skill ID
      const id = skillDirName
      
      // Get name from frontmatter or derive from ID
      const name = frontmatter.name || id.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ')
      
      const skill: Skill = {
        id,
        name,
        description: frontmatter.description,
        content: body
      }
      
      return skill
    } catch (error) {
      console.warn(`[ConfigLoader] Failed to parse skill file in ${skillDirName}:`, error)
      return null
    }
  }

  /**
   * Load skills from .opencode/skill/{skill-name}/SKILL.md files
   */
  async loadSkills(): Promise<Skill[]> {
    try {
      const skillDir = this.vault.getAbstractFileByPath('.opencode/skill')
      
      if (!skillDir || !(skillDir instanceof TFolder)) {
        console.log('[ConfigLoader] No .opencode/skill directory found')
        return []
      }
      
      const skills: Skill[] = []
      
      // Iterate through subdirectories in .opencode/skill/
      for (const child of skillDir.children) {
        if (!(child instanceof TFolder)) continue
        
        // Look for SKILL.md file in this subdirectory
        const skillFile = child.children.find(
          file => file instanceof TFile && file.name === 'SKILL.md'
        )
        
        if (!(skillFile instanceof TFile)) {
          console.warn(`[ConfigLoader] No SKILL.md found in ${child.path}`)
          continue
        }
        
        try {
          const content = await this.vault.read(skillFile)
          const skill = this.parseSkillFile(content, child.name)
          
          if (skill) {
            skills.push(skill)
            console.log(`[ConfigLoader] Loaded skill: ${skill.id} (${skill.name})`)
          }
        } catch (error) {
          console.warn(`[ConfigLoader] Failed to load skill file ${skillFile.path}:`, error)
          // Continue loading other skills
        }
      }
      
      console.log(`[ConfigLoader] Loaded ${skills.length} skill(s) from .opencode/skill/`)
      return skills
    } catch (error) {
      console.error('[ConfigLoader] Error loading skills:', error)
      return []
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

  /**
   * Convert glob pattern to regex pattern
   * Supports basic glob patterns: *, **, ?
   */
  private globToRegex(glob: string): RegExp {
    // Escape special regex characters except * and ?
    let pattern = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      // Convert ** to match any path separator
      .replace(/\*\*/g, '___GLOB_STAR_STAR___')
      // Convert * to match any characters except path separator
      .replace(/\*/g, '[^/]*')
      // Convert ? to match single character except path separator
      .replace(/\?/g, '[^/]')
      // Restore ** to match any characters including path separators
      .replace(/___GLOB_STAR_STAR___/g, '.*')
    
    return new RegExp(`^${pattern}$`)
  }

  /**
   * Find files matching a glob pattern
   */
  private findFilesByGlob(pattern: string): TFile[] {
    const regex = this.globToRegex(pattern)
    const matchingFiles: TFile[] = []
    
    // Recursively search through vault
    const searchInFolder = (folder: TFolder | null) => {
      if (!folder) return
      
      for (const child of folder.children) {
        if (child instanceof TFile) {
          // Check if file path matches pattern
          if (regex.test(child.path)) {
            matchingFiles.push(child)
          }
        } else if (child instanceof TFolder) {
          searchInFolder(child)
        }
      }
    }
    
    // Start from root
    const rootFolder = this.vault.getRoot()
    searchInFolder(rootFolder)
    
    return matchingFiles
  }

  /**
   * Load instruction files from config.json instructions array or provided instructions array
   * Supports glob patterns and caches content
   * @param customInstructions Optional instructions array from settings (will be merged with config.json)
   */
  async loadInstructions(customInstructions?: string[]): Promise<string> {
    try {
      const config = await this.loadConfig()
      
      // Merge instructions from config.json and settings
      const instructions: string[] = []
      
      // Add instructions from config.json first
      if (config && config.instructions && Array.isArray(config.instructions)) {
        instructions.push(...config.instructions)
      }
      
      // Add custom instructions from settings (avoid duplicates)
      if (customInstructions && Array.isArray(customInstructions)) {
        for (const customInstruction of customInstructions) {
          if (customInstruction && !instructions.includes(customInstruction)) {
            instructions.push(customInstruction)
          }
        }
      }
      
      if (instructions.length === 0) {
        console.log('[ConfigLoader] No instructions found in config or settings')
        return ''
      }

      const instructionContents: string[] = []
      const filesToLoad: TFile[] = []

      // Collect all files matching patterns
      for (const pattern of instructions) {
        if (!pattern || typeof pattern !== 'string') {
          console.warn('[ConfigLoader] Invalid instruction pattern:', pattern)
          continue
        }

        // Check if pattern contains glob characters
        const hasGlob = pattern.includes('*') || pattern.includes('?')
        
        if (hasGlob) {
          // Use glob pattern matching
          const matchedFiles = this.findFilesByGlob(pattern)
          filesToLoad.push(...matchedFiles)
          console.log(`[ConfigLoader] Glob pattern "${pattern}" matched ${matchedFiles.length} file(s)`)
        } else {
          // Direct file path
          const file = this.vault.getAbstractFileByPath(pattern)
          if (file instanceof TFile) {
            filesToLoad.push(file)
          } else {
            console.warn(`[ConfigLoader] Instruction file not found: ${pattern}`)
          }
        }
      }

      // Remove duplicates
      const uniqueFiles = Array.from(new Set(filesToLoad.map(f => f.path)))
        .map(path => filesToLoad.find(f => f.path === path))
        .filter((f): f is TFile => f instanceof TFile)

      // Load and cache file contents
      for (const file of uniqueFiles) {
        try {
          // Check cache first
          const cached = this.instructionCache.get(file.path)
          const fileStat = file.stat
          const lastModified = fileStat.mtime

          let content: string
          if (cached && cached.lastModified === lastModified) {
            // Use cached content
            content = cached.content
            console.log(`[ConfigLoader] Using cached instruction: ${file.path}`)
          } else {
            // Load and cache
            content = await this.vault.read(file)
            this.instructionCache.set(file.path, {
              content,
              path: file.path,
              lastModified
            })
            console.log(`[ConfigLoader] Loaded and cached instruction: ${file.path}`)
          }

          instructionContents.push(`\n\n---\n# ${file.name}\n---\n\n${content}`)
        } catch (error) {
          console.warn(`[ConfigLoader] Failed to load instruction file ${file.path}:`, error)
          // Continue loading other files
        }
      }

      const mergedInstructions = instructionContents.join('\n\n')
      this.mergedInstructions = mergedInstructions
      console.log(`[ConfigLoader] Loaded ${uniqueFiles.length} instruction file(s), total length: ${mergedInstructions.length} chars`)
      return mergedInstructions
    } catch (error) {
      console.error('[ConfigLoader] Error loading instructions:', error)
      return ''
    }
  }

  /**
   * Clear instruction cache (useful for reloading)
   */
  clearInstructionCache(): void {
    this.instructionCache.clear()
    this.mergedInstructions = ''
    console.log('[ConfigLoader] Instruction cache cleared')
  }

  /**
   * Get cached merged instruction content
   * Returns the merged instructions that were loaded by loadInstructions()
   */
  getCachedInstructions(): string {
    return this.mergedInstructions
  }
}