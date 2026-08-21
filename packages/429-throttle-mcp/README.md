# 429-throttle-mcp

[English](README.en.md) | 中文

> 不再被 API 429 拒绝 — 自带限流的 MCP 代理 + Agent 操作员技能。模型在长程任务中自动控速；非技术用户一句话完成「打开 / 调参 / 关闭 / 诊断 / 复盘」。

---

## 是什么

很多免费大模型 API（Grok、Gemini、Dots 等）每分钟只能调用 30 次左右。模型在做长程任务（搜索 + 生成 PPT、批量调用工具）时，很容易超出限额被 429 拒绝。

`429-throttle-mcp` 在这个痛点上提供了一个**透明限流层**：

```
模型 → call_api 工具 → 限流器 → 实际 API 请求 → 返回结果 + 用量快照
```

模型不需要知道速率限制的存在，它只需要正常调用 `call_api`。限流逻辑在 MCP 内部透明执行——额度够就放行，不够就告诉模型等多久再重试。

**适合谁**：
- **开发者 / Agent 框架用户**：`npm i 429-throttle-mcp`（MCP）或 `npm i dsh-throttle`（DSH）即得透明限流代理；
- **非技术用户**：配合 `rate-limit-operator` 技能，用一句话完成限流的打开、调参、关闭与复盘。

### v1.1 方向变化（重要）

v1.1 从「仅面向开发者的限流代理」升级为「**非技术用户也能用的限流控制面**」，新增三块能力：

1. **Agent 操作员技能 `rate-limit-operator`** — 把「打开 / 调参 / 关闭 / 诊断 / 复盘」全部口语化，由 agent 代劳。用户说「打开限流」「太慢了」「还是 429」「关掉限流」即可，无需懂 RPM/TPM、无需改文件。
2. **任务复盘 `begin_task` / `end_task`** — 长任务开始 / 结束时各调一次，返回：实际用时、调用次数、被限流次数、原定串行用时、按并发度推算的「第几轮会触顶」。
3. **两种 429 的区分** — 代理拦截（`rejectedCalls > 0`，可调参解决）vs 上游平台配额 429（只能查平台文档），避免盲目调高本代理上限反而更易被封。

---

## 版本与变更记录

当前版本 **v1.1.0**（npm 自 1.0.2 起跳升）。v1.1.0 变更：

- ✨ 新增工具：`begin_task` / `end_task`（长任务复盘）
- ✨ 新增统计：`totalDurationMs` / `avgLatencyMs`（`get_rate_limit_status` 返回）
- ✨ 新增操作员技能 `rate-limit-operator`（口语控制全流程）
- 🔒 安全加固：`call_api` 增加 URL scheme 白名单（仅 http/https）
- 🔧 兼容修复：适配 `@modelcontextprotocol/sdk` 1.30（改用高层 `McpServer` + Zod raw shape）

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
│   │   └── rate-limiter.js
│   └── dsh-throttle/                # DSH Plugin 包
│       ├── package.json
│       ├── plugin.js
│       └── rate-limiter.js
├── dsh-manifest.json
├── README.md
└── .env.example
```

| 包名 | 安装 | 用途 |
|------|------|------|
| `429-throttle-mcp` | `npm i 429-throttle-mcp` | MCP Server（ZCode / WorkBuddy 等 MCP 客户端） |
| `dsh-throttle` | `npm i dsh-throttle` | DeepSeek Harness Plugin |

---

## 核心参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `MAX_CALLS` | 30 | 每分钟最大调用次数 (RPM) |
| `MAX_TOKENS` | 750000 | 每分钟最大 Token 数 (TPM)，含请求体和响应体 |

参数优先级：`set_rate_limit` 工具动态调整 > env 启动值。动态调整实时生效但**进程重启后回到 env 默认值**；长期参数请改 env。

---

## 暴露的工具（v1.1 共 5 个）

### `call_api`

通过限流代理发送 HTTP 请求。所有外部 API 调用必须经过此工具（否则限流器无数据，复盘为空）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | string | ✅ | 目标 API 的完整 URL（仅 http/https） |
| `method` | string | ❌ | HTTP 方法，默认 GET |
| `body` | string | ❌ | 请求体，JSON 字符串 |
| `headers` | string | ❌ | 自定义请求头，JSON 字符串 |

返回：API 响应 + `_meta.rateLimit` 用量快照。如果被限流拒绝，返回 `RATE_LIMIT_EXCEEDED`，包含 `retryAfterSeconds` 建议等待时间。

### `get_rate_limit_status`

查询当前速率限制使用情况。返回已用/剩余调用次数和 Token 数、`rejectedCalls`（被本代理拦截数）、`totalDurationMs`（累计接口耗时）、`avgLatencyMs`（平均单次时延）及建议。**判 429 来源看 `rejectedCalls`**。

### `set_rate_limit`

动态调整限流参数（实时生效，无需重启）。

| 参数 | 类型 | 说明 |
|------|------|------|
| `callsPerMinute` | number | 每分钟最大调用次数 (RPM) |
| `tokensPerMinute` | number | 每分钟最大 Token 数 (TPM) |

### `begin_task`（v1.1 新增）

开启一个限流观测任务区间，返回 `taskId`。长任务开始前调用。

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | string | 任务名（可选，便于辨识） |

### `end_task`（v1.1 新增）

结束任务区间并返回复盘报告。

| 参数 | 类型 | 说明 |
|------|------|------|
| `taskId` | string | `begin_task` 返回的 taskId |
| `concurrency` | number | 假设每轮并发调用数，默认 1（串行） |

返回字段：

| 字段 | 含义 |
|------|------|
| `wallClockMs` / `apiTimeMs` | 任务挂钟用时 / 纯接口耗时 |
| `calls` / `tokens` | 本次任务调用次数 / Token 消耗 |
| `rejectedCalls` | 被本代理拦截次数（>0 = 本代理限流；=0 但仍见 429 = 上游平台） |
| `estimatedSerialDurationMs` | 原定串行用时（调用数 × 平均时延） |
| `timeoutRound` | 按给定并发度推算第几轮触顶（calls 限与 tokens 限先到者；「未达上限」= 没撞到） |

---

## 安装

### MCP 客户端（ZCode / WorkBuddy 等）

```bash
npm install 429-throttle-mcp
```

在 MCP 配置中添加（stdio）：

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

**方式一（推荐）：DSH CLI 一键挂载**

```bash
dsh plugin --profile web add dsh-throttle
```

**方式二：手动挂载**——将插件装入 `profiles/<profile>/node_modules/@deepseek-ai/dsh-throttle/`，并在 `cordis.patch.yml` 的 `- insert:` 数组追加条目：

```yaml
- id: dsh-throttle
  name: '@deepseek-ai/dsh-throttle'
  config: {}
