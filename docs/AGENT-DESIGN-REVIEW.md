# Agent Design Document - Professional Review

## Review Scope

This review evaluates the Agent Design Document from two critical perspectives:

1. **SDK Server Client Implementation Feasibility**: Can the design be fully implemented with the actual OpenCode SDK?
2. **Professional Obsidian Plugin Design**: Does the design follow Obsidian plugin best practices and architectural patterns?

## Executive Summary

### Overall Assessment

**SDK Implementation Feasibility**: ⚠️ **Partially Feasible** - Some assumptions need verification
**Obsidian Plugin Design**: ✅ **Professional** - Follows established patterns with minor improvements needed

### Key Findings

1. **SDK API Assumptions**: Design assumes `session.prompt` supports `agent` and `model` parameters, but current implementation doesn't use them
2. **Architecture Alignment**: Design aligns well with current plugin architecture (Component/Service pattern)
3. **State Management**: Session-level agent binding is well-designed but needs careful state synchronization
4. **Error Handling**: Design considers error scenarios but could be more specific about Obsidian-specific error patterns

---

## 1. SDK Server Client Implementation Feasibility

### 1.1 Current SDK API Usage

**Current Implementation** (`src/opencode-server/client.ts`):

```typescript
// session.prompt - Only passes parts
sdkClient.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: "text", text: content }],
  },
});

// session.command - Supports agent parameter
sdkClient.session.command({
  path: { id: sessionId },
  body: {
    command,
    arguments: argumentsText,
    ...(agent ? { agent } : {}),
  },
});
```

### 1.2 Design Document Assumptions

**Design Document Claims** (lines 245-261):

```typescript
sdkClient.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: "text", text: content }],
    agent?: string,              // ⚠️ ASSUMPTION: SDK may not support this
    model?: {                    // ⚠️ ASSUMPTION: SDK may not support this
      providerID: string,
      modelID: string
    },
    system?: string,             // ⚠️ ASSUMPTION: SDK may not support this
    tools?: { [key: string]: boolean }  // ⚠️ ASSUMPTION: SDK may not support this
  }
});
```

### 1.3 Critical Issues

#### Issue 1: Unverified SDK API Support ⚠️ **HIGH PRIORITY**

**Problem**: Design assumes `session.prompt` supports `agent`, `model`, `system`, and `tools` parameters, but:
- Current implementation doesn't use these parameters
- No evidence in codebase that SDK supports them
- `session.command` supports `agent`, suggesting API may be inconsistent

**Impact**: 
- If SDK doesn't support these parameters, the design cannot be fully implemented
- Current workaround (system message) is less elegant but functional

**Recommendation**:
1. **Verify SDK API**: Check `@opencode-ai/sdk/client` TypeScript definitions or documentation
2. **Update Design**: If SDK doesn't support these parameters, document the system message approach as the primary mechanism
3. **Fallback Strategy**: Design should explicitly state fallback to system message if SDK parameters unavailable

#### Issue 2: Agent Passing Mechanism Inconsistency ⚠️ **MEDIUM PRIORITY**

**Problem**: 
- `session.command` supports `agent` parameter (line 837 in client.ts)
- `session.prompt` may not support `agent` parameter
- Design doesn't explain this inconsistency

**Impact**: 
- Commands can use agent parameter directly
- Messages must use system message workaround
- Inconsistent developer experience

**Recommendation**:
- Document the difference between `session.command` and `session.prompt` API capabilities
- Provide clear guidance on when to use each approach

#### Issue 3: Model Override Implementation Gap ⚠️ **HIGH PRIORITY**

**Problem**: 
- Design specifies model override per agent
- Current SDK client has no model override support
- No clear path to implement model override

**Impact**: 
- Agent-specific model configurations cannot be applied
- All agents use default model regardless of configuration

