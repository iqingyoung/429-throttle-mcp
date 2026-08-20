# 429-throttle-mcp

> 不再被 API 429 拒绝 — 一个带速率限制的 MCP 代理，让模型在长程任务中自动控制调用节奏。

## 是什么

很多免费大模型 API（Grok、Gemini、Dots 等）每分钟只能调用 30 次左右。模型在做长程任务（搜索 + 生成 PPT、批量调用工具）时，很容易超出限额被 429 拒绝。

`429-throttle-mcp` 在这个痛点上提供了一个**透明限流层**：

```
模型 → call_api 工具 → 限流器 → 实际 API 请求 → 返回结果 + 用量快照
```

模型不需要知道速率限制的存在，它只需要正常调用 `call_api`。限流逻辑在 MCP 内部透明执行——额度够就放行，不够就告诉模型等多久再重试。

## 包结构

本仓库是 Monorepo，包含两个 npm 包：

| 包名 | 安装 | 用途 |
|------|------|------|
| `429-throttle-mcp` | `npm i 429-throttle-mcp` | MCP Server，供 ZCode 等 MCP 客户端使用 |
| `dsh-throttle` | `npm i dsh-throttle` | DeepSeek Harness Plugin |

两个包共享 `packages/rate-limiter.js` 核心限流逻辑，各自适配通信协议。

```
429-throttle-mcp/
├── packages/
│   ├── rate-limiter.js              # 🔥 核心限流逻辑（共享，不修改）
│   ├── 429-throttle-mcp/            # MCP Server 包
│   │   ├── package.json
│   │   └── server.js
│   └── dsh-throttle/                # DSH Plugin 包
│       ├── package.json
│       └── plugin.js
├── dsh-manifest.json                # DSH plugin 声明
├── package.json                     # Monorepo 根
├── README.md
└── .env.example
```

## 核心参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `MAX_CALLS` | 30 | 每分钟最大调用次数 |
| `MAX_TOKENS` | 750000 | 每分钟最大 Token 数（请求体 + 响应体） |

## 暴露的工具

### `call_api`

通过限流代理发送 HTTP 请求。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | string | ✅ | 目标 API 的完整 URL |
| `method` | string | ❌ | HTTP 方法，默认 GET |
| `body` | string | ❌ | 请求体，JSON 字符串 |
| `headers` | string | ❌ | 自定义请求头，JSON 字符串 |

**返回**：API 响应 + `_meta.rateLimit` 用量快照。

如果被限流拒绝，返回 `RATE_LIMIT_EXCEEDED` 错误，包含 `retryAfterSeconds` 建议等待时间。

### `get_rate_limit_status`

查询当前速率限制使用情况。返回已用/剩余调用次数和 Token 数。

### `set_rate_limit`

动态调整限流参数（对应滑块调节，实时生效无需重启）。

| 参数 | 类型 | 说明 |
|------|------|------|
| `callsPerMinute` | number | 每分钟最大调用次数 |
| `tokensPerMinute` | number | 每分钟最大 Token 数 |

## 安装和使用

### MCP Server

```bash
npm install -g 429-throttle-mcp
MAX_CALLS=30 MAX_TOKENS=750000 node node_modules/429-throttle-mcp/server.js
```

在 MCP 客户端配置中添加：

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

### DSH Plugin

```bash
npm install -g dsh-throttle
dsh plugin load dsh-throttle
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

## 工作流示例

模型在做品牌 PPT 搜索任务时：

1. 调用 `get_rate_limit_status` → 确认额度充足
2. 调用 `call_api` → 搜索品牌关键词
3. 如果被拒绝 → 等待 `retryAfterSeconds` 后重试
4. 重复 2-3 直到收集完所有信息
5. 调用 `set_rate_limit` → 如果搜索完成，收紧限流参数用于生成阶段

## 限流算法

**滑动窗口 + 令牌桶**：维护 60 秒滑动窗口，每次调用记录时间戳和 token 消耗。窗口外的旧记录自动清理。超过限制时计算最早记录的剩余等待时间。

**并发安全**：`tryConsume()` 是同步函数，在 Node.js 单线程事件循环中天然串行化，不会出现竞态条件。

## Token 估算

MVP 版本使用粗略估算：中文字符 × 1.5 + 英文单词 × 0.75。生产环境建议替换为对应模型的精确 tokenizer。

## License

MIT