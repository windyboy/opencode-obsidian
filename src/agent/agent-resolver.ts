import type { Agent, Skill } from '../types'
import type { ConfigLoader } from '../config-loader'

/**
 * Options for resolving agent configuration
 * Used to specify agent selection and override options when resolving final configuration
 * 
 * @interface AgentResolveOptions
 */
export interface AgentResolveOptions {
  /** Optional agent ID to look up and apply agent configuration */
  agentID?: string
  /** Optional system prompt override - used if agent not found or as legacy fallback */
  systemPrompt?: string
  /** Optional model override - takes precedence over agent's model if provided */
  model?: { providerID: string; modelID: string }
  /** Optional tools override - merged with agent's tools configuration */
  tools?: { [key: string]: boolean }
}

/**
 * Resolved agent configuration
 * Final configuration after merging agent settings, skills, and instructions
 * 
 * @interface ResolvedAgentConfig
 */
export interface ResolvedAgentConfig {
  /** Final system prompt after merging agent prompt, skills, and instructions */
  systemPrompt: string
  /** Final model configuration (from agent, options, or default) */
  model: { providerID: string; modelID: string }
  /** Final tools configuration after merging agent and option tools */
  tools?: { [key: string]: boolean }
}

/**
 * Agent resolver class
 * 
 * Handles agent configuration resolution, skill merging, and instruction integration.
 * This class encapsulates the logic for:
 * - Finding and applying agent configurations
 * - Merging referenced skills into system prompts
 * - Integrating global instructions from config loader
 * - Handling model and tool overrides
 * 
 * @class AgentResolver
 */
export class AgentResolver {
  private agents: Agent[]
  private skills: Skill[]
  private configLoader: ConfigLoader | null

  constructor(
    agents: Agent[] = [],
    skills: Skill[] = [],
    configLoader: ConfigLoader | null = null
  ) {
    this.agents = agents
    this.skills = skills
    this.configLoader = configLoader
  }

  /**
   * Update the agents list
   * 
   * @param {Agent[]} agents - Array of agent definitions to use for resolution
   */
  setAgents(agents: Agent[]): void {
    this.agents = agents
  }

  /**
   * Update the skills list
   * 
   * @param {Skill[]} skills - Array of skill definitions available for merging
   */
  setSkills(skills: Skill[]): void {
    this.skills = skills
  }

  /**
   * Update the config loader instance
   * Used for merging global instructions into system prompts
   * 
   * @param {ConfigLoader | null} configLoader - Config loader instance or null to disable instruction merging
   */
  setConfigLoader(configLoader: ConfigLoader | null): void {
    this.configLoader = configLoader
  }

  /**
   * Find an agent by its ID
   * 
   * @param {string} agentID - The agent identifier to search for
   * @returns {Agent | undefined} The found agent or undefined if not found
   */
  findAgent(agentID: string): Agent | undefined {
    return this.agents.find(a => a.id === agentID)
  }