**Recommendation**:
1. **Verify SDK Support**: Check if SDK supports model override in `session.prompt` or `session.create`
2. **Alternative Approach**: If SDK doesn't support it, consider:
   - Creating separate sessions per model
   - Using different OpenCode Server instances per model
   - Requesting SDK enhancement

### 1.4 Implementation Feasibility Assessment

| Feature | SDK Support | Current Implementation | Feasibility |
|---------|------------|----------------------|-------------|
| Agent ID in `session.prompt` | ❓ Unknown | ❌ Not used | ⚠️ Needs verification |
| Model override in `session.prompt` | ❓ Unknown | ❌ Not implemented | ⚠️ Needs verification |
| Agent ID in `session.command` | ✅ Supported | ✅ Implemented | ✅ Feasible |
| Agent via system message | ✅ Always works | ✅ Implemented | ✅ Feasible |
| System prompt in `session.prompt` | ❓ Unknown | ❌ Not used | ⚠️ Needs verification |
| Tools config in `session.prompt` | ❓ Unknown | ❌ Not used | ⚠️ Needs verification |

**Conclusion**: Design is **partially feasible** but requires SDK API verification before full implementation.

---

## 2. Professional Obsidian Plugin Design Review

### 2.1 Architecture Pattern Alignment ✅ **EXCELLENT**

**Current Plugin Architecture**:
- Component/Service pattern (matches design)
- Dependency injection via constructors
- Clear separation of concerns

**Design Document Alignment**:
- ✅ `AgentManager` utility class - matches existing pattern (`ConversationManager`, `MessageSender`)
- ✅ Component-based UI - matches existing pattern (`HeaderComponent`, `InputAreaComponent`)
- ✅ Service layer separation - matches existing pattern

**Assessment**: Design follows established plugin patterns perfectly.

### 2.2 State Management Design ✅ **GOOD** (with minor concerns)

**Current State Management**:
- View-level state (`conversations`, `activeConversationId`)
- Settings-level state (`settings.agent`)
- Service-level state (via dependency injection)

**Design Document Approach**:
- Conversation-level agent binding (`conversation.agentId`)
- Agent snapshot for history
- Global default agent fallback

**Strengths**:
- ✅ Clear state ownership (conversation owns agentId)
- ✅ Backward compatibility (fallback to global agent)
- ✅ History preservation (agent snapshot)

**Concerns**:
- ⚠️ **State Synchronization**: Design doesn't address how to handle agent changes mid-conversation
- ⚠️ **Session State**: Design doesn't explain relationship between `conversation.agentId` and `sessionId`
- ⚠️ **State Migration**: Design mentions migration but doesn't provide concrete migration path

**Recommendation**:
1. Add explicit state synchronization flow diagram
2. Document session recreation when agent changes
3. Provide migration script/function for existing conversations

### 2.3 Error Handling Design ✅ **GOOD**

**Current Error Handling**:
- Unified `ErrorHandler` with severity levels
- User-friendly notifications
- Context-aware error messages

**Design Document Coverage**:
- ✅ Agent not found → fallback to default
- ✅ Model not available → fallback to default
- ✅ Invalid agent configuration → skip with error

**Strengths**:
- ✅ Graceful degradation (fallback to defaults)
- ✅ User notification (warning notices)
- ✅ Error logging for debugging

**Missing Elements**:
- ⚠️ **Obsidian-Specific Errors**: No mention of vault access errors, file system errors
- ⚠️ **Network Errors**: No mention of OpenCode Server connection failures during agent loading
- ⚠️ **Validation Errors**: No mention of YAML parsing errors in agent files

**Recommendation**: Add Obsidian-specific error scenarios to error handling section.

### 2.4 UI/UX Design ⚠️ **NEEDS IMPROVEMENT**

**Current UI Pattern**:
- Component-based rendering
- Incremental DOM updates
- Obsidian-native UI elements (Setting, Dropdown, etc.)

