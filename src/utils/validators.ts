/**
 * Input validation utilities for configuration, agents, and providers
 */

import type { Agent, Skill, CompatibleProvider } from '../types'
// Types imported but not used directly

/**
 * Validation result interface
 * Contains the validation outcome with errors and warnings
 * 
 * @interface ValidationResult
 */
export interface ValidationResult {
  /** Whether validation passed (no errors, and no warnings if strict mode) */
  valid: boolean
  /** Array of validation error messages */
  errors: string[]
  /** Array of validation warning messages */
  warnings: string[]
}

/**
 * Validator configuration options
 * 
 * @interface ValidatorOptions
 */
export interface ValidatorOptions {
  /** If true, treat warnings as errors (validation fails if warnings present) */
  strict?: boolean
  /** If true, allow empty strings and arrays (otherwise they're considered invalid) */
  allowEmpty?: boolean
}

/**
 * Create a validation result
 */
function createResult(valid: boolean, errors: string[] = [], warnings: string[] = []): ValidationResult {
  return { valid, errors, warnings }
}

/**
 * Validate a string field - checks type and optionally non-empty
 */
function validateStringField(
  value: unknown,
  fieldName: string,
  options?: { allowEmpty?: boolean; required?: boolean }
): string[] {
  const errors: string[] = []

  if (value === undefined || value === null) {
    if (options?.required) {
      errors.push(`${fieldName} is required`)
    }
    return errors
  }

  if (typeof value !== 'string') {
    errors.push(`${fieldName} must be a string`)
    return errors
  }

  if (!options?.allowEmpty && value.trim() === '') {
    errors.push(`${fieldName} cannot be empty`)
  }

  return errors
}

/**
 * Validate a boolean field
 */
function validateBooleanField(value: unknown, fieldName: string): string[] {
  if (value !== undefined && typeof value !== 'boolean') {
    return [`${fieldName} must be a boolean`]
  }
  return []
}

/**
 * Validate a tools object (Record<string, boolean>)
 */
function validateToolsObject(value: unknown, fieldName: string): string[] {
  const errors: string[] = []
  if (typeof value !== 'object' || Array.isArray(value) || value === null) {
    errors.push(`${fieldName} must be an object`)
  } else {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (typeof val !== 'boolean') {
        errors.push(`${fieldName}["${key}"] must be a boolean`)
      }
    }
  }
  return errors
}

/**
 * Validate skills field (string or array of strings)
 */
function validateSkillsField(value: unknown, fieldName: string, options?: ValidatorOptions): string[] {
  const errors: string[] = []
  if (Array.isArray(value)) {
    value.forEach((skill, index) => {
      if (typeof skill !== 'string') {
        errors.push(`${fieldName}[${index}] must be a string`)
      } else if (!options?.allowEmpty && skill.trim() === '') {
        errors.push(`${fieldName}[${index}] cannot be empty`)
      }
    })
  } else if (typeof value !== 'string') {
    errors.push(`${fieldName} must be a string or array of strings`)
  } else if (!options?.allowEmpty && value.trim() === '') {
    errors.push(`${fieldName} cannot be empty if provided as string`)
  }
  return errors
}

/**
 * Validate an entity ID (no path separators, max 255 chars)
 */
function validateEntityId(id: string, fieldName: string): string[] {
  const errors: string[] = []
  if (id.includes('/') || id.includes('\\')) {
    errors.push(`${fieldName} cannot contain path separators`)
  }
  if (id.length > 255) {
    errors.push(`${fieldName} must be 255 characters or less`)
  }
  return errors
}

/**
 * Validate model structure { providerID, modelID }
 */
function validateModelStructure(model: { providerID?: string; modelID?: string }, fieldName: string): string[] {
  const errors: string[] = []
  if (!model.providerID || typeof model.providerID !== 'string') {
    errors.push(`${fieldName}.providerID must be a non-empty string`)
  } else {
    errors.push(...validateProviderID(model.providerID, `${fieldName}.providerID`))
  }
  if (!model.modelID || typeof model.modelID !== 'string') {
    errors.push(`${fieldName}.modelID must be a non-empty string`)
  }
  return errors
}

/**
 * Validate an array of strings
 */
function validateStringArray(arr: unknown, fieldName: string, options?: ValidatorOptions): string[] {
  const errors: string[] = []
  if (!Array.isArray(arr)) {
    errors.push(`${fieldName} must be an array`)
  } else {
    arr.forEach((item, index) => {
      if (typeof item !== 'string') {
        errors.push(`${fieldName}[${index}] must be a string`)
      } else if (!options?.allowEmpty && item.trim() === '') {
        errors.push(`${fieldName}[${index}] cannot be empty`)
      }
    })
  }
  return errors
}

