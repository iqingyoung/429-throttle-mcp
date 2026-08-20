# dsh-throttle — English

> DeepSeek Harness rate-limiting plugin — provides rate-limited API proxying for the Harness ecosystem, sharing core logic with 429-throttle-mcp.

---

## What is it

Many free LLM APIs only allow ~30 calls per minute. Agents easily hit the rate limit and get rejected with HTTP 429 during long-running tasks.

`dsh-throttle` provides a **transparent rate-limiting layer** purpose-built for DeepSeek Harness:

```
Agent → call_api tool → Rate Limiter → Actual API Request → Response + Usage Snapshot
```

Shares the same `rate-limiter.js` core as `429-throttle-mcp`, with the communication layer adapted from MCP stdio to the DSH Plugin API.

---

## Core Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxCalls` | 30 | Max API calls per minute (RPM) |
| `maxTokens` | 750000 | Max tokens per minute (TPM), request + response |

Config source: DSH config or `dsh-manifest.json`.

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

Query current rate limit usage. Returns used/remaining calls and tokens.

### `set_rate_limit`

Dynamically adjust rate limit parameters (real-time, no restart).

---

## Installation

```bash
npm install dsh-throttle
```

Add to DSH config:

```json
{
  "plugins": {
    "dsh-throttle": {
      "maxCalls": 30,
      "maxTokens": 750000
    }
  }
}
```

Load the plugin:

```bash
dsh plugin load dsh-throttle
```

---

## Relationship with 429-throttle-mcp

| | `429-throttle-mcp` | `dsh-throttle` |
|---|---|---|
| Type | MCP Server | DSH Plugin |
| Protocol | MCP stdio JSON-RPC | DSH Plugin API |
| Install | `npm i 429-throttle-mcp` | `npm i dsh-throttle` |
| Core | `rate-limiter.js` (shared) | `rate-limiter.js` (shared) |
| GitHub | Main repo | Same repo |

---

## SEO Keywords

429, anti 429, DSH rate limit, DeepSeek Harness plugin, RPM, TPM, rate limiter, quota guard, mcp proxy, throttle, llm api quota, HTTP 429, Too Many Requests, rate limiting, token bucket, sliding window

---

## License

MIT