**Design Document UI**:
- Agent selector dropdown ✅ (matches current pattern)
- Agent badge in header ⚠️ (not in current implementation)
- Category grouping ⚠️ (not in current implementation)
- Message-level agent indicator ⚠️ (not in current implementation)

**Issues**:

1. **Agent Badge Design** (lines 172-177):
   - Design shows badge in conversation header
   - Current implementation has no agent display in header
   - No specification of Obsidian UI component to use

2. **Category Grouping** (lines 206-227):
   - Design shows category-separated dropdown
   - Standard HTML `<select>` doesn't support grouping well
   - Obsidian's `Setting` API may not support grouped dropdowns

3. **Message Agent Indicator** (lines 177-181):
   - Design shows agent badge in messages
   - Current message rendering doesn't include agent info
   - No specification of how to integrate with `MessageRendererComponent`

**Recommendation**:
1. **Use Obsidian UI Components**: Specify use of Obsidian's `Setting` API or custom components
2. **Incremental Implementation**: Design should specify phased UI rollout
3. **Component Integration**: Show how agent UI integrates with existing `MessageRendererComponent`

### 2.5 Data Persistence Design ✅ **GOOD**

**Current Persistence**:
- Uses Obsidian's `loadData()` / `saveData()` API
- Stores conversations, settings, session IDs

**Design Document Approach**:
- Conversation-level `agentId` storage ✅
- Agent snapshot storage ✅
- Settings-level default agent ✅

**Strengths**:
- ✅ Uses Obsidian's native persistence API
- ✅ Backward compatible (optional fields)
- ✅ Clear data structure

**Recommendation**: Add data migration example for existing users.

### 2.6 Performance Considerations ⚠️ **MISSING**

**Current Performance Optimizations**:
- Debounced settings saving
- LRU caching for tool results
- Incremental DOM updates

**Design Document Coverage**:
- ❌ No mention of agent loading performance
- ❌ No mention of agent validation performance
- ❌ No mention of UI rendering performance with many agents

**Recommendation**: Add performance considerations:
- Agent loading: Lazy load or cache agent definitions
- UI rendering: Virtual scrolling for large agent lists
- Validation: Debounce agent validation during editing

### 2.7 Testing Strategy ✅ **GOOD** (but incomplete)

**Current Testing**:
- Unit tests with Vitest
- Mocked Obsidian API
- Integration tests for core functionality

**Design Document Coverage**:
- ✅ Unit tests for AgentManager
- ✅ Integration tests for session creation
- ✅ E2E tests for agent switching

**Missing**:
- ⚠️ **SDK Mocking**: No mention of how to mock SDK client for testing
- ⚠️ **Obsidian API Mocking**: No mention of vault API mocking for agent file loading
- ⚠️ **Error Scenario Testing**: No mention of testing error fallbacks

**Recommendation**: Add testing implementation details:
- SDK client mocking strategy
- Obsidian vault API mocking for agent file loading
- Error scenario test cases

---

## 3. Critical Design Gaps

### 3.1 SDK API Verification Gap ⚠️ **CRITICAL**

**Issue**: Design assumes SDK capabilities without verification.

**Impact**: Implementation may hit blockers if SDK doesn't support assumed features.

**Action Required**:
1. Verify `@opencode-ai/sdk/client` TypeScript definitions
2. Test SDK API with agent/model parameters
3. Update design based on actual SDK capabilities

### 3.2 Agent Loading Implementation Gap ⚠️ **HIGH PRIORITY**

**Issue**: Design specifies loading from `.opencode/agent/*.md` but doesn't provide:
- File scanning implementation details
- YAML frontmatter parsing approach
- Error handling for malformed files
- Caching strategy

**Impact**: Implementation may be inconsistent or incomplete.

**Action Required**:
1. Specify YAML parsing library (js-yaml, yaml, or custom parser)
2. Define file scanning strategy (on startup, on demand, watch mode)
3. Specify error handling for invalid files
4. Define caching strategy

