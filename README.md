# 429-throttle-mcp

<div id="lang-tabs" style="margin-bottom:24px">
  <button onclick="switchLang('zh')" id="tab-zh" style="display:inline-block;padding:6px 16px;margin-right:4px;border:1px solid #ddd;border-radius:4px 0 0 4px;background:#f0f0f0;cursor:pointer">中文</button>
  <button onclick="switchLang('en')" id="tab-en" style="display:inline-block;padding:6px 16px;border:1px solid #ddd;border-radius:0 4px 4px 0;background:#f0f0f0;cursor:pointer">English</button>
</div>

---

## <span id="zh">是什么</span><span id="en" style="display:none">What is it</span>

<span id="zh">很多免费大模型 API（Grok、Gemini、Dots 等）每分钟只能调用 30 次左右。模型在做长程任务（搜索 + 生成 PPT、批量调用工具）时，很容易超出限额被 429 拒绝。`429-throttle-mcp` 在这个痛点上提供了一个**透明限流层**：</span>
<span id="en" style="display:none">Many free LLM APIs (Grok, Gemini, Dots, etc.) only allow ~30 calls per minute. During long-running tasks (search + PPT generation, batch tool calls), models easily hit the rate limit and get rejected with HTTP 429. `429-throttle-mcp` provides a **transparent rate-limiting layer**:</span>

```
<span id="zh">模型 → call_api 工具 → 限流器 → 实际 API 请求 → 返回结果 + 用量快照</span>
<span id="en" style="display:none">Model → call_api tool → Rate Limiter → Actual API Request → Response + Usage Snapshot</span>
```

<span id="zh">模型不需要知道速率限制的存在，它只需要正常调用 `call_api`。限流逻辑在 MCP 内部透明执行——额度够就放行，不够就告诉模型等多久再重试。</span>
<span id="en" style="display:none">The model doesn't need to know about rate limits — it just calls `call_api` normally. The rate limiter operates transparently inside the MCP: if quota is available, the request goes through; if not, the model is told how long to wait before retrying.</span>

---

## <span id="zh">包结构</span><span id="en" style="display:none">Package Structure</span>

<span id="zh">Monorepo，包含两个独立 npm 包，共享核心限流逻辑：</span>
<span id="en" style="display:none">Monorepo with two standalone npm packages sharing the core rate-limiting logic:</span>

```
429-throttle-mcp/
├── packages/
│   ├── rate-limiter.js              <span id="zh"># 核心限流逻辑（共享）</span><span id="en" style="display:none"># Core rate limiter (shared)</span>
│   ├── 429-throttle-mcp/            <span id="zh"># MCP Server 包</span><span id="en" style="display:none"># MCP Server package</span>
│   │   ├── package.json
│   │   ├── server.js
│   │   └── README.md
│   └── dsh-throttle/                <span id="zh"># DSH Plugin 包</span><span id="en" style="display:none"># DSH Plugin package</span>
│       ├── package.json
│       ├── plugin.js
│       └── README.md
├── dsh-manifest.json
├── README.md
└── .env.example
```

| <span id="zh">包名</span><span id="en" style="display:none">Package</span> | <span id="zh">安装</span><span id="en" style="display:none">Install</span> | <span id="zh">用途</span><span id="en" style="display:none">Use case</span> |
|---|---|---|
| `429-throttle-mcp` | `npm i 429-throttle-mcp` | <span id="zh">MCP Server（ZCode 等 MCP 客户端）</span><span id="en" style="display:none">MCP Server (ZCode & other MCP clients)</span> |
| `dsh-throttle` | `npm i dsh-throttle` | <span id="zh">DeepSeek Harness Plugin</span><span id="en" style="display:none">DeepSeek Harness Plugin</span> |

---

## <span id="zh">核心参数</span><span id="en" style="display:none">Core Parameters</span>

| <span id="zh">参数</span><span id="en" style="display:none">Parameter</span> | <span id="zh">默认值</span><span id="en" style="display:none">Default</span> | <span id="zh">说明</span><span id="en" style="display:none">Description</span> |
|---|---|---|
| `MAX_CALLS` | 30 | <span id="zh">每分钟最大调用次数 / Max API calls per minute (RPM)</span><span id="en" style="display:none">Max API calls per minute (RPM)</span> |
| `MAX_TOKENS` | 750000 | <span id="zh">每分钟最大 Token 数（请求体 + 响应体）/ Max tokens per minute (TPM)</span><span id="en" style="display:none">Max tokens per minute (TPM), request + response</span> |

