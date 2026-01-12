---
inclusion: always
---

# MCP usage policy (minimal)

## Tool routing (use the right MCP)

-   Obsidian content operations (read/search/write): use `obsidian-mcp-server` first.
-   Repo operations (status/add/commit/reset): use `git`.
-   Simple web fetch / HTTP calls: use `fetch`.
-   Browser-required tasks (login, complex pages, screenshots, dynamic content): use `playwright`.
-   Scratch/temporary notes: prefer Obsidian notes, not memory servers.
-   Long-term memory only when explicitly requested:
    -   user preferences / durable decisions -> `memory`
    -   durable knowledge base / semantic recall -> `memvid`

## Safety guardrails

-   Never write whole notes by default. Prefer insert/append only.
-   Before any Obsidian write:
    1. show intended target file/path and a short change summary
    2. perform the minimal change (insert/append)
-   Before `git_commit`:
    -   run `git_status`, summarize changes in 3-6 bullets
    -   commit message must be explicit and scoped
-   Before writing to `memory` or `memvid`:
    -   only store durable preferences/decisions or stable project facts
    -   never store secrets/tokens/keys/logs/transient errors

## Redundancy / conflicts

-   Do not use `everything` unless testing MCP connectivity or exploring capabilities.
-   Prefer specialized MCPs over `everything`.

## Output expectations

-   When changes are made (vault or git), always include:
    -   what changed (files/sections)
    -   why changed (1-2 lines)
    -   how to undo (where applicable)
