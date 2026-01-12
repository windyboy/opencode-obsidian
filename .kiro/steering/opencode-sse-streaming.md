---
inclusion: always
---

# opencode-sse-streaming

-   Implement streaming only once (fetch + ReadableStream).
-   streamChat() must return stop() that aborts the request.
-   SSE parsing (minimal):
    -   split events by blank line (\n\n)
    -   collect all "data:" lines for one event
    -   end on "[DONE]" or "event: done"
-   After stop(): no further UI updates.
-   On disconnect: stop stream and show Notice "Connection interrupted".
