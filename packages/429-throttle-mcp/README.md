# 429-throttle-mcp

| | |
|---|---|
| **中文** | [README](./README.md) |
| **English** | [README](./README.md) |

> 不再被 API 429 拒绝 — 一个带速率限制的 MCP 代理，让模型在长程任务中自动控制调用节奏。

---

## 是什么 / What is it

很多免费大模型 API（Grok、Gemini、Dots 等）每分钟只能调用 30 次左右。模型在做长程任务（搜索 + 生成 PPT、批量调用工具）时，很容易超出限额被 429 拒绝。

`429-throttle-mcp` 在这个痛点上提供了一个**透明限流层**：

```
模型 → call_api 工具 → 限流器 → 实际 API 请求 → 返回结果 + 用量快照
```

模型不需要知道速率限制的存在，它只需要正常调用 `call_api`。限流逻辑在 MCP 内部透明执行——额度够就放行，不够就告诉模型等多久再重试。

---

## 核心参数 / Core Parameters

| 参数 / Parameter | 默认值 / Default | 说明 / Description |
|---|---|---|
| `MAX_CALLS` | 30 | 每分钟最大调用次数 / Max API calls per minute |
| `MAX_TOKENS` | 750000 | 每分钟最大 Token 数（请求体 + 响应体）/ Max tokens per minute |

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

**返回**：API 响应 + `_meta.rateLimit` 用量快照。 / API response with rate limit usage snapshot.

如果被限流拒绝，返回 `RATE_LIMIT_EXCEEDED` 错误，包含 `retryAfterSeconds` 建议等待时间。 / If rate limited, returns `RATE_LIMIT_EXCEEDED` with suggested wait time.

### `get_rate_limit_status`

查询当前速率限制使用情况。返回已用/剩余调用次数和 Token 数。 / Query current rate limit usage. Returns used/remaining calls and tokens.

### `set_rate_limit`

动态调整限流参数（对应滑块调节，实时生效无需重启）。 / Dynamically adjust rate limit parameters (real-time, no restart needed).

| 参数 / Parameter | 类型 / Type | 说明 / Description |
|---|---|---|
| `callsPerMinute` | number | 每分钟最大调用次数 / Max calls per minute |
| `tokensPerMinute` | number | 每分钟最大 Token 数 / Max tokens per minute |

---

## 安装 / Installation

### MCP 客户端（如 ZCode）

```bash
npm install 429-throttle-mcp
```

在 MCP 配置中添加： / Add to your MCP config:

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

## 工作流示例 / Workflow Example

模型在做品牌 PPT 搜索任务时： / When a model works on a brand PPT search task:

1. 调用 `get_rate_limit_status` → 确认额度充足 / Check rate limit status
2. 调用 `call_api` → 搜索品牌关键词 / Search brand keywords
3. 如果被拒绝 → 等待 `retryAfterSeconds` 后重试 / If rejected, wait and retry
4. 重复 2-3 直到收集完所有信息 / Repeat until all info collected
5. 调用 `set_rate_limit` → 收紧限流参数用于生成阶段 / Tighten limits for generation phase

---

## 限流算法 / Rate Limiting Algorithm

**滑动窗口 + 令牌桶**（Sliding Window + Token Bucket）：维护 60 秒滑动窗口，每次调用记录时间戳和 token 消耗。窗口外的旧记录自动清理。超过限制时计算最早记录的剩余等待时间。

**并发安全**：`tryConsume()` 是同步函数，在 Node.js 单线程事件循环中天然串行化，不会出现竞态条件。 / Concurrency-safe: `tryConsume()` is synchronous and atomic within Node.js's single-threaded event loop.

---

## Token 估算 / Token Estimation

MVP 版本使用粗略估算：中文字符 × 1.5 + 英文单词 × 0.75。生产环境建议替换为对应模型的精确 tokenizer。 / MVP uses rough estimation: Chinese chars × 1.5 + English words × 0.75. Replace with a precise tokenizer for production.

---

## 关键词 / Keywords

429 报错, anti 429, MCP 限流, 大模型每分钟调用限制, 免费大模型速率限制, Agent 批量调用触发 429, MCP 排队调用, RPM, TPM, rate limiter mcp, quota guard, mcp server, mcp proxy, throttle, llm api quota, cop, HTTP 429, Too Many Requests, rate limiting, token bucket, sliding window, API proxy

---

## License

MIT