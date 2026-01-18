# Directory Structure Refactoring Plan

## Executive Summary

**Current State**: 55 TypeScript files across 7 modules
**Issues Found**: 3 critical, 2 medium priority
**Estimated Impact**: High (affects imports across codebase)
**Risk Level**: Medium (requires careful migration)

---

## Critical Issues

### Issue #1: Code Duplication - modals.ts

**Problem**:
```
src/views/modals.ts              # 273 lines - DUPLICATE
src/views/modals/
├── confirmation-modal.ts        # 45 lines
├── attachment-modal.ts          # 76 lines
└── diff-viewer-modal.ts         # 137 lines
```

**Impact**:
- 273 lines of duplicated code
- Import path inconsistency (`../utils/helpers` vs `../../utils/dom-helpers`)
- Maintenance burden (changes must be made twice)
- Bundle size increase

**Root Cause**: Incomplete refactoring - original consolidated file not removed after splitting

**Solution**: Delete `src/views/modals.ts`

**Migration Steps**:
1. Search all imports of `from "../views/modals"` or `from "./modals"`
2. Replace with specific imports: `from "../views/modals/confirmation-modal"`
3. Verify no runtime errors
4. Delete `src/views/modals.ts`

**Files to Update**:
```bash
# Find all imports
grep -r "from.*views/modals\"" src/
grep -r "from.*\./modals\"" src/views/
```

---

### Issue #2: Ambiguous Directory Names

**Problem**:
```
src/opencode-server/    # Client for external OpenCode server
src/server/             # Embedded server process manager
```

**Confusion Matrix**:
- Both contain "server" in name
- Opposite responsibilities (client vs server)
- Requires documentation to understand difference

**Impact**:
- Developer confusion
- Onboarding friction
- Incorrect file placement

**Solution**: Rename for clarity

**Option A (Recommended)**:
```
src/opencode-server/  →  src/client/
src/server/           →  src/embedded-server/
```

**Option B (Conservative)**:
```
src/opencode-server/  →  (keep as-is)
src/server/           →  src/server-manager/
```

**Option C (Namespace Consistency)**:
```
src/opencode-server/  →  src/opencode-client/
src/server/           →  src/opencode-server/
```

**Recommendation**: Option A
- Clearest semantics
- Industry standard (`client/` for API clients)
- Minimal cognitive load

---

### Issue #3: Misplaced File - client-initializer.ts

**Problem**:
```
src/utils/client-initializer.ts    # Specific initialization logic
```

**Why This Is Wrong**:
- `utils/` should contain generic, reusable utilities
- `client-initializer.ts` is domain-specific (OpenCode client setup)
- Violates Single Responsibility Principle for utils module

**Solution**: Move to appropriate module

**Option A**:
```
src/utils/client-initializer.ts  →  src/client/initializer.ts
```

**Option B**:
```
src/utils/client-initializer.ts  →  src/initialization/client.ts
```

**Recommendation**: Option A (if renaming opencode-server → client)

---

## Medium Priority Issues

### Issue #4: Flat Directory - tools/obsidian/

**Problem**:
```
src/tools/obsidian/
├── tool-registry.ts
├── tool-executor.ts
├── vault-reader.ts
├── permission-coordinator.ts
├── permission-manager.ts
├── permission-modal.ts
├── permission-types.ts
├── audit-logger.ts
├── types.ts
└── permission-coordinator.test.ts
```

**Metrics**:
- 10 files in single directory
- 5 files with `permission-*` prefix (cohesive group)
- 3 files for core tool functionality

**Solution**: Group by subdomain

```
src/tools/obsidian/
├── core/
│   ├── tool-registry.ts
│   ├── tool-executor.ts
│   └── vault-reader.ts
├── permissions/
│   ├── coordinator.ts
│   ├── manager.ts
│   ├── modal.ts
│   └── types.ts
├── audit-logger.ts
└── types.ts
```

**Trade-off**:
- Pro: Better organization, clearer grouping
- Con: Deeper nesting, longer import paths

**Decision**: Optional - only if team agrees deeper nesting is acceptable

---

### Issue #5: Inconsistent Naming - views/services/

**Problem**:
```
src/views/services/    # Business logic for views
```