  /**
   * Resolve agent configuration from options
   * 
   * This is the main method for resolving agent configuration. It:
   * 1. Looks up the agent by ID if provided
   * 2. Applies agent's system prompt, model, and tools
   * 3. Merges referenced skills into the system prompt
   * 4. Merges global instructions from config loader
   * 5. Applies option overrides for model and tools
   * 
   * @param {AgentResolveOptions} options - Options for resolving agent configuration
   * @param {Object} defaultModel - Default model to use if no agent/model override is found
   * @param {string} defaultModel.providerID - Default provider identifier
   * @param {string} defaultModel.modelID - Default model identifier
   * @returns {ResolvedAgentConfig} Resolved configuration with merged prompts, model, and tools
   * 
   * @example
   * const resolver = new AgentResolver(agents, skills, configLoader)
   * const config = resolver.resolveAgentConfig(
   *   { agentID: 'assistant' },
   *   { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' }
   * )
   * // Returns: { systemPrompt: '...', model: {...}, tools: {...} }
   */
  resolveAgentConfig(
    options: AgentResolveOptions,
    defaultModel: { providerID: string; modelID: string }
  ): ResolvedAgentConfig {
    const agentID = options.agentID || ''
    let systemPrompt = options.systemPrompt
    let model = options.model || defaultModel
    let tools = options.tools

    // Try to find and apply agent configuration
    if (this.agents.length > 0 && agentID) {
      const agent = this.findAgent(agentID)
      
      if (agent) {
        // Use agent's system prompt
        systemPrompt = agent.systemPrompt

        // Override model if agent has specific model
        if (agent.model) {
          model = agent.model
        }

        // Merge agent's tools configuration with options
        if (agent.tools) {
          tools = { ...agent.tools, ...(options.tools || {}) }
        }

        // Merge referenced skills into system prompt
        if (agent.skills && agent.skills.length > 0) {
          systemPrompt = this.mergeSkillsIntoPrompt(systemPrompt || '', agent.skills)
        }
      } else {
        // Agent not found, use legacy behavior
        if (!systemPrompt) {
          systemPrompt = agentID
        }
      }
    } else {
      // No agents loaded, use legacy behavior
      if (!systemPrompt && agentID) {
        systemPrompt = agentID
      }
    }

    // Merge instructions into system prompt if available
    if (this.configLoader) {
      systemPrompt = this.mergeInstructionsIntoPrompt(systemPrompt || '')
    }

    return {
      systemPrompt: systemPrompt || '',
      model,
      tools
    }
  }

  /**
   * Build system prompt from agent configuration
   * Merges agent's system prompt with referenced skills
   * 
   * @param {Agent} agent - The agent to build prompt from
   * @param {string} [overrideSystem] - Optional system prompt override
   * @returns {string} Final system prompt with merged skills
   */
  buildSystemPrompt(agent: Agent, overrideSystem?: string): string {
    let prompt = overrideSystem || agent.systemPrompt || ''

    // Merge skills if agent references any
    if (agent.skills && agent.skills.length > 0) {
      prompt = this.mergeSkillsIntoPrompt(prompt, agent.skills)
    }

    return prompt
  }

  /**
   * Merge referenced skills into system prompt
   * 
   * Skills are formatted with a header and merged in order.
   * Missing skills are logged as warnings but don't prevent merging.
   * 
   * @param {string} prompt - Base system prompt
   * @param {string[]} skillIds - Array of skill IDs to merge
   * @returns {string} Prompt with skills merged in format: prompt + skill sections
   * 
   * @example
   * const prompt = "You are a helpful assistant."
   * const skillIds = ['code-review', 'testing']
   * const merged = resolver.mergeSkillsIntoPrompt(prompt, skillIds)
   * // Returns: "You are a helpful assistant.\n\n---\n# Skill: Code Review\n---\n\n..."
   */
  mergeSkillsIntoPrompt(prompt: string, skillIds: string[]): string {
    if (skillIds.length === 0 || this.skills.length === 0) {
      return prompt
    }

    const skillContents: string[] = []
    
    for (const skillId of skillIds) {
      const skill = this.skills.find(s => s.id === skillId)
      if (skill && skill.content) {
        skillContents.push(`\n\n---\n# Skill: ${skill.name}\n---\n\n${skill.content}`)
      } else {
        console.warn(`[AgentResolver] Skill "${skillId}" not found`)
      }
    }

    if (skillContents.length > 0) {
      return prompt + skillContents.join('')
    }

    return prompt
  }

  /**
   * Merge global instructions from config loader into system prompt
   * 
   * Instructions are loaded from .opencode/config.json and cached.
   * They are formatted with separators and appended to the prompt.
   * 
   * @param {string} prompt - Base system prompt
   * @returns {string} Prompt with instructions merged, or original prompt if no instructions available
   */
  mergeInstructionsIntoPrompt(prompt: string): string {
    if (!this.configLoader) {
      return prompt
    }

    const instructions = this.configLoader.getCachedInstructions()
    if (instructions && instructions.trim()) {
      // Instructions are already formatted with separators in loadInstructions()
      return prompt 
        ? `${prompt}\n\n${instructions}`
        : instructions
    }

    return prompt
  }
}
