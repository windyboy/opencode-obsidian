# Tasks: Code Refactoring Large Files

## Phase 1: Extract Utilities (Requirement 4)

- [x] 1. Create utility files
  - [x] 1.1 Create `src/utils/dom-helpers.ts` with common DOM operations
  - [x] 1.2 Create `src/utils/data-helpers.ts` with data transformations
  - [x] 1.3 Add unit tests for utilities

- [x] 2. Update imports across codebase
  - [x] 2.1 Update client.ts to use new utilities
  - [x] 2.2 Update view files to use new utilities
  - [x] 2.3 Update settings.ts to use new utilities
  - [x] 2.4 Run tests to verify no breakage

## Phase 2: Refactor Client (Requirement 1)

- [x] 3. Extract connection handler
  - [x] 3.1 Create `src/opencode-server/connection-handler.ts`
  - [x] 3.2 Move connection logic from client.ts
  - [x] 3.3 Add unit tests for connection handler

- [ ] 4. Extract stream handler
  - [x] 4.1 Create `src/opencode-server/stream-handler.ts`
  - [x] 4.2 Move SSE streaming logic from client.ts
  - [x] 4.3 Add unit tests for stream handler

- [x] 5. Extract session operations
  - [x] 5.1 Create `src/opencode-server/session-operations.ts`
  - [x] 5.2 Move session CRUD methods from client.ts
  - [x] 5.3 Add unit tests for session operations

- [x] 6. Update client.ts to delegate
  - [x] 6.1 Refactor client.ts to use handlers (keep under 15KB)
  - [x] 6.2 Add re-exports for backward compatibility
  - [x] 6.3 Run all client tests to verify

## Phase 3: Refactor View (Requirement 2)

- [ ] 7. Extract chat renderer
  - [x] 7.1 Create `src/views/chat-renderer.ts`
  - [x] 7.2 Move message rendering logic from view
  - [x] 7.3 Add unit tests for chat renderer

- [ ] 8. Extract input handler
  - [x] 8.1 Create `src/views/input-handler.ts`
  - [x] 8.2 Move input handling logic from view
  - [x] 8.3 Add unit tests for input handler

- [ ] 9. Update view to delegate
  - [x] 9.1 Refactor opencode-obsidian-view.ts (keep under 15KB)
  - [x] 9.2 Run all view tests to verify

## Phase 4: Refactor Tool Executor (Requirement 3)

- [ ] 10. Extract vault reader
  - [x] 10.1 Create `src/tools/obsidian/vault-reader.ts`
  - [x] 10.2 Move read operations from tool-executor.ts
  - [x] 10.3 Add unit tests for vault reader

- [x] 11. Extract vault writer
  - [x] 11.1 Create `src/tools/obsidian/vault-writer.ts`
  - [x] 11.2 Move write operations from tool-executor.ts
  - [x] 11.3 Add unit tests for vault writer

- [x] 12. Update tool executor to delegate
  - [x] 12.1 Refactor tool-executor.ts (keep under 15KB)
  - [x] 12.2 Run all tool tests to verify

## Phase 5: Refactor Settings (Requirement 3)

- [x] 13. Extract settings renderers
  - [x] 13.1 Create `src/settings/` folder
  - [x] 13.2 Create `src/settings/connection-settings.ts`
  - [x] 13.3 Create `src/settings/agent-settings.ts`
  - [x] 13.4 Add unit tests for settings renderers

- [ ] 14. Update settings to delegate
  - [x] 14.1 Refactor settings.ts (keep under 15KB)
  - [x] 14.2 Run all settings tests to verify

## Phase 6: Final Validation (Requirement 6)

- [x] 15. Verify success criteria
  - [x] 15.1 Check all files are under 15KB
  - [x] 15.2 Run full test suite (`bun vitest run`)
  - [x] 15.3 Run TypeScript check (`bun run check`)
  - [x] 15.4 Run ESLint (`bun run lint`)
  - [x] 15.5 Build plugin (`bun run build`)
  - [x] 15.6 Manual test in Obsidian

## Notes

- Keep changes minimal and focused
- Run tests after each phase
- Verify file sizes regularly
- Maintain backward compatibility throughout
