# 429-throttle-mcp — English

[中文](README.md) | English

> Stop getting rejected with HTTP 429 — a rate-limited MCP proxy that lets models automatically control call pacing during long-running tasks.

---

## What is it

Many free LLM APIs (Grok, Gemini, Dots, etc.) only allow ~30 calls per minute. During long-running tasks (search + PPT generation, batch tool calls), models easily hit the rate limit and get rejected with HTTP 429.

`429-throttle-mcp` provides a **transparent rate-limiting layer**:

```
Model → call_api tool → Rate Limiter → Actual API Request → Response + Usage Snapshot
```

The model doesn't need to know about rate limits — it just calls `call_api` normally. The rate limiter operates transparently inside the MCP: if quota is available, the request goes through; if not, the model is told how long to wait before retrying.

---

## Package Structure

Monorepo with two standalone npm packages sharing the core rate-limiting logic:

```
429-throttle-mcp/
├── packages/
│   ├── rate-limiter.js              # Core rate limiter (shared)
│   ├── 429-throttle-mcp/            # MCP Server package
│   │   ├── package.json
│   │   ├── server.js
│   │   └── README.md
│   └── dsh-throttle/                # DSH Plugin package
│       ├── package.json
│       ├── plugin.js
│       └── README.md
├── dsh-manifest.json
├── README.md
└── .env.example
```

| Package | Install | Use case |
|---------|---------|----------|
| `429-throttle-mcp` | `npm i 429-throttle-mcp` | MCP Server (ZCode & other MCP clients) |
| `dsh-throttle` | `npm i dsh-throttle` | DeepSeek Harness Plugin |

---

## Core Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAX_CALLS` | 30 | Max API calls per minute (RPM) |
| `MAX_TOKENS` | 750000 | Max tokens per minute (TPM), request + response |

---

## Exposed Tools

### `call_api`

Send HTTP requests through the rate-limited proxy. All external API calls must go through this tool.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | ✅ | Full API URL |
| `method` | string | ❌ | HTTP method, default GET |
| `body` | string | ❌ | Request body as JSON string |
| `headers` | string | ❌ | Custom headers as JSON string |

Returns: API response + `_meta.rateLimit` usage snapshot. If rate limited, returns `RATE_LIMIT_EXCEEDED` with suggested wait time in seconds.

### `get_rate_limit_status`

Query current rate limit usage. Returns used/remaining calls and tokens, plus a recommendation. No queue counter — avoids user anxiety.

### `set_rate_limit`

Dynamically adjust rate limit parameters (corresponds to slider control, takes effect instantly without restart).

| Parameter | Type | Description |
|-----------|------|-------------|
| `callsPerMinute` | number | Max calls per minute (RPM) |
| `tokensPerMinute` | number | Max tokens per minute (TPM) |

---

## Installation

### MCP Client (e.g. ZCode)

```bash
npm install 429-throttle-mcp
```

Add to your MCP config:

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

### DeepSeek Harness

```bash
npm install dsh-throttle
```

Add to your DSH config:

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

---

## Workflow Example

When a model works on a brand PPT search task:

1. Call `get_rate_limit_status` → confirm quota available
2. Call `call_api` → search brand keywords
3. If rejected → wait `retryAfterSeconds` then retry
4. Repeat 2-3 until all info collected
5. Call `set_rate_limit` → tighten limits for generation phase

---

## Rate Limiting Algorithm

**Sliding Window + Token Bucket**: maintains a 60-second window, recording timestamp and token consumption for each call. Old records outside the window are auto-pruned. When the limit is exceeded, the remaining wait time is calculated from the oldest record.

**Concurrency-safe**: `tryConsume()` is synchronous and atomic within Node.js's single-threaded event loop — no race conditions.

---

## Why this instead of "slow down" in prompt?

| Approach | Effect |
|----------|--------|
| Prompt says "call every 2 seconds" | ❌ Model has no stopwatch, won't comply, bursts still cause 429 |
| External rate-limit script | ❌ Extra process, model unaware, hard to debug |
| **MCP Rate-Limit Proxy (this project)** | ✅ Model-transparent, structured errors + wait hints |

---

## Application scenario Keyword

429报错, anti 429, MCP限流, 大模型每分钟调用限制, 免费大模型速率限制, Agent批量调用触发429, MCP排队调用, RPM, TPM, rate limiter mcp, quota guard, mcp server, mcp proxy, throttle, llm api quota, cop, HTTP 429, Too Many Requests, rate limiting, token bucket, sliding window, API proxy, LLM rate limit, AI API throttle, concurrent rate limit, 30 calls per minute

---

## License

MIT
