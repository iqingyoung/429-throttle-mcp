# 429-throttle-mcp

[English](README.en.md) | 中文

> 不再被 API 429 拒绝 — 一个带速率限制的 MCP 代理，让模型在长程任务中自动控制调用节奏。

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

