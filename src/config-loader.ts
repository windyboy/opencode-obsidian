import { TFile, Vault, TFolder } from 'obsidian'
import type { CompatibleProvider, Agent, Skill } from './types'
import * as yaml from 'js-yaml'
import { SECURITY_CONFIG } from './utils/constants'
import { validateOpenCodeConfig, validateProviderConfig, validateAgent, validateAgentFrontmatter, validateSkill, validateSkillFrontmatter } from './utils/validators'

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

/**
 * Configuration Loader
 * 
 * Loads and parses configuration files from the Obsidian vault including:
 * - Main configuration file (config.json) with priority-based lookup
 * - Agent files from `.opencode/agent/*.md`
 * - Skill files from `.opencode/skill/{skill-name}/SKILL.md`
 * - Instruction files with glob pattern support
 * 
 * Includes comprehensive security validations:
 * - File path validation (prevents path traversal)
 * - File size limits (prevents DoS attacks)
 * - JSON structure validation (prevents deep nesting DoS)
 * - Input validation using validators
 * 
 * @class ConfigLoader
 */
export class ConfigLoader {
  private vault: Vault
  private instructionCache: Map<string, InstructionCache> = new Map()
  private mergedInstructions: string = '' // Cached merged instructions content

  /**
   * Configuration file paths in priority order
   * Higher priority files are checked first and used if found
   * 
   * Priority order:
   * 1. .opencode/config.json (highest priority)
   * 2. opencode.json
   * 3. .opencode.json
   * 4. opencode.jsonc
   * 5. .opencode/opencode.jsonc (lowest priority)
   */
  private static readonly CONFIG_FILE_PRIORITY = [
    '.opencode/config.json',
    'opencode.json',
    '.opencode.json',
    'opencode.jsonc',
    '.opencode/opencode.jsonc',
  ] as const

  /**
   * Create a new ConfigLoader instance
   * 
   * @param {Vault} vault - Obsidian vault instance for file operations
   */
  constructor(vault: Vault) {
    this.vault = vault
  }

  /**
   * Validate file path to prevent path traversal attacks
   * Returns true if path is safe, false otherwise
   */
  private validateFilePath(path: string): boolean {
    // Check path length
    if (path.length > SECURITY_CONFIG.MAX_FILE_PATH_LENGTH) {
      console.warn(`[ConfigLoader] File path too long: ${path.length} characters (max: ${SECURITY_CONFIG.MAX_FILE_PATH_LENGTH})`)
      return false
    }

    // Normalize path and check for path traversal attempts
    // Paths should not contain '..', should not start with '/' (absolute paths), 
    // and should not contain null bytes or other dangerous characters
    if (path.includes('..') || path.startsWith('/') || path.includes('\0')) {
      console.warn(`[ConfigLoader] Unsafe file path detected: ${path}`)
      return false
    }

    // Additional check: ensure path doesn't escape vault root using backslashes (Windows)
    const normalizedPath = path.replace(/\\/g, '/')
    if (normalizedPath.includes('../') || normalizedPath.startsWith('../')) {
      console.warn(`[ConfigLoader] Path traversal attempt detected: ${path}`)
      return false
    }

    return true
  }

  /**
   * Validate file size before reading
   * Returns true if file size is acceptable, false otherwise
   */
  private validateFileSize(file: TFile, maxSize: number): boolean {
    const fileSize = file.stat.size
    if (fileSize > maxSize) {
      console.warn(`[ConfigLoader] File too large: ${file.path} (${fileSize} bytes, max: ${maxSize} bytes)`)
      return false
    }
    return true
  }

