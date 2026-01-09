import type { Agent, Skill } from '../types'
import type { ConfigLoader } from '../config-loader'

/**
 * Options for resolving agent configuration
 */
export interface AgentResolveOptions {
  agentID?: string
  systemPrompt?: string
  model?: { providerID: string; modelID: string }
  tools?: { [key: string]: boolean }
}

/**
 * Resolved agent configuration
 */
export interface ResolvedAgentConfig {
  systemPrompt: string
  model: { providerID: string; modelID: string }
  tools?: { [key: string]: boolean }
}

/**
 * Agent resolver class
 * Handles agent configuration resolution, skill merging, and instruction integration
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
   * Update agents list
   */
  setAgents(agents: Agent[]): void {
    this.agents = agents
  }

  /**
   * Update skills list
   */
  setSkills(skills: Skill[]): void {
    this.skills = skills
  }

  /**
   * Update config loader
   */
  setConfigLoader(configLoader: ConfigLoader | null): void {
    this.configLoader = configLoader
  }

  /**
   * Find agent by ID
   */
  findAgent(agentID: string): Agent | undefined {
    return this.agents.find(a => a.id === agentID)
  }

  /**
   * Resolve agent configuration from options
   * Returns resolved configuration including system prompt, model, and tools
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
   * Merge instructions into system prompt
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