**Confusion**:
- "services" typically means backend API services
- These are view controllers/managers, not API services

**Solution**: Rename for clarity

```
src/views/services/  →  src/views/controllers/
                     or  src/views/managers/
```

**Recommendation**: `controllers/` (matches MVC pattern)

---

## Refactoring Plan

### Phase 1: Critical Fixes (Required)

**1.1 Remove Duplicate modals.ts**

```bash
# Step 1: Find all imports
grep -rn "from.*views/modals\"" src/ > /tmp/modals-imports.txt

# Step 2: Update imports (manual or script)
# Before: import { ConfirmationModal } from "../views/modals"
# After:  import { ConfirmationModal } from "../views/modals/confirmation-modal"

# Step 3: Verify build
bun run build

# Step 4: Delete file
rm src/views/modals.ts

# Step 5: Verify tests
bun vitest run
```

**1.2 Rename Directories**

```bash
# Rename opencode-server → client
git mv src/opencode-server src/client

# Rename server → embedded-server
git mv src/server src/embedded-server

# Update all imports (use IDE refactor or script)
# Update tsconfig.json paths if using path aliases
```

**1.3 Move client-initializer.ts**

```bash
git mv src/utils/client-initializer.ts src/client/initializer.ts

# Update imports in main.ts and other files
```

---

### Phase 2: Optional Improvements

**2.1 Restructure tools/obsidian/**

```bash
mkdir -p src/tools/obsidian/core
mkdir -p src/tools/obsidian/permissions

git mv src/tools/obsidian/tool-registry.ts src/tools/obsidian/core/
git mv src/tools/obsidian/tool-executor.ts src/tools/obsidian/core/
git mv src/tools/obsidian/vault-reader.ts src/tools/obsidian/core/

git mv src/tools/obsidian/permission-coordinator.ts src/tools/obsidian/permissions/coordinator.ts
git mv src/tools/obsidian/permission-manager.ts src/tools/obsidian/permissions/manager.ts
git mv src/tools/obsidian/permission-modal.ts src/tools/obsidian/permissions/modal.ts
git mv src/tools/obsidian/permission-types.ts src/tools/obsidian/permissions/types.ts
```

**2.2 Rename views/services/**

```bash
git mv src/views/services src/views/controllers
```

---

## Impact Analysis

### Files Affected by Phase 1

**Rename opencode-server → client**:
```bash
# Estimate: 20-30 import statements
src/main.ts
src/session/connection-manager.ts
src/tools/obsidian/permission-coordinator.ts
src/views/services/*.ts
```

**Rename server → embedded-server**:
```bash
# Estimate: 2-3 import statements
src/main.ts
```

**Move client-initializer.ts**:
```bash
# Estimate: 1-2 import statements
src/main.ts
```

**Remove modals.ts**:
```bash
# Estimate: 5-10 import statements
src/views/opencode-obsidian-view.ts
src/views/components/*.ts
```

---

## Testing Strategy

### Pre-Refactor
```bash
# 1. Run full test suite
bun vitest run

# 2. Build production bundle
bun run build

# 3. Manual smoke test in Obsidian
```

### Post-Refactor (After Each Phase)
```bash
# 1. Type check
bun run check

# 2. Run tests
bun vitest run

# 3. Build
bun run build

# 4. Verify bundle size unchanged
ls -lh main.js

# 5. Manual smoke test
```

---

## Rollback Plan

```bash
# If issues found, rollback via git
git reset --hard HEAD~1

# Or revert specific commit
git revert <commit-hash>
```

---

## Timeline Estimate

**Phase 1 (Critical)**:
- Analysis: 30 min
- Implementation: 2-3 hours
- Testing: 1 hour
- **Total: 3.5-4.5 hours**

**Phase 2 (Optional)**:
- Implementation: 1-2 hours
- Testing: 30 min
- **Total: 1.5-2.5 hours**

---

## Decision Required

**Must Decide**:
1. Directory rename scheme (Option A/B/C for opencode-server)
2. Execute Phase 2 or defer?

**Recommendation**:
- Phase 1: Execute immediately (fixes critical issues)
- Phase 2: Defer until next major refactor (optional improvements)
