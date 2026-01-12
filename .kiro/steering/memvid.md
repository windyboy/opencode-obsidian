---
inclusion: always
---

# memvid usage (minimal)

## Purpose

Use memvid as a durable knowledge base for this project (NOT chat history):

-   API contracts (OpenCode HTTP/SSE), plugin rules, recurring fixes, decisions.

## Never store

-   tokens / API keys / passwords / secrets
-   full raw logs, transient errors, personal data

## Write policy (when & what)

Write to memvid only when:

-   a decision becomes stable (and will be reused)
-   a contract/behavior is confirmed (HTTP/SSE)
-   a fix is proven and likely recurring

Keep entries short and structured (3-10 bullets). Prefer fewer, higher-quality entries.

## Required workflow (always)

-   If memory file does not exist: `memvid_create`
-   Add knowledge: `memvid_add_text` (or `memvid_add_file`)
-   Persist: ALWAYS `memvid_commit` after adds
-   Recall: `memvid_search` for semantic queries; `memvid_search_by_tag` for exact lookup

## Tagging standard (use tags consistently)

Use key-value tags:

-   project: opencode-obsidian
-   area: http | sse | context | write | build | security
-   type: decision | contract | playbook
-   status: stable

## Search usage

-   Before implementing a feature or debugging a recurring issue: run `memvid_search`.
-   Return only the 3-7 most relevant hits; summarize, don’t dump everything.