/**
 * Validate a string is not empty (if allowEmpty is false)
 */
function validateNonEmptyString(value: string | undefined | null, fieldName: string, options?: ValidatorOptions): string[] {
  const errors: string[] = []
  if (!options?.allowEmpty && (!value || value.trim() === '')) {
    errors.push(`${fieldName} is required and cannot be empty`)
  }
  return errors
}

/**
 * Validate URL format
 */
function validateURL(value: string | undefined, fieldName: string): string[] {
  const errors: string[] = []
  if (value) {
    try {
      const url = new URL(value)
      // Check for http/https protocol
      if (!['http:', 'https:'].includes(url.protocol)) {
        errors.push(`${fieldName} must use http:// or https:// protocol`)
      }
    } catch {
      errors.push(`${fieldName} is not a valid URL`)
    }
  }
  return errors
}

/**
 * Validate provider baseURL for SSRF protection
 * Only allows https:// and blocks localhost/private IP ranges
 * 
 * @param baseURL - Base URL to validate
 * @param allowLocalhost - Allow localhost/127.0.0.1 (default: false, for advanced users)
 * @returns Array of validation errors (empty if valid)
 */
export function validateProviderBaseURL(baseURL: string, allowLocalhost: boolean = false): string[] {
  const errors: string[] = []

  if (!baseURL || typeof baseURL !== 'string') {
    errors.push('Provider baseURL is required and must be a string')
    return errors
  }

  try {
    const url = new URL(baseURL)

    // Only allow https:// protocol (SSRF protection)
    if (url.protocol !== 'https:') {
      if (!allowLocalhost && url.protocol === 'http:') {
        errors.push('Provider baseURL must use https:// protocol for security (SSRF protection)')
      } else if (url.protocol !== 'http:') {
        errors.push(`Provider baseURL must use https:// protocol, got: ${url.protocol}`)
      }
    }

    // Block localhost and private IP ranges (unless explicitly allowed)
    if (!allowLocalhost) {
      const hostname = url.hostname.toLowerCase()
      
      // Block localhost variants
      if (hostname === 'localhost' || 
          hostname === '127.0.0.1' || 
          hostname === '::1' ||
          hostname.startsWith('localhost.') ||
          hostname === '0.0.0.0') {
        errors.push('Provider baseURL cannot point to localhost/127.0.0.1 (SSRF protection). Use advanced settings to override if needed.')
      }

      // Block private IP ranges (RFC 1918)
      // 10.0.0.0/8
      if (/^10\./.test(hostname)) {
        errors.push('Provider baseURL cannot point to private IP range 10.0.0.0/8 (SSRF protection)')
      }

      // 172.16.0.0/12
      const match172 = /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
      if (match172) {
        errors.push('Provider baseURL cannot point to private IP range 172.16.0.0/12 (SSRF protection)')
      }

      // 192.168.0.0/16
      if (/^192\.168\./.test(hostname)) {
        errors.push('Provider baseURL cannot point to private IP range 192.168.0.0/16 (SSRF protection)')
      }
    }

    // Additional security: block file:// and other dangerous protocols
    if (['file:', 'ftp:', 'gopher:', 'data:'].includes(url.protocol)) {
      errors.push(`Provider baseURL cannot use ${url.protocol} protocol (security risk)`)
    }
  } catch (error) {
    errors.push(`Provider baseURL is not a valid URL: ${error instanceof Error ? error.message : String(error)}`)
  }

  return errors
}

/**
 * Validate common provider fields (shared between validateProviderConfig and validateCompatibleProvider)
 */
function validateProviderFields(
  provider: Record<string, unknown>,
  options?: ValidatorOptions
): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  // Required fields
  errors.push(...validateNonEmptyString(provider.id as string | undefined, 'Provider ID', options))
  errors.push(...validateNonEmptyString(provider.name as string | undefined, 'Provider name', options))
  errors.push(...validateNonEmptyString(provider.baseURL as string | undefined, 'Provider baseURL', options))
  errors.push(...validateNonEmptyString(provider.apiType as string | undefined, 'Provider apiType', options))

  // Validate ID format
  if (provider.id) {
    errors.push(...validateProviderID(provider.id as string, 'Provider ID'))
  }

  // Validate baseURL format
  if (provider.baseURL) {
    errors.push(...validateURL(provider.baseURL as string, 'Provider baseURL'))
  }

  // Validate apiType
  if (provider.apiType) {
    const apiType = provider.apiType as string
    if (apiType !== 'openai-compatible' && apiType !== 'anthropic-compatible') {
      errors.push(`Provider apiType must be 'openai-compatible' or 'anthropic-compatible', got: ${apiType}`)
    }
  }

  // Validate defaultModel if present
  if (provider.defaultModel) {
    if (typeof provider.defaultModel !== 'string') {
      errors.push('Provider defaultModel must be a string')
    } else {
      errors.push(...validateModelFormat(provider.defaultModel))
    }
  }

  return { errors, warnings }
}