---

## <span id="zh">暴露的工具</span><span id="en" style="display:none">Exposed Tools</span>

### `call_api`

<span id="zh">通过限流代理发送 HTTP 请求。所有外部 API 调用必须经过此工具。</span>
<span id="en" style="display:none">Send HTTP requests through the rate-limited proxy. All external API calls must go through this tool.</span>

| <span id="zh">参数</span><span id="en" style="display:none">Parameter</span> | <span id="zh">类型</span><span id="en" style="display:none">Type</span> | <span id="zh">必填</span><span id="en" style="display:none">Required</span> | <span id="zh">说明</span><span id="en" style="display:none">Description</span> |
|---|---|---|---|
| `url` | string | ✅ | <span id="zh">目标 API 的完整 URL</span><span id="en" style="display:none">Full API URL</span> |
| `method` | string | ❌ | <span id="zh">HTTP 方法，默认 GET</span><span id="en" style="display:none">HTTP method, default GET</span> |
| `body` | string | ❌ | <span id="zh">请求体，JSON 字符串</span><span id="en" style="display:none">Request body as JSON string</span> |
| `headers` | string | ❌ | <span id="zh">自定义请求头，JSON 字符串</span><span id="en" style="display:none">Custom headers as JSON string</span> |

<span id="zh">返回：API 响应 + `_meta.rateLimit` 用量快照。如果被限流拒绝，返回 `RATE_LIMIT_EXCEEDED` 错误，包含 `retryAfterSeconds` 建议等待时间。</span>
<span id="en" style="display:none">Returns: API response + `_meta.rateLimit` usage snapshot. If rate limited, returns `RATE_LIMIT_EXCEEDED` with suggested wait time in seconds.</span>

### `get_rate_limit_status`

<span id="zh">查询当前速率限制使用情况。返回已用/剩余调用次数和 Token 数，以及建议。不包含队列计数器，避免用户焦虑。</span>
<span id="en" style="display:none">Query current rate limit usage. Returns used/remaining calls and tokens, plus a recommendation. No queue counter — avoids user anxiety.</span>

### `set_rate_limit`

<span id="zh">动态调整限流参数（对应滑块调节，实时生效无需重启）。</span>
<span id="en" style="display:none">Dynamically adjust rate limit parameters (corresponds to slider control, takes effect instantly without restart).</span>

| <span id="zh">参数</span><span id="en" style="display:none">Parameter</span> | <span id="zh">类型</span><span id="en" style="display:none">Type</span> | <span id="zh">说明</span><span id="en" style="display:none">Description</span> |
|---|---|---|
| `callsPerMinute` | number | <span id="zh">每分钟最大调用次数 (RPM)</span><span id="en" style="display:none">Max calls per minute (RPM)</span> |
| `tokensPerMinute` | number | <span id="zh">每分钟最大 Token 数 (TPM)</span><span id="en" style="display:none">Max tokens per minute (TPM)</span> |

---

## <span id="zh">安装</span><span id="en" style="display:none">Installation</span>

### <span id="zh">MCP 客户端（如 ZCode）</span><span id="en" style="display:none">MCP Client (e.g. ZCode)</span>

```bash
npm install 429-throttle-mcp
```

<span id="zh">在 MCP 配置中添加：</span>
<span id="en" style="display:none">Add to your MCP config:</span>

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

### <span id="zh">DeepSeek Harness</span><span id="en" style="display:none">DeepSeek Harness</span>

```bash
npm install dsh-throttle
```

<span id="zh">在 DSH 配置中添加：</span>
<span id="en" style="display:none">Add to your DSH config:</span>

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

## <span id="zh">工作流示例</span><span id="en" style="display:none">Workflow Example</span>

<span id="zh">模型在做品牌 PPT 搜索任务时：</span>
<span id="en" style="display:none">When a model works on a brand PPT search task:</span>

