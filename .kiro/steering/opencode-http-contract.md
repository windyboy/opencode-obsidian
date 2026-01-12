---
inclusion: always
---

# opencode-http-contract

-   Use a single HTTP client wrapper (no scattered fetch).
-   Settings:
    -   baseUrl (required)
    -   apiKey (optional)
-   Request defaults:
    -   Content-Type: application/json
    -   Authorization: Bearer <apiKey> (only if apiKey is set)
    -   timeout: 30s (AbortController)
-   Error handling:
    -   401/403: show Notice "Invalid/expired API key or no permission" (no retry)
    -   429/5xx/network: show Notice "Request failed" + status if available
