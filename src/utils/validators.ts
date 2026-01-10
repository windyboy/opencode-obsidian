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
 * Validate a string matches a pattern
 * @internal - Currently unused but kept for future use
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function validateStringPattern(value: string | undefined, pattern: RegExp, fieldName: string, errorMessage?: string): string[] {
  const errors: string[] = []
  if (value && !pattern.test(value)) {
    errors.push(errorMessage || `${fieldName} does not match required pattern`)
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
 * Validates a provider configuration object including required fields,
 * URL format, API type, and model format.
 * 
 * @param {unknown} provider - Provider configuration object to validate
 * @param {ValidatorOptions} [options] - Optional validation options
 * @returns {ValidationResult} Validation result with errors and warnings
 */
export function validateProviderConfig(provider: unknown, options?: ValidatorOptions): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    return createResult(false, ['Provider must be an object'])
  }

  const prov = provider as Record<string, unknown>

  // Required fields
  errors.push(...validateNonEmptyString(prov.id as string | undefined, 'Provider ID', options))
  errors.push(...validateNonEmptyString(prov.name as string | undefined, 'Provider name', options))
  errors.push(...validateNonEmptyString(prov.baseURL as string | undefined, 'Provider baseURL', options))
  errors.push(...validateNonEmptyString(prov.apiType as string | undefined, 'Provider apiType', options))

  // Validate ID format
  if (prov.id) {
    errors.push(...validateProviderID(prov.id as string, 'Provider ID'))
  }

  // Validate baseURL format
  if (prov.baseURL) {
    errors.push(...validateURL(prov.baseURL as string, 'Provider baseURL'))
  }

  // Validate apiType
  if (prov.apiType) {
    const apiType = prov.apiType as string
    if (apiType !== 'openai-compatible' && apiType !== 'anthropic-compatible') {
      errors.push(`Provider apiType must be 'openai-compatible' or 'anthropic-compatible', got: ${apiType}`)
    }
  }

  // Optional fields
  if (prov.defaultModel) {
    if (typeof prov.defaultModel !== 'string') {
      errors.push('Provider defaultModel must be a string')
    } else {
      errors.push(...validateModelFormat(prov.defaultModel))
    }
  }

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
 * Validates a complete CompatibleProvider object including API key.
 * This is used for providers that are fully configured and ready to use.
 * 
 * @param {CompatibleProvider} provider - Compatible provider object to validate
 * @param {ValidatorOptions} [options] - Optional validation options
 * @returns {ValidationResult} Validation result with errors and warnings
 */
export function validateCompatibleProvider(provider: CompatibleProvider, options?: ValidatorOptions): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Validate basic structure
  errors.push(...validateNonEmptyString(provider.id, 'Provider ID', options))
  errors.push(...validateNonEmptyString(provider.name, 'Provider name', options))
  errors.push(...validateNonEmptyString(provider.baseURL, 'Provider baseURL', options))
  errors.push(...validateNonEmptyString(provider.apiType, 'Provider apiType', options))

  // Validate ID format
  errors.push(...validateProviderID(provider.id, 'Provider ID'))

  // Validate baseURL format
  errors.push(...validateURL(provider.baseURL, 'Provider baseURL'))

  // Validate apiType
  if (provider.apiType !== 'openai-compatible' && provider.apiType !== 'anthropic-compatible') {
    errors.push(`Provider apiType must be 'openai-compatible' or 'anthropic-compatible', got: ${String(provider.apiType)}`)
  }

  // Validate defaultModel if present
  if (provider.defaultModel) {
    errors.push(...validateModelFormat(provider.defaultModel))
  }

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

  // Optional fields with validation
  if ('name' in fm && fm.name !== undefined) {
    if (typeof fm.name !== 'string') {
      errors.push('Agent frontmatter.name must be a string')
    } else if (!options?.allowEmpty && fm.name.trim() === '') {
      errors.push('Agent frontmatter.name cannot be empty if provided')
    }
  }

  if ('description' in fm && fm.description !== undefined) {
    if (typeof fm.description !== 'string') {
      errors.push('Agent frontmatter.description must be a string')
    }
  }

  if ('model' in fm && fm.model !== undefined) {
    if (typeof fm.model !== 'string') {
      errors.push('Agent frontmatter.model must be a string')
    } else {
      errors.push(...validateModelFormat(fm.model))
    }
  }

  if ('tools' in fm && fm.tools !== undefined) {
    if (typeof fm.tools !== 'object' || Array.isArray(fm.tools) || fm.tools === null) {
      errors.push('Agent frontmatter.tools must be an object')
    } else {
      // Validate tools object structure
      const tools = fm.tools as Record<string, unknown>
      for (const [key, value] of Object.entries(tools)) {
        if (typeof value !== 'boolean') {
          errors.push(`Agent frontmatter.tools["${key}"] must be a boolean`)
        }
      }
    }
  }

  if ('skills' in fm && fm.skills !== undefined) {
    if (Array.isArray(fm.skills)) {
      fm.skills.forEach((skill, index) => {
        if (typeof skill !== 'string') {
          errors.push(`Agent frontmatter.skills[${index}] must be a string`)
        } else if (!options?.allowEmpty && skill.trim() === '') {
          errors.push(`Agent frontmatter.skills[${index}] cannot be empty`)
        }
      })
    } else if (typeof fm.skills !== 'string') {
      errors.push('Agent frontmatter.skills must be a string or array of strings')
    } else if (!options?.allowEmpty && fm.skills.trim() === '') {
      errors.push('Agent frontmatter.skills cannot be empty if provided as string')
    }
  }

  if ('color' in fm && fm.color !== undefined) {
    if (typeof fm.color !== 'string') {
      errors.push('Agent frontmatter.color must be a string')
    } else {
      errors.push(...validateColorHex(fm.color))
    }
  }

  if ('hidden' in fm && fm.hidden !== undefined) {
    if (typeof fm.hidden !== 'boolean') {
      errors.push('Agent frontmatter.hidden must be a boolean')
    }
  }

  if ('mode' in fm && fm.mode !== undefined) {
    if (typeof fm.mode !== 'string') {
      errors.push('Agent frontmatter.mode must be a string')
    }
  }

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

  // Validate ID format (filename-based, should be valid filename)
  if (agent.id) {
    // Agent ID comes from filename, should not contain path separators or invalid chars
    if (agent.id.includes('/') || agent.id.includes('\\')) {
      errors.push('Agent ID cannot contain path separators')
    }
    if (agent.id.length > 255) {
      errors.push('Agent ID must be 255 characters or less')
    }
  }

  // Validate model structure if present
  if (agent.model) {
    if (!agent.model.providerID || typeof agent.model.providerID !== 'string') {
      errors.push('Agent model.providerID must be a non-empty string')
    } else {
      errors.push(...validateProviderID(agent.model.providerID, 'Agent model.providerID'))
    }
    if (!agent.model.modelID || typeof agent.model.modelID !== 'string') {
      errors.push('Agent model.modelID must be a non-empty string')
    }
  }

  // Validate tools structure if present
  if (agent.tools) {
    if (typeof agent.tools !== 'object' || Array.isArray(agent.tools)) {
      errors.push('Agent tools must be an object')
    } else {
      for (const [key, value] of Object.entries(agent.tools)) {
        if (typeof value !== 'boolean') {
          errors.push(`Agent tools["${key}"] must be a boolean`)
        }
      }
    }
  }

  // Validate skills array if present
  if (agent.skills) {
    if (!Array.isArray(agent.skills)) {
      errors.push('Agent skills must be an array')
    } else {
      agent.skills.forEach((skill, index) => {
        if (typeof skill !== 'string') {
          errors.push(`Agent skills[${index}] must be a string`)
        } else if (!options?.allowEmpty && skill.trim() === '') {
          errors.push(`Agent skills[${index}] cannot be empty`)
        }
      })
    }
  }

  // Validate color if present
  if (agent.color) {
    errors.push(...validateColorHex(agent.color))
  }

  // Validate hidden if present
  if (agent.hidden !== undefined && typeof agent.hidden !== 'boolean') {
    errors.push('Agent hidden must be a boolean')
  }

  // Validate mode if present
  if (agent.mode !== undefined && typeof agent.mode !== 'string') {
    errors.push('Agent mode must be a string')
  }

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
