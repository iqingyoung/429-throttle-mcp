# 429-throttle-mcp

> 不再被 API 429 拒绝 — 一个带速率限制的 MCP 代理，让模型在长程任务中自动控制调用节奏。

**English version below ↓**

---

## 是什么

很多免费大模型 API（Grok、Gemini、Dots 等）每分钟只能调用 30 次左右。模型在做长程任务（搜索 + 生成 PPT、批量调用工具）时，很容易超出限额被 429 拒绝。

`429-throttle-mcp` 在这个痛点上提供了一个**透明限流层**：

```
模型 → call_api 工具 → 限流器 → 实际 API 请求 → 返回结果 + 用量快照
```

模型不需要知道速率限制的存在，它只需要正常调用 `call_api`。限流逻辑在 MCP 内部透明执行——额度够就放行，不够就告诉模型等多久再重试。

---

## 包结构

Monorepo，包含两个独立 npm 包，共享核心限流逻辑：

```
429-throttle-mcp/
├── packages/
│   ├── rate-limiter.js              # 核心限流逻辑（共享）
│   ├── 429-throttle-mcp/            # MCP Server 包
│   │   ├── package.json
│   │   ├── server.js
│   │   └── README.md
│   └── dsh-throttle/                # DSH Plugin 包
│       ├── package.json
│       ├── plugin.js
│       └── README.md
├── dsh-manifest.json
├── README.md
└── .env.example
```

| 包名 | 安装 | 用途 |
|------|------|------|
| `429-throttle-mcp` | `npm i 429-throttle-mcp` | MCP Server（ZCode 等 MCP 客户端） |
| `dsh-throttle` | `npm i dsh-throttle` | DeepSeek Harness Plugin |

---

## 核心参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `MAX_CALLS` | 30 | 每分钟最大调用次数 (RPM) |
| `MAX_TOKENS` | 750000 | 每分钟最大 Token 数 (TPM)，含请求体和响应体 |

---

## 暴露的工具

### `call_api`

通过限流代理发送 HTTP 请求。所有外部 API 调用必须经过此工具。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | string | ✅ | 目标 API 的完整 URL |
| `method` | string | ❌ | HTTP 方法，默认 GET |
| `body` | string | ❌ | 请求体，JSON 字符串 |
| `headers` | string | ❌ | 自定义请求头，JSON 字符串 |

返回：API 响应 + `_meta.rateLimit` 用量快照。如果被限流拒绝，返回 `RATE_LIMIT_EXCEEDED` 错误，包含 `retryAfterSeconds` 建议等待时间。

### `get_rate_limit_status`

查询当前速率限制使用情况。返回已用/剩余调用次数和 Token 数，以及建议。不包含队列计数器，避免用户焦虑。

### `set_rate_limit`

动态调整限流参数（对应滑块调节，实时生效无需重启）。

| 参数 | 类型 | 说明 |
|------|------|------|
| `callsPerMinute` | number | 每分钟最大调用次数 (RPM) |
| `tokensPerMinute` | number | 每分钟最大 Token 数 (TPM) |

---

## 安装

### MCP 客户端（如 ZCode）

```bash
npm install 429-throttle-mcp
```

在 MCP 配置中添加：

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

---

## 工作流示例

模型在做品牌 PPT 搜索任务时：

1. 调用 `get_rate_limit_status` → 确认额度充足
2. 调用 `call_api` → 搜索品牌关键词
3. 如果被拒绝 → 等待 `retryAfterSeconds` 后重试
4. 重复 2-3 直到收集完所有信息
5. 调用 `set_rate_limit` → 收紧限流参数用于生成阶段

---

## 限流算法

**滑动窗口 + 令牌桶**（Sliding Window + Token Bucket）：维护 60 秒滑动窗口，每次调用记录时间戳和 token 消耗。窗口外的旧记录自动清理。超过限制时计算最早记录的剩余等待时间。

**并发安全**：`tryConsume()` 是同步函数，在 Node.js 单线程事件循环中天然串行化，不会出现竞态条件。

---

## 为什么用这个而不是 prompt 里写"慢点调用"？

| 方式 | 效果 |
|------|------|
| Prompt 写"每 2 秒调用一次" | ❌ 模型没有秒表，不会遵守，burst 出去照样 429 |
| 外部脚本限流 | ❌ 需要额外进程，模型不感知，出错难调试 |
| **MCP 限流代理（本项目）** | ✅ 模型无感，透明把关，结构化错误 + 等待建议 |

---

## SEO 关键词

429报错, anti 429, MCP限流, 大模型每分钟调用限制, 免费大模型速率限制, Agent批量调用触发429, MCP排队调用, RPM, TPM, rate limiter mcp, quota guard, mcp server, mcp proxy, throttle, llm api quota, cop, HTTP 429, Too Many Requests, rate limiting, token bucket, sliding window, API proxy, LLM rate limit, AI API throttle, concurrent rate limit, 30 calls per minute

---

## License

MIT

---

---

# 429-throttle-mcp — English

> Stop getting rejected with HTTP 429 — a rate-limited MCP proxy that lets models automatically control call pacing during long-running tasks.

**中文版本在上面 ↑**

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

## SEO Keywords

429报错, anti 429, MCP限流, 大模型每分钟调用限制, 免费大模型速率限制, Agent批量调用触发429, MCP排队调用, RPM, TPM, rate limiter mcp, quota guard, mcp server, mcp proxy, throttle, llm api quota, cop, HTTP 429, Too Many Requests, rate limiting, token bucket, sliding window, API proxy, LLM rate limit, AI API throttle, concurrent rate limit, 30 calls per minute

---

## License

MIT