1. <span id="zh">调用 `get_rate_limit_status` → 确认额度充足</span><span id="en" style="display:none">Call `get_rate_limit_status` → confirm quota available</span>
2. <span id="zh">调用 `call_api` → 搜索品牌关键词</span><span id="en" style="display:none">Call `call_api` → search brand keywords</span>
3. <span id="zh">如果被拒绝 → 等待 `retryAfterSeconds` 后重试</span><span id="en" style="display:none">If rejected → wait `retryAfterSeconds` then retry</span>
4. <span id="zh">重复 2-3 直到收集完所有信息</span><span id="en" style="display:none">Repeat 2-3 until all info collected</span>
5. <span id="zh">调用 `set_rate_limit` → 收紧限流参数用于生成阶段</span><span id="en" style="display:none">Call `set_rate_limit` → tighten limits for generation phase</span>

---

## <span id="zh">限流算法</span><span id="en" style="display:none">Rate Limiting Algorithm</span>

<span id="zh">**滑动窗口 + 令牌桶**（Sliding Window + Token Bucket）：维护 60 秒滑动窗口，每次调用记录时间戳和 token 消耗。窗口外的旧记录自动清理。超过限制时计算最早记录的剩余等待时间。</span>
<span id="en" style="display:none">**Sliding Window + Token Bucket**: maintains a 60-second window, recording timestamp and token consumption for each call. Old records outside the window are auto-pruned. When the limit is exceeded, the remaining wait time is calculated from the oldest record.</span>

<span id="zh">**并发安全**：`tryConsume()` 是同步函数，在 Node.js 单线程事件循环中天然串行化，不会出现竞态条件。</span>
<span id="en" style="display:none">**Concurrency-safe**: `tryConsume()` is synchronous and atomic within Node.js's single-threaded event loop — no race conditions.</span>

---

## <span id="zh">为什么用这个而不是 prompt 里写"慢点调用"？</span><span id="en" style="display:none">Why this instead of "slow down" in prompt?</span>

| <span id="zh">方式</span><span id="en" style="display:none">Approach</span> | <span id="zh">效果</span><span id="en" style="display:none">Effect</span> |
|---|---|
| <span id="zh">Prompt 写"每 2 秒调用一次"</span><span id="en" style="display:none">Prompt says "call every 2 seconds"</span> | <span id="zh">❌ 模型没有秒表，不会遵守，burst 出去照样 429</span><span id="en" style="display:none">❌ Model has no stopwatch, won't comply, bursts still cause 429</span> |
| <span id="zh">外部脚本限流</span><span id="en" style="display:none">External rate-limit script</span> | <span id="zh">❌ 需要额外进程，模型不感知，出错难调试</span><span id="en" style="display:none">❌ Extra process, model unaware, hard to debug</span> |
| <span id="zh">**MCP 限流代理（本项目）**</span><span id="en" style="display:none">**MCP Rate-Limit Proxy (this project)**</span> | <span id="zh">✅ 模型无感，透明把关，结构化错误 + 等待建议</span><span id="en" style="display:none">✅ Model-transparent, structured errors + wait hints</span> |

---

## <span id="zh">SEO 关键词</span><span id="en" style="display:none">SEO Keywords</span>

429报错, anti 429, MCP限流, 大模型每分钟调用限制, 免费大模型速率限制, Agent批量调用触发429, MCP排队调用, RPM, TPM, rate limiter mcp, quota guard, mcp server, mcp proxy, throttle, llm api quota, cop, HTTP 429, Too Many Requests, rate limiting, token bucket, sliding window, API proxy, LLM rate limit, AI API throttle, concurrent rate limit, 30 calls per minute

---

## <span id="zh">License</span><span id="en" style="display:none">License</span>

MIT

---

<script>
function switchLang(lang) {
  const zh = document.getElementById('zh');
  const en = document.getElementById('en');
  const tabZh = document.getElementById('tab-zh');
  const tabEn = document.getElementById('tab-en');

  if (lang === 'zh') {
    zh.style.display = 'block';
    en.style.display = 'none';
    tabZh.style.background = '#fff';
    tabEn.style.background = '#f0f0f0';
  } else {
    zh.style.display = 'none';
    en.style.display = 'block';
    tabEn.style.background = '#fff';
    tabZh.style.background = '#f0f0f0';
  }
}

// 默认显示中文 / Default to Chinese
switchLang('zh');
</script>