```

---

## 🔍 重中之重：挂载后如何确认启用与跑通

### MCP 客户端（以 WorkBuddy 为例）

**第 1 步 — 启用**：连接器管理页找到 `429-throttle-mcp`，点击 **Trust**（首次挂载必须）。若配置里 `disabled: true`，先改为 `false`。

**第 2 步 — 确认已启用**（满足任一即成功）：
- ✅ 连接器管理页显示该 server **已连接**、工具 5/5
- ✅ 会话工具列表能看到 `429-throttle-mcp_call_api` / `get_rate_limit_status` 等
- ✅ 让模型调一次 `get_rate_limit_status`，**返回 JSON 即进程存活**

**第 3 步 — 命令行冒烟**（不依赖客户端 UI）：

```bash
# 从 server.js 所在目录启动，正常打印启动信息即 OK
node server.js
```

期望输出：`已启动` + `每分钟调用上限: 30 次` + `工具: call_api / get_rate_limit_status / set_rate_limit / begin_task / end_task`。

**常见问题**：
- 工具不可见 → 90% 是**会话未刷新**：新开一个对话窗口再试（MCP 工具在会话启动时加载）。
- 改了 `disabled` / env 参数 → 需**重启客户端**才生效。
- 只有 3 个工具、缺 `begin_task`/`end_task` → 装的是 1.0.x，请升级到 1.1.0。

### DeepSeek Harness

1. 插件装入 `profiles/<profile>/node_modules/@deepseek-ai/dsh-throttle/`，patch 加条目（见上）。
2. **重启 Harness**。
3. 工具列表出现 `call_api` / `get_rate_limit_status` / `set_rate_limit` / `begin_task` / `end_task`，即启用成功。
4. 冒烟：调 `get_rate_limit_status` 看返回。

### 跑通一次完整链路（推荐，含复盘）

```
1. begin_task({name:"演示"})                       → 记下 taskId
2. call_api({url:"https://example.com"})           → status 200 + _meta.rateLimit
3. end_task({taskId, concurrency:2})               → 用时 / 次数 / timeoutRound
4. get_rate_limit_status()                         → 累计统计
```

---

## Agent 操作员技能（口语控制，v1.1 新增）

将技能 `rate-limit-operator` 安装到 agent 技能目录（如 WorkBuddy 的 `~/.workbuddy/skills/rate-limit-operator/`）后，以下口语自动触发 agent 代劳：

| 阶段 | 用户口语 | agent 动作 |
|------|------|------|
| 打开 | 「打开限流 / 限流开着吗」 | 自检 → 报当前上限；未启用则提示 Trust / 改 disabled / 重启 |
| 调参 | 「调大点 / 太慢了 / 又被限了 / 恢复默认」 | 先查 `rejectedCalls` 判断是否本代理限流，再 `set_rate_limit` 调大 / 调小 / 复位 |
| 关闭 | 「关掉限流 / 不用了」 | 改 `disabled=true` 并提示重启，或引导在面板关闭 |
| 诊断 | 「还是 429」 | 判 `rejectedCalls`：>0 是本代理（可调）；=0 是上游平台配额（给查询路径，**不编造数值**） |
| 复盘 | 长任务结束 | `begin_task` / `end_task` 自动生成用时 / 次数 / 触顶轮次报告 |

> 重要认知：用户说「还是 429」时，**先判因再动作**。上游平台 429（免费 / 起步 plan 配额）不是本代理能解决的，盲目调高本代理上限只会打更猛、更易被封。

---

## 工作流示例（含复盘）

模型在做品牌 PPT 搜索任务时：

1. `begin_task({name:"PPT 搜索"})` → 记下 taskId
2. `get_rate_limit_status` → 确认额度充足
3. `call_api` → 搜索品牌关键词（如被拒 → 等 `retryAfterSeconds` 后重试）
4. 重复 2-3 直到收集完所有信息
5. `end_task({taskId, concurrency:3})` → 拿到用时 / 次数 / 触顶轮次复盘
6. `set_rate_limit` → 按复盘结果收紧或放宽限流参数

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
| **MCP 限流代理 + 操作员技能** | ✅ 非技术用户也能一句话「打开 / 调参 / 关闭 / 复盘」 |

---

## Application scenario Keyword

429报错, anti 429, MCP限流, 大模型每分钟调用限制, 免费大模型速率限制, Agent批量调用触发429, MCP排队调用, RPM, TPM, rate limiter mcp, quota guard, mcp server, mcp proxy, throttle, llm api quota, cop, HTTP 429, Too Many Requests, rate limiting, token bucket, sliding window, API proxy, LLM rate limit, AI API throttle, concurrent rate limit, 30 calls per minute, MCP 启用确认, MCP 冒烟测试

---

## License

MIT
