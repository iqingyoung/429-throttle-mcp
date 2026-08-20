# dsh-throttle

| | |
|---|---|
| **中文** | [README](./README.md) |
| **English** | [README](./README.md) |

> DeepSeek Harness 限流插件 — 为 Harness 生态提供速率限制的 API 代理，复用 429-throttle-mcp 核心逻辑。

---

## 是什么 / What is it

很多免费大模型 API（Grok、Gemini、Dots 等）每分钟只能调用 30 次左右。Agent 在做长程任务时，很容易超出限额被 429 拒绝。

`dsh-throttle` 在这个痛点上提供了一个**透明限流层**，专为 DeepSeek Harness 生态设计：

```
Agent → call_api 工具 → 限流器 → 实际 API 请求 → 返回结果 + 用量快照
```

与 `429-throttle-mcp` 共享同一个 `rate-limiter.js` 核心逻辑，只是通信协议从 MCP stdio 改为 DSH Plugin API。

---

## 核心参数 / Core Parameters

| 参数 / Parameter | 默认值 / Default | 说明 / Description |
|---|---|---|
| `maxCalls` | 30 | 每分钟最大调用次数 / Max API calls per minute |
| `maxTokens` | 750000 | 每分钟最大 Token 数（请求体 + 响应体）/ Max tokens per minute |

配置来源：DSH config 或 `dsh-manifest.json`。 / Config source: DSH config or `dsh-manifest.json`.

---

## 暴露的工具 / Exposed Tools

### `call_api`

通过限流代理发送 HTTP 请求。 / Send HTTP requests through the rate-limited proxy.

| 参数 / Parameter | 类型 / Type | 必填 / Required | 说明 / Description |
|---|---|---|---|
| `url` | string | ✅ | 目标 API 的完整 URL / Full API URL |
| `method` | string | ❌ | HTTP 方法，默认 GET / HTTP method, default GET |
| `body` | string | ❌ | 请求体，JSON 字符串 / Request body as JSON string |
| `headers` | string | ❌ | 自定义请求头，JSON 字符串 / Custom headers as JSON string |

如果被限流拒绝，返回 `RATE_LIMIT_EXCEEDED` 错误，包含 `retryAfterSeconds` 建议等待时间。 / If rate limited, returns `RATE_LIMIT_EXCEEDED` with suggested wait time.

### `get_rate_limit_status`

查询当前速率限制使用情况。返回已用/剩余调用次数和 Token 数。 / Query current rate limit usage.

### `set_rate_limit`

动态调整限流参数（实时生效无需重启）。 / Dynamically adjust rate limit parameters (real-time, no restart needed).

---

## 安装 / Installation

### DeepSeek Harness

```bash
npm install dsh-throttle
```

在 DSH 配置中添加： / Add to your DSH config:

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

加载插件： / Load the plugin:

```bash
dsh plugin load dsh-throttle
```

---

## 与 429-throttle-mcp 的关系 / Relationship with 429-throttle-mcp

| | `429-throttle-mcp` | `dsh-throttle` |
|---|---|---|
| 类型 / Type | MCP Server | DSH Plugin |
| 通信协议 / Protocol | MCP stdio JSON-RPC | DSH Plugin API |
| 安装 / Install | `npm i 429-throttle-mcp` | `npm i dsh-throttle` |
| 核心代码 / Core | `rate-limiter.js`（共享/Shared） | `rate-limiter.js`（共享/Shared） |
| GitHub | 主仓库/Main repo | 同仓库/Sub-package |

---

## 关键词 / Keywords

429 报错, anti 429, DSH 限流, DeepSeek Harness plugin, 大模型每分钟调用限制, 免费大模型速率限制, Agent 批量调用触发 429, RPM, TPM, rate limiter, quota guard, mcp proxy, throttle, llm api quota, cop, HTTP 429, Too Many Requests, rate limiting, token bucket, sliding window

---

## License

MIT