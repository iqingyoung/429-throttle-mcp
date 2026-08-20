# dsh-throttle

> DeepSeek Harness 限流插件 — 为 Harness 生态提供速率限制的 API 代理，复用 429-throttle-mcp 核心逻辑。

**English below ↓**

---

## 是什么

很多免费大模型 API（Grok、Gemini、Dots 等）每分钟只能调用 30 次左右。Agent 在做长程任务时，很容易超出限额被 429 拒绝。

`dsh-throttle` 在这个痛点上提供了一个**透明限流层**，专为 DeepSeek Harness 生态设计：

```
Agent → call_api 工具 → 限流器 → 实际 API 请求 → 返回结果 + 用量快照
```

与 `429-throttle-mcp` 共享同一个 `rate-limiter.js` 核心逻辑，只是通信协议从 MCP stdio 改为 DSH Plugin API。

---

## 核心参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `maxCalls` | 30 | 每分钟最大调用次数 (RPM) |
| `maxTokens` | 750000 | 每分钟最大 Token 数 (TPM)，含请求体和响应体 |

配置来源：DSH config 或 `dsh-manifest.json`。

---

## 暴露的工具

### `call_api`

通过限流代理发送 HTTP 请求。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | string | ✅ | 目标 API 的完整 URL |
| `method` | string | ❌ | HTTP 方法，默认 GET |
| `body` | string | ❌ | 请求体，JSON 字符串 |
| `headers` | string | ❌ | 自定义请求头，JSON 字符串 |

如果被限流拒绝，返回 `RATE_LIMIT_EXCEEDED` 错误，包含 `retryAfterSeconds` 建议等待时间。

### `get_rate_limit_status`

查询当前速率限制使用情况。返回已用/剩余调用次数和 Token 数。

### `set_rate_limit`

动态调整限流参数（实时生效无需重启）。

| 参数 | 类型 | 说明 |
|------|------|------|
| `callsPerMinute` | number | 每分钟最大调用次数 (RPM) |
| `tokensPerMinute` | number | 每分钟最大 Token 数 (TPM) |

---

## 安装

```bash
npm install dsh-throttle
```

在 DSH 配置中添加：

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

加载插件：

```bash
dsh plugin load dsh-throttle
```

---

## 与 429-throttle-mcp 的关系

| | `429-throttle-mcp` | `dsh-throttle` |
|---|---|---|
| 类型 | MCP Server | DSH Plugin |
| 通信协议 | MCP stdio JSON-RPC | DSH Plugin API |
| 安装 | `npm i 429-throttle-mcp` | `npm i dsh-throttle` |
| 核心代码 | `rate-limiter.js`（共享） | `rate-limiter.js`（共享） |
| GitHub | 主仓库 | 同仓库 |

---

## SEO 关键词

429报错, anti 429, DSH限流, DeepSeek Harness plugin, 大模型每分钟调用限制, 免费大模型速率限制, Agent批量调用触发429, RPM, TPM, rate limiter, quota guard, mcp proxy, throttle, llm api quota, cop, HTTP 429, Too Many Requests, rate limiting, token bucket, sliding window

---

## License

MIT

---

---

# dsh-throttle — English

> DeepSeek Harness rate-limiting plugin — provides rate-limited API proxying for the Harness ecosystem, sharing core logic with 429-throttle-mcp.

**中文在上面 ↑**

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