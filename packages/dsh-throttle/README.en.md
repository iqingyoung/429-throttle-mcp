# dsh-throttle

English | [中文](README.md)

> DeepSeek Harness rate-limiting plugin — a transparent API proxy for the Harness ecosystem, reusing 429-throttle-mcp core logic.

---

## What is it

Many free LLM APIs (Grok, Gemini, Dots, etc.) only allow ~30 calls per minute. During long-running tasks, agents easily exceed the quota and get rejected with HTTP 429.

`dsh-throttle` provides a **transparent rate-limiting layer** purpose-built for the DeepSeek Harness ecosystem:

```
Agent → call_api tool → rate limiter → actual API request → result + usage snapshot
```

It shares the same `rate-limiter.js` core as `429-throttle-mcp`, differing only in the communication protocol — MCP stdio JSON-RPC vs. DSH Plugin API.

---

## Core Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxCalls` | 30 | Max calls per minute (RPM) |
| `maxTokens` | 750000 | Max tokens per minute (TPM), including request and response bodies |

Config source: DSH config or `dsh-manifest.json`.

---

## Exposed Tools

### `call_api`

Send an HTTP request through the rate-limiting proxy.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | ✅ | Full URL of the target API |
| `method` | string | ❌ | HTTP method, defaults to GET |
| `body` | string | ❌ | Request body, JSON string |
| `headers` | string | ❌ | Custom headers, JSON string |

If rate-limited, returns a `RATE_LIMIT_EXCEEDED` error with `retryAfterSeconds` suggesting how long to wait.

### `get_rate_limit_status`

Query current rate-limit usage. Returns used/remaining calls and tokens.

### `set_rate_limit`

Dynamically adjust rate-limit parameters (takes effect immediately, no restart needed).

| Parameter | Type | Description |
|-----------|------|-------------|
| `callsPerMinute` | number | Max calls per minute (RPM) |
| `tokensPerMinute` | number | Max tokens per minute (TPM) |

---

## Installation

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
| Core code | `rate-limiter.js` (shared) | `rate-limiter.js` (shared) |
| GitHub | main repo | same repo |

---

## SEO Keywords

429 error, anti 429, DSH rate limit, DeepSeek Harness plugin, LLM per-minute call limit, free LLM rate limiting, agent batch calls triggering 429, RPM, TPM, rate limiter, quota guard, MCP proxy, throttle, LLM API quota, cop, HTTP 429, Too Many Requests, rate limiting, token bucket, sliding window

---

## License

MIT