### 3.3 State Synchronization Gap ⚠️ **MEDIUM PRIORITY**

**Issue**: Design doesn't explain how to handle:
- Agent change mid-conversation
- Session recreation when agent changes
- State consistency between conversation.agentId and session

**Impact**: Implementation may have state inconsistencies.

**Action Required**:
1. Add state synchronization flow diagram
2. Specify session recreation logic
3. Define state consistency checks

---

## 4. Recommendations

### 4.1 Immediate Actions (Before Implementation)

1. **Verify SDK API**:
   - Check `@opencode-ai/sdk/client` TypeScript definitions
   - Test `session.prompt` with `agent` and `model` parameters
   - Document actual SDK capabilities

2. **Clarify Agent Loading**:
   - Choose YAML parsing library
   - Define file scanning strategy
   - Specify error handling approach

3. **Add Implementation Details**:
   - State synchronization flow
   - Session recreation logic
   - Error handling scenarios

### 4.2 Design Improvements

1. **Add SDK API Verification Section**:
   - Document actual SDK capabilities
   - Provide fallback strategies
   - Include SDK version requirements

2. **Enhance UI/UX Design**:
   - Specify Obsidian UI components to use
   - Provide component integration examples
   - Add phased implementation plan

3. **Add Performance Considerations**:
   - Agent loading strategy
   - UI rendering optimizations
   - Caching strategy

4. **Complete Testing Strategy**:
   - SDK mocking approach
   - Obsidian API mocking
   - Error scenario test cases

### 4.3 Architecture Enhancements

1. **AgentManager Implementation**:
   - Follow existing `ConversationManager` pattern
   - Use dependency injection
   - Integrate with existing error handling

2. **State Management**:
   - Use existing view-level state pattern
   - Integrate with `ConversationManager`
   - Maintain backward compatibility

3. **UI Components**:
   - Extend existing component pattern
   - Use Obsidian UI APIs
   - Maintain incremental DOM updates

---

## 5. Final Assessment

### SDK Implementation Feasibility: ⚠️ **PARTIALLY FEASIBLE**

**Score**: 6/10

**Strengths**:
- ✅ System message approach is always feasible
- ✅ `session.command` agent support is confirmed
- ✅ Design provides fallback strategies

**Weaknesses**:
- ❌ Unverified SDK API assumptions
- ❌ Model override implementation unclear
- ❌ Missing SDK API verification process

### Obsidian Plugin Design: ✅ **PROFESSIONAL**

**Score**: 8/10

**Strengths**:
- ✅ Follows established plugin patterns
- ✅ Aligns with current architecture
- ✅ Good separation of concerns
- ✅ Backward compatibility considered

**Weaknesses**:
- ⚠️ Missing implementation details for agent loading
- ⚠️ UI/UX design needs Obsidian-specific specifications
- ⚠️ Performance considerations missing

### Overall: ✅ **GOOD DESIGN** (with verification needed)

**Recommendation**: 
1. **Verify SDK API** before full implementation
2. **Add missing implementation details** (agent loading, state sync)
3. **Enhance UI/UX design** with Obsidian-specific components
4. **Proceed with implementation** using verified SDK capabilities

---

## 6. Action Items

### High Priority
- [ ] Verify `@opencode-ai/sdk/client` API capabilities
- [ ] Test `session.prompt` with `agent` and `model` parameters
- [ ] Document actual SDK API vs. design assumptions
- [ ] Specify agent loading implementation (YAML parser, file scanning)

### Medium Priority
- [ ] Add state synchronization flow diagram
- [ ] Specify Obsidian UI components for agent UI
- [ ] Add performance considerations section
- [ ] Complete testing strategy with mocking details

### Low Priority
- [ ] Add data migration examples
- [ ] Enhance error handling with Obsidian-specific scenarios
- [ ] Add phased implementation plan for UI features