/**
 * Validate color hex format (#RRGGBB or #RRGGBBAA)
 */
function validateColorHex(value: string | undefined): string[] {
  const errors: string[] = []
  if (value && !/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(value)) {
    errors.push(`Color must be a valid hex color (e.g., #FF0000 or #FF0000FF)`)
  }
  return errors
}

/**
 * Validate model format (providerID/modelID or just modelID)
 */
function validateModelFormat(value: string | undefined): string[] {
  const errors: string[] = []
  if (value) {
    const parts = value.split('/')
    if (parts.length > 2) {
      errors.push(`Model format must be "providerID/modelID" or "modelID", got: ${value}`)
    }
    // Validate each part is not empty
    for (const part of parts) {
      if (!part || part.trim() === '') {
        errors.push(`Model format contains empty parts: ${value}`)
        break
      }
    }
  }
  return errors
}

/**
 * Validate provider ID format (alphanumeric, dashes, underscores)
 */
function validateProviderID(value: string | undefined, fieldName: string = 'Provider ID'): string[] {
  const errors: string[] = []
  if (value) {
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
      errors.push(`${fieldName} must contain only alphanumeric characters, dashes, and underscores`)
    }
    if (value.length > 100) {
      errors.push(`${fieldName} must be 100 characters or less`)
    }
  }
  return errors
}

/**
 * Validate OpenCodeConfig structure
 * 
 * Validates the structure of an OpenCode configuration object loaded from config.json.
 * Checks providers array and instructions array if present.
 * 
 * @param {unknown} config - Configuration object to validate
 * @param {ValidatorOptions} [options] - Optional validation options
 * @returns {ValidationResult} Validation result with errors and warnings
 * 
   * @example
   * const config = { providers: [...], instructions: [...] }
   * const result = validateOpenCodeConfig(config)
   * if (!result.valid) {
   *   console.error('Validation errors:', result.errors)
   * }
 */
export function validateOpenCodeConfig(config: unknown, options?: ValidatorOptions): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!config || typeof config !== 'object') {
    return createResult(false, ['Config must be an object'])
  }

  const cfg = config as Record<string, unknown>

  // Validate providers array if present
  if ('providers' in cfg && cfg.providers !== undefined) {
    if (!Array.isArray(cfg.providers)) {
      errors.push('Config.providers must be an array')
    } else {
      cfg.providers.forEach((provider, index) => {
        const result = validateProviderConfig(provider, options)
        errors.push(...result.errors.map(e => `Config.providers[${index}]: ${e}`))
        warnings.push(...result.warnings.map(w => `Config.providers[${index}]: ${w}`))
      })
    }
  }

  // Validate instructions array if present
  if ('instructions' in cfg && cfg.instructions !== undefined) {
    if (!Array.isArray(cfg.instructions)) {
      errors.push('Config.instructions must be an array')
    } else {
      cfg.instructions.forEach((instruction, index) => {
        if (typeof instruction !== 'string') {
          errors.push(`Config.instructions[${index}] must be a string`)
        } else if (!options?.allowEmpty && instruction.trim() === '') {
          errors.push(`Config.instructions[${index}] cannot be empty`)
        }
      })
    }
  }

  // Check for unknown fields (warnings)
  const knownFields = ['providers', 'instructions']
  for (const key of Object.keys(cfg)) {
    if (!knownFields.includes(key)) {
      warnings.push(`Unknown config field: ${key}`)
    }
  }

  const valid = errors.length === 0 && (!options?.strict || warnings.length === 0)
  return createResult(valid, errors, warnings)
}

/**
 * Validate provider configuration from config.json
 *
 * @param {unknown} provider - Provider configuration object to validate
 * @param {ValidatorOptions} [options] - Optional validation options
 * @returns {ValidationResult} Validation result with errors and warnings
 */
