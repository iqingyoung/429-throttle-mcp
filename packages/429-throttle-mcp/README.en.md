# 429-throttle-mcp — English

> Stop getting rejected with HTTP 429 — a rate-limited MCP proxy that lets models automatically control call pacing during long-running tasks.

**中文在上面 ↑**

---

## What is it

Many free LLM APIs (Grok, Gemini, Dots, etc.) only allow ~30 calls per minute. During long-running tasks, models easily hit the rate limit and get rejected with HTTP 429.

`429-throttle-mcp` provides a **transparent rate-limiting layer**:

```
Model → call_api tool → Rate Limiter → Actual API Request → Response + Usage Snapshot
```

The model doesn't need to know about rate limits — it just calls `call_api` normally.

---

## Core Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAX_CALLS` | 30 | Max API calls per minute (RPM) |
| `MAX_TOKENS` | 750000 | Max tokens per minute (TPM), request + response |

---

## Exposed Tools

### `call_api`

Send HTTP requests through the rate-limited proxy.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | ✅ | Full API URL |
| `method` | string | ❌ | HTTP method, default GET |
| `body` | string | ❌ | Request body as JSON string |
| `headers` | string | ❌ | Custom headers as JSON string |

If rate limited, returns `RATE_LIMIT_EXCEEDED` with `retryAfterSeconds`.

### `get_rate_limit_status`

Query current rate limit usage. Returns used/remaining calls and tokens. No queue counter.

### `set_rate_limit`

Dynamically adjust rate limit parameters (real-time, no restart).

| Parameter | Type | Description |
|-----------|------|-------------|
| `callsPerMinute` | number | Max calls per minute (RPM) |
| `tokensPerMinute` | number | Max tokens per minute (TPM) |

---

## Installation

```bash
npm install 429-throttle-mcp
```

Add to MCP config:

```json
{
  "mcpServers": {
    "429-throttle-mcp": {
      "command": "node",
      "args": ["node_modules/429-throttle-mcp/server.js"],
      "env": {
        "MAX_CALLS": "30",
        "MAX_TOKENS": "750000"
      }
    }
  }
}
```

---

## Workflow

1. Call `get_rate_limit_status` → confirm quota
2. Call `call_api` → search
3. If rejected → wait `retryAfterSeconds` → retry
4. Repeat until done
5. Call `set_rate_limit` → tighten for generation

---

## Algorithm

**Sliding Window + Token Bucket**: 60-second window, auto-prune old records. `tryConsume()` is synchronous and concurrency-safe within Node.js's event loop.

---

## SEO Keywords

429, anti 429, MCP rate limit, RPM, TPM, rate limiter mcp, quota guard, mcp server, mcp proxy, throttle, llm api quota, HTTP 429, Too Many Requests, rate limiting, token bucket, sliding window, API proxy

---

## License

MIT