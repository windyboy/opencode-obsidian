# Review and refactor plan

## Scope
Validate the pasted findings against current code, then refactor or skip when already addressed. Track progress in this file during execution.

## Verified findings (current state)
- Audit logger permissions: already checks `PermissionManager` before create/modify in `persistLog` and directory create in `ensureAuditDir`.
- `searchVault` and `listNotes`: already gate reads with `PermissionManager.canRead`.
- Approval flow: `PermissionManager.requiresApproval` returns true for write/modify/create/delete; `ObsidianToolExecutor.ensureApproved` exists, but usage is inconsistent across operations.
- Conversation storage: `saveConversations` merges into plugin data without separating settings vs session data.
- Health checks: `performHealthCheck` always emits `Notice` (spam risk).
- `getContainer`: relies on `containerEl.children[1]`.
- Request timeout: uses `Promise.race` but does not abort `requestUrl`.
- Sentence case: multiple `eslint-disable-next-line obsidianmd/ui/sentence-case` remain.
- `searchVault` performance: currently reads file content for includeContent, but lacks path-match short-circuit optimizations.
- Tool executor file has syntax issues around `searchVault` (extra brace) that need validation.

## Refactor plan (track status below)
1. Security/permissions
   - [ ] Verify `AuditLogger` injection and permission checks remain consistent; no changes if confirmed.
   - [ ] Normalize approval enforcement in `ObsidianToolExecutor` (single check-point per write operation).
   - [ ] Ensure `searchVault` and `listNotes` continue to filter by permission, add if missing.

2. Reliability and correctness
   - [ ] Split conversation state from settings in `ConversationManager.saveConversations`.
   - [ ] Debounce/notify health check only on state change; avoid first-run notice.
   - [ ] Make `getContainer` robust using `contentEl` or `.view-content` fallback.
   - [ ] Fix `createObsidianFetch` timeout handling; add `AbortController` only if supported or simulate clean timeout without leaks.

3. Performance and consistency
   - [ ] Optimize `searchVault` to avoid reading content when path match is sufficient.
   - [ ] Remove unnecessary sentence-case disables by fixing UI strings.

4. Structural cleanup (optional, larger)
   - [ ] Outline a follow-up for separating UI, session, storage, and SSE concerns.

## Execution log
- Status: Not started
- Notes: User requested plan file and status updates during execution. Mark items as complete when verified or implemented.