export function validateProviderConfig(provider: unknown, options?: ValidatorOptions): ValidationResult {
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    return createResult(false, ['Provider must be an object'])
  }

  const prov = provider as Record<string, unknown>
  const { errors, warnings } = validateProviderFields(prov, options)

  // Check for unknown fields (warnings)
  const knownFields = ['id', 'name', 'baseURL', 'apiType', 'defaultModel']
  for (const key of Object.keys(prov)) {
    if (!knownFields.includes(key)) {
      warnings.push(`Unknown provider field: ${key}`)
    }
  }

  const valid = errors.length === 0 && (!options?.strict || warnings.length === 0)
  return createResult(valid, errors, warnings)
}

/**
 * Validate CompatibleProvider with API key
 *
 * @param {CompatibleProvider} provider - Compatible provider object to validate
 * @param {ValidatorOptions} [options] - Optional validation options
 * @returns {ValidationResult} Validation result with errors and warnings
 */
export function validateCompatibleProvider(provider: CompatibleProvider, options?: ValidatorOptions): ValidationResult {
  const providerRecord = provider as unknown as Record<string, unknown>
  const { errors, warnings } = validateProviderFields(providerRecord, options)

  // API key is optional (may be empty initially)
  // Note: We don't validate API key format here as different providers have different formats

  const valid = errors.length === 0 && (!options?.strict || warnings.length === 0)
  return createResult(valid, errors, warnings)
}

/**
 * Validate AgentFrontmatter structure
 * 
 * Validates YAML frontmatter parsed from an agent markdown file.
 * Checks all optional fields including model format, tools structure, skills, and color.
 * 
 * @param {unknown} frontmatter - Agent frontmatter object to validate
 * @param {ValidatorOptions} [options] - Optional validation options
 * @returns {ValidationResult} Validation result with errors and warnings
 */
export function validateAgentFrontmatter(frontmatter: unknown, options?: ValidatorOptions): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    return createResult(false, ['Agent frontmatter must be an object'])
  }

  const fm = frontmatter as Record<string, unknown>

  // Validate string fields
  if ('name' in fm) {
    errors.push(...validateStringField(fm.name, 'Agent frontmatter.name', { allowEmpty: options?.allowEmpty }))
  }
  if ('description' in fm) {
    errors.push(...validateStringField(fm.description, 'Agent frontmatter.description', { allowEmpty: true }))
  }
  if ('mode' in fm) {
    errors.push(...validateStringField(fm.mode, 'Agent frontmatter.mode', { allowEmpty: true }))
  }

  // Validate model with format check
  if ('model' in fm && fm.model !== undefined) {
    if (typeof fm.model !== 'string') {
      errors.push('Agent frontmatter.model must be a string')
    } else {
      errors.push(...validateModelFormat(fm.model))
    }
  }

  // Validate tools object
  if ('tools' in fm && fm.tools !== undefined) {
    errors.push(...validateToolsObject(fm.tools, 'Agent frontmatter.tools'))
  }

  // Validate skills (string or array)
  if ('skills' in fm && fm.skills !== undefined) {
    errors.push(...validateSkillsField(fm.skills, 'Agent frontmatter.skills', options))
  }

  // Validate color hex
  if ('color' in fm && fm.color !== undefined) {
    if (typeof fm.color !== 'string') {
      errors.push('Agent frontmatter.color must be a string')
    } else {
      errors.push(...validateColorHex(fm.color))
    }
  }

  // Validate boolean fields
  errors.push(...validateBooleanField(fm.hidden, 'Agent frontmatter.hidden'))

  const valid = errors.length === 0 && (!options?.strict || warnings.length === 0)
  return createResult(valid, errors, warnings)
}

/**
 * Validate Agent structure
 * 
 * Validates a complete Agent object including required fields (id, name, systemPrompt),
 * model structure, tools configuration, skills array, and optional fields.
 * 
 * @param {Agent} agent - Agent object to validate
 * @param {ValidatorOptions} [options] - Optional validation options
 * @returns {ValidationResult} Validation result with errors and warnings
 */