  /**
   * Validate JSON structure depth and complexity to prevent DoS attacks
   * Returns true if JSON is safe, false otherwise
   */
  private validateJsonStructure(obj: unknown, depth: number = 0, propertyCount: { count: number } = { count: 0 }): boolean {
    // Check depth
    if (depth > SECURITY_CONFIG.MAX_JSON_DEPTH) {
      console.warn(`[ConfigLoader] JSON structure too deep: ${depth} levels (max: ${SECURITY_CONFIG.MAX_JSON_DEPTH})`)
      return false
    }

    // Check property count
    if (propertyCount.count > SECURITY_CONFIG.MAX_JSON_PROPERTIES) {
      console.warn(`[ConfigLoader] JSON structure too complex: ${propertyCount.count} properties (max: ${SECURITY_CONFIG.MAX_JSON_PROPERTIES})`)
      return false
    }

    // Validate strings
    if (typeof obj === 'string') {
      if (obj.length > SECURITY_CONFIG.MAX_JSON_STRING_LENGTH) {
        console.warn(`[ConfigLoader] JSON string too long: ${obj.length} characters (max: ${SECURITY_CONFIG.MAX_JSON_STRING_LENGTH})`)
        return false
      }
      return true
    }

    // Validate arrays
    if (Array.isArray(obj)) {
      for (const item of obj) {
        propertyCount.count++
        if (!this.validateJsonStructure(item, depth + 1, propertyCount)) {
          return false
        }
      }
      return true
    }

    // Validate objects
    if (obj && typeof obj === 'object') {
      for (const key in obj) {
        propertyCount.count++
        if (propertyCount.count > SECURITY_CONFIG.MAX_JSON_PROPERTIES) {
          return false
        }
        const value = (obj as Record<string, unknown>)[key]
        if (!this.validateJsonStructure(value, depth + 1, propertyCount)) {
          return false
        }
      }
      return true
    }

    // Primitive types (number, boolean, null) are safe
    return true
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
   * Includes security validations: file path, file size, and JSON structure
   */
  async loadConfig(): Promise<OpenCodeConfig | null> {
    try {
      // Try each config file path in priority order
      let configFile: TFile | null = null
      
      for (const configPath of ConfigLoader.CONFIG_FILE_PRIORITY) {
        // Validate file path
        if (!this.validateFilePath(configPath)) {
          continue
        }

        const file = this.vault.getAbstractFileByPath(configPath)
        if (file instanceof TFile) {
          configFile = file
          break
        }
      }

      if (!configFile) {
        console.debug('[ConfigLoader] No opencode config file found (checked:', ConfigLoader.CONFIG_FILE_PRIORITY.join(', '), ')')
        return null
      }

      // Validate file size
      if (!this.validateFileSize(configFile, SECURITY_CONFIG.MAX_CONFIG_FILE_SIZE)) {
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
      
      let config: OpenCodeConfig
      try {
        config = JSON.parse(processedContent) as OpenCodeConfig
      } catch (parseError) {
        if (parseError instanceof SyntaxError) {
          console.error(`[ConfigLoader] Invalid JSON in config file ${configFile.path}: ${parseError.message}`)
        } else {
          console.error(`[ConfigLoader] Error parsing JSON in config file ${configFile.path}:`, parseError)
        }
        return null
      }
      
      // Validate JSON structure (depth, complexity)
      if (!this.validateJsonStructure(config)) {
        console.warn(`[ConfigLoader] JSON structure validation failed for ${configFile.path}`)
        return null
      }
      
      // Validate config using validator
      const validationResult = validateOpenCodeConfig(config, { strict: false })
      if (!validationResult.valid) {
        console.warn(`[ConfigLoader] Config validation failed for ${configFile.path}:`)
        validationResult.errors.forEach(error => console.warn(`  - ${error}`))
        validationResult.warnings.forEach(warning => console.warn(`  - ${warning}`))
        // Continue loading even with warnings, but fail on errors
        if (validationResult.errors.length > 0) {
          return null
        }
      }
      
      console.debug(`[ConfigLoader] Loaded config from ${configFile.path}`)
      return config
    } catch (error) {
      console.error('[ConfigLoader] Error loading config:', error)
      return null
    }
  }

  /**
   * Load compatible providers from configuration file
   * 
   * Loads provider definitions from config.json and merges API keys from Obsidian settings.
   * API keys are stored securely in Obsidian settings, not in config.json files.
   * All providers are validated using validateProviderConfig before being returned.
   * 
   * @param {Record<string, string | undefined>} apiKeys - API keys from Obsidian settings, keyed by provider ID
   * @returns {Promise<CompatibleProvider[]>} Array of validated compatible providers with API keys merged
   * 
   * @example
   * ```typescript
   * const apiKeys = { 'my-provider': 'sk-...', 'another-provider': 'sk-...' }
   * const providers = await configLoader.loadCompatibleProviders(apiKeys)
   * ```
   */
  async loadCompatibleProviders(apiKeys: Record<string, string | undefined>): Promise<CompatibleProvider[]> {
    const config = await this.loadConfig()
    if (!config || !config.providers) {
      return []
    }

    const compatibleProviders: CompatibleProvider[] = []
    
    for (const providerConfig of config.providers) {
      // Validate provider config using validator
      const validationResult = validateProviderConfig(providerConfig, { strict: false })
      if (!validationResult.valid) {
        console.warn(`[ConfigLoader] Skipping invalid provider config:`, providerConfig)
        validationResult.errors.forEach((errorMsg: string) => console.warn(`  - ${errorMsg}`))
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
    
    console.debug(`[ConfigLoader] Loaded ${compatibleProviders.length} compatible provider(s) from config`)
    return compatibleProviders
  }

  /**
   * Check if .opencode directory exists in the vault
   * 
   * @returns {Promise<boolean>} True if .opencode directory exists, false otherwise
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
   * Includes validation of frontmatter and agent structure
   */
  private parseAgentFile(content: string, filename: string): Agent | null {
    try {
      // Validate filename path
      if (!this.validateFilePath(filename)) {
        console.warn(`[ConfigLoader] Invalid agent filename: ${filename}`)
        return null
      }

      const { frontmatter, body } = this.parseYamlFrontmatter<AgentFrontmatter>(content)
      
      // Validate frontmatter
      const frontmatterValidation = validateAgentFrontmatter(frontmatter, { strict: false })
      if (!frontmatterValidation.valid && frontmatterValidation.errors.length > 0) {
        console.warn(`[ConfigLoader] Agent frontmatter validation failed for ${filename}:`)
        frontmatterValidation.errors.forEach(error => console.warn(`  - ${error}`))
        // Continue parsing even with warnings, but skip on critical errors
        if (frontmatterValidation.errors.some(e => e.includes('must be') && !e.includes('cannot be empty'))) {
          return null
        }
      }
      
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
      
      // Validate agent structure
      const agentValidation = validateAgent(agent, { strict: false })
      if (!agentValidation.valid) {
        console.warn(`[ConfigLoader] Agent validation failed for ${filename}:`)
        agentValidation.errors.forEach(error => console.warn(`  - ${error}`))
        // Return null on validation errors (these are critical)
        if (agentValidation.errors.length > 0) {
          return null
        }
      }
      
      return agent
    } catch (error) {
      console.warn(`[ConfigLoader] Failed to parse agent file ${filename}:`, error)
      return null
    }
  }

  /**
   * Parse a skill file (markdown with YAML frontmatter)
   * Includes validation of frontmatter and skill structure
   */
  private parseSkillFile(content: string, skillDirName: string): Skill | null {
    try {
      // Validate directory name path
      if (!this.validateFilePath(skillDirName)) {
        console.warn(`[ConfigLoader] Invalid skill directory name: ${skillDirName}`)
        return null
      }

      const { frontmatter, body } = this.parseYamlFrontmatter<SkillFrontmatter>(content)
      
      // Validate frontmatter
      const frontmatterValidation = validateSkillFrontmatter(frontmatter, { strict: false })
      if (!frontmatterValidation.valid && frontmatterValidation.errors.length > 0) {
        console.warn(`[ConfigLoader] Skill frontmatter validation failed for ${skillDirName}:`)
        frontmatterValidation.errors.forEach(error => console.warn(`  - ${error}`))
      }
      
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
      
      // Validate skill structure
      const skillValidation = validateSkill(skill, { strict: false })
      if (!skillValidation.valid) {
        console.warn(`[ConfigLoader] Skill validation failed for ${skillDirName}:`)
        skillValidation.errors.forEach(error => console.warn(`  - ${error}`))
        // Return null on validation errors (these are critical)
        if (skillValidation.errors.length > 0) {
          return null
        }
      }
      
      return skill
    } catch (error) {
      console.warn(`[ConfigLoader] Failed to parse skill file in ${skillDirName}:`, error)
      return null
    }
  }

  /**
   * Load skills from .opencode/skill/{skill-name}/SKILL.md files
   * 
   * Each skill is loaded from a directory structure:
   * - Directory name becomes the skill ID
   * - SKILL.md file contains the skill content with YAML frontmatter
   * 
   * All skills are validated using validateSkill before being returned.
   * Invalid skills are skipped with warnings, but don't prevent loading other skills.
   * 
   * @returns {Promise<Skill[]>} Array of loaded and validated skills
   * 
   * @example
   * const skills = await configLoader.loadSkills()
   * // Returns: [{ id: 'code-review', name: 'Code Review', content: '...' }, ...]
   */
  async loadSkills(): Promise<Skill[]> {
    try {
      const skillDir = this.vault.getAbstractFileByPath('.opencode/skill')
      
      if (!skillDir || !(skillDir instanceof TFolder)) {
        console.debug('[ConfigLoader] No .opencode/skill directory found')
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
          // Validate file path and size
          if (!this.validateFilePath(skillFile.path)) {
            console.warn(`[ConfigLoader] Invalid skill file path: ${skillFile.path}`)
            continue
          }
          if (!this.validateFileSize(skillFile, SECURITY_CONFIG.MAX_SKILL_FILE_SIZE)) {
            continue
          }

          const content = await this.vault.read(skillFile)
          const skill = this.parseSkillFile(content, child.name)
          
          if (skill) {
            skills.push(skill)
            console.debug(`[ConfigLoader] Loaded skill: ${skill.id} (${skill.name})`)
          }
        } catch (error) {
          console.warn(`[ConfigLoader] Failed to load skill file ${skillFile.path}:`, error)
          // Continue loading other skills
        }
      }
      
      console.debug(`[ConfigLoader] Loaded ${skills.length} skill(s) from .opencode/skill/`)
      return skills
    } catch (error) {
      console.error('[ConfigLoader] Error loading skills:', error)
      return []
    }
  }

  /**
   * Load agents from .opencode/agent/*.md files
   * 
   * Each markdown file in .opencode/agent/ becomes an agent:
   * - Filename (without .md) becomes the agent ID
   * - YAML frontmatter contains agent metadata
   * - Markdown body becomes the system prompt
   * 
   * All agents are validated using validateAgent and validateAgentFrontmatter.
   * Invalid agents are skipped with warnings, but don't prevent loading other agents.
   * 
   * @returns {Promise<Agent[]>} Array of loaded and validated agents
   * 
   * @example
   * const agents = await configLoader.loadAgents()
   * // Returns: [{ id: 'assistant', name: 'Assistant', systemPrompt: '...' }, ...]
   */
  async loadAgents(): Promise<Agent[]> {
    try {
      const agentDir = this.vault.getAbstractFileByPath('.opencode/agent')
      
      if (!agentDir || !(agentDir instanceof TFolder)) {
        console.debug('[ConfigLoader] No .opencode/agent directory found')
        return []
      }
      
      const agents: Agent[] = []
      const files = agentDir.children.filter(file => file instanceof TFile && file.path.endsWith('.md'))
      
      for (const file of files) {
        if (!(file instanceof TFile)) continue
        
        try {
          // Validate file path and size
          if (!this.validateFilePath(file.path)) {
            console.warn(`[ConfigLoader] Invalid agent file path: ${file.path}`)
            continue
          }
          if (!this.validateFileSize(file, SECURITY_CONFIG.MAX_AGENT_FILE_SIZE)) {
            continue
          }

          const content = await this.vault.read(file)
          const agent = this.parseAgentFile(content, file.name)
          
          if (agent) {
            agents.push(agent)
            console.debug(`[ConfigLoader] Loaded agent: ${agent.id} (${agent.name})`)
          }
        } catch (error) {
          console.warn(`[ConfigLoader] Failed to load agent file ${file.path}:`, error)
          // Continue loading other agents
        }
      }
      
      console.debug(`[ConfigLoader] Loaded ${agents.length} agent(s) from .opencode/agent/`)
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
   * Load instruction files from config.json or custom instructions array
   * 
   * Supports both direct file paths and glob patterns (e.g., double-star-slash-star-dot-md, docs/rules.md).
   * Instruction files are cached based on modification time to avoid unnecessary re-reading.
   * All files are validated for path safety and size limits before loading.
   * 
   * Instructions are merged with separators and formatted with headers.
   * The merged result is cached for quick access via getCachedInstructions().
   * 
   * @param {string[]} [customInstructions] - Optional instructions array from settings. Will be merged with config.json instructions, avoiding duplicates.
   * @returns {Promise<string>} Merged instruction content with formatted sections, or empty string if no instructions found
   * 
   * @example
   * // Load from config.json
   * const instructions = await configLoader.loadInstructions()
   * 
   * // Load with custom instructions
   * const instructions = await configLoader.loadInstructions(['docs/rules.md', 'guidelines/*.md'])
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
        console.debug('[ConfigLoader] No instructions found in config or settings')
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
          console.debug(`[ConfigLoader] Glob pattern "${pattern}" matched ${matchedFiles.length} file(s)`)
        } else {
          // Direct file path - validate path first
          if (!this.validateFilePath(pattern)) {
            console.warn(`[ConfigLoader] Invalid instruction file path: ${pattern}`)
            continue
          }

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
          // Validate file path and size
          if (!this.validateFilePath(file.path)) {
            console.warn(`[ConfigLoader] Invalid instruction file path: ${file.path}`)
            continue
          }
          if (!this.validateFileSize(file, SECURITY_CONFIG.MAX_INSTRUCTION_FILE_SIZE)) {
            continue
          }

          // Check cache first
          const cached = this.instructionCache.get(file.path)
          const fileStat = file.stat
          const lastModified = fileStat.mtime

          let content: string
          if (cached && cached.lastModified === lastModified) {
            // Use cached content
            content = cached.content
            console.debug(`[ConfigLoader] Using cached instruction: ${file.path}`)
          } else {
            // Load and cache
            content = await this.vault.read(file)
            
            // Validate content size (additional check after reading)
            if (content.length > SECURITY_CONFIG.MAX_INSTRUCTION_FILE_SIZE) {
              console.warn(`[ConfigLoader] Instruction file content too large: ${file.path} (${content.length} bytes, max: ${SECURITY_CONFIG.MAX_INSTRUCTION_FILE_SIZE} bytes)`)
              continue
            }

            this.instructionCache.set(file.path, {
              content,
              path: file.path,
              lastModified
            })
            console.debug(`[ConfigLoader] Loaded and cached instruction: ${file.path}`)
          }

          instructionContents.push(`\n\n---\n# ${file.name}\n---\n\n${content}`)
        } catch (error) {
          console.warn(`[ConfigLoader] Failed to load instruction file ${file.path}:`, error)
          // Continue loading other files
        }
      }

      const mergedInstructions = instructionContents.join('\n\n')
      this.mergedInstructions = mergedInstructions
      console.debug(`[ConfigLoader] Loaded ${uniqueFiles.length} instruction file(s), total length: ${mergedInstructions.length} chars`)
      return mergedInstructions
    } catch (error) {
      console.error('[ConfigLoader] Error loading instructions:', error)
      return ''
    }
  }

  /**
   * Clear instruction cache
   * 
   * Clears both the file-level cache and the merged instructions cache.
   * Useful when you want to force a reload of instruction files (e.g., after file changes).
   * 
   * @example
   * configLoader.clearInstructionCache()
   * const freshInstructions = await configLoader.loadInstructions()
   */
  clearInstructionCache(): void {
    this.instructionCache.clear()
    this.mergedInstructions = ''
    console.debug('[ConfigLoader] Instruction cache cleared')
  }

  /**
   * Get cached merged instruction content
   * 
   * Returns the last merged instructions that were loaded by loadInstructions().
   * This avoids re-reading and re-merging instruction files on every access.
   * 
   * @returns {string} Cached merged instruction content, or empty string if not loaded yet
   * 
   * @example
   * await configLoader.loadInstructions()
   * const cached = configLoader.getCachedInstructions() // Fast access to cached result
   */
  getCachedInstructions(): string {
    return this.mergedInstructions
  }
}