export function validateAgent(agent: Agent, options?: ValidatorOptions): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Required fields
  errors.push(...validateNonEmptyString(agent.id, 'Agent ID', options))
  errors.push(...validateNonEmptyString(agent.name, 'Agent name', options))
  errors.push(...validateNonEmptyString(agent.systemPrompt, 'Agent systemPrompt', options))

  // Validate ID format
  if (agent.id) {
    errors.push(...validateEntityId(agent.id, 'Agent ID'))
  }

  // Validate model structure if present
  if (agent.model) {
    errors.push(...validateModelStructure(agent.model, 'Agent model'))
  }

  // Validate tools structure if present
  if (agent.tools) {
    errors.push(...validateToolsObject(agent.tools, 'Agent tools'))
  }

  // Validate skills array if present
  if (agent.skills) {
    errors.push(...validateStringArray(agent.skills, 'Agent skills', options))
  }

  // Validate color if present
  if (agent.color) {
    errors.push(...validateColorHex(agent.color))
  }

  // Validate boolean fields
  errors.push(...validateBooleanField(agent.hidden, 'Agent hidden'))
  errors.push(...validateStringField(agent.mode, 'Agent mode', { allowEmpty: true }))

  const valid = errors.length === 0 && (!options?.strict || warnings.length === 0)
  return createResult(valid, errors, warnings)
}

/**
 * Validate SkillFrontmatter structure
 * 
 * Validates YAML frontmatter parsed from a skill markdown file.
 * Skills have simpler structure than agents - only name and description.
 * 
 * @param {unknown} frontmatter - Skill frontmatter object to validate
 * @param {ValidatorOptions} [options] - Optional validation options
 * @returns {ValidationResult} Validation result with errors and warnings
 */
export function validateSkillFrontmatter(frontmatter: unknown, options?: ValidatorOptions): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    return createResult(false, ['Skill frontmatter must be an object'])
  }

  const fm = frontmatter as Record<string, unknown>

  // Optional fields with validation
  if ('name' in fm && fm.name !== undefined) {
    if (typeof fm.name !== 'string') {
      errors.push('Skill frontmatter.name must be a string')
    } else if (!options?.allowEmpty && fm.name.trim() === '') {
      errors.push('Skill frontmatter.name cannot be empty if provided')
    }
  }

  if ('description' in fm && fm.description !== undefined) {
    if (typeof fm.description !== 'string') {
      errors.push('Skill frontmatter.description must be a string')
    }
  }

  // Check for unknown fields (warnings)
  const knownFields = ['name', 'description']
  for (const key of Object.keys(fm)) {
    if (!knownFields.includes(key)) {
      warnings.push(`Unknown skill frontmatter field: ${key}`)
    }
  }

  const valid = errors.length === 0 && (!options?.strict || warnings.length === 0)
  return createResult(valid, errors, warnings)
}

/**
 * Validate Skill structure
 * 
 * Validates a complete Skill object including required fields (id, name, content)
 * and optional description field.
 * 
 * @param {Skill} skill - Skill object to validate
 * @param {ValidatorOptions} [options] - Optional validation options
 * @returns {ValidationResult} Validation result with errors and warnings
 */
export function validateSkill(skill: Skill, options?: ValidatorOptions): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Required fields
  errors.push(...validateNonEmptyString(skill.id, 'Skill ID', options))
  errors.push(...validateNonEmptyString(skill.name, 'Skill name', options))
  errors.push(...validateNonEmptyString(skill.content, 'Skill content', options))

  // Validate ID format (directory name-based)
  if (skill.id) {
    // Skill ID comes from directory name, should not contain path separators
    if (skill.id.includes('/') || skill.id.includes('\\')) {
      errors.push('Skill ID cannot contain path separators')
    }
    if (skill.id.length > 255) {
      errors.push('Skill ID must be 255 characters or less')
    }
  }

  // Validate description if present
  if (skill.description !== undefined && typeof skill.description !== 'string') {
    errors.push('Skill description must be a string')
  }

  const valid = errors.length === 0 && (!options?.strict || warnings.length === 0)
  return createResult(valid, errors, warnings)
}

/**
 * Format validation result as a readable string
 * 
 * Converts a ValidationResult object into a human-readable string format
 * with checkmarks/crosses and formatted error/warning lists.
 * 
 * @param {ValidationResult} result - Validation result to format
 * @returns {string} Formatted string representation of the validation result
 * 
   * @example
   * const result = validateAgent(agent)
   * console.log(formatValidationResult(result))
   * // Output: "Validation passed" or "Validation failed\nErrors:\n  - ..."
 */
export function formatValidationResult(result: ValidationResult): string {
  const parts: string[] = []
  
  if (result.valid) {
    parts.push('✓ Validation passed')
  } else {
    parts.push('✗ Validation failed')
  }
  
  if (result.errors.length > 0) {
    parts.push('\nErrors:')
    result.errors.forEach(error => parts.push(`  - ${error}`))
  }
  
  if (result.warnings.length > 0) {
    parts.push('\nWarnings:')
    result.warnings.forEach(warning => parts.push(`  - ${warning}`))
  }
  
  return parts.join('\n')
}
