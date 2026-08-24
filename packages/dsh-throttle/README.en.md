# dsh-throttle

English | [中文](README.md)

> Stop getting rejected with HTTP 429 — a rate-limited MCP proxy plus an Agent operator skill. Models pace themselves automatically during long-running tasks; non-technical users open / tune / disable / diagnose / review with plain sentences.

---

## What is it

Many free LLM APIs (Grok, Gemini, Dots, etc.) only allow ~30 calls per minute. During long-running tasks (search + PPT generation, batch tool calls), models easily hit the rate limit and get rejected with HTTP 429.

`429-throttle-mcp` provides a **transparent rate-limiting layer**:

```
Model → call_api tool → Rate Limiter → Actual API Request → Response + Usage Snapshot
```

The model doesn't need to know about rate limits — it just calls `call_api` normally. The rate limiter operates transparently inside the MCP: if quota is available, the request goes through; if not, the model is told how long to wait before retrying.

**Who is it for**:
- **Developers / agent-framework users**: `npm i 429-throttle-mcp` (MCP) or `npm i dsh-throttle` (DSH) gives you a transparent throttle proxy;
- **Non-technical users**: pair it with the `rate-limit-operator` skill to open / tune / disable / review limits in plain sentences.

### v1.1 direction change (important)

v1.1 upgrades the project from a "developer-only throttle proxy" to a **control surface usable by non-technical users**, adding three capabilities:

1. **Agent operator skill `rate-limit-operator`** — opens / tunes / disables / diagnoses / reviews via plain language, handled by the agent. Users just say "open the throttle", "it's too slow", "still 429", "turn it off" — no RPM/TPM knowledge, no config-file editing.
2. **Task review `begin_task` / `end_task`** — call once at task start and once at task end to get: actual duration, call count, rejected count, estimated serial duration, and the "round at which it would hit the cap" given concurrency.
3. **Distinguishing the two kinds of 429** — proxy rejection (`rejectedCalls > 0`, fixable by tuning) vs upstream platform quota 429 (only fixable by checking platform docs), preventing blind limit-raise that makes things worse.

---

## Version & Changelog

Current version **v1.1.0** (npm bumped from 1.0.2). v1.1.0 changes:

- ✨ New tools: `begin_task` / `end_task` (long-task review)
- ✨ New stats: `totalDurationMs` / `avgLatencyMs` (in `get_rate_limit_status`)
- ✨ New operator skill `rate-limit-operator` (plain-language control)
- 🔒 Security: `call_api` now whitelists URL schemes (http/https only)
- 🔧 Compatibility: adapted to `@modelcontextprotocol/sdk` 1.30 (high-level `McpServer` + Zod raw shape)

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
│   │   └── rate-limiter.js
│   └── dsh-throttle/                # DSH Plugin package
│       ├── package.json
│       ├── plugin.js
│       └── rate-limiter.js
├── dsh-manifest.json
├── README.md
└── .env.example
```

| Package | Install | Use case |
|---------|---------|----------|
| `429-throttle-mcp` | `npm i 429-throttle-mcp` | MCP Server (ZCode / WorkBuddy & other MCP clients) |
| `dsh-throttle` | `npm i dsh-throttle` | DeepSeek Harness Plugin |

---

## Core Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAX_CALLS` | 30 | Max API calls per minute (RPM) |
| `MAX_TOKENS` | 750000 | Max tokens per minute (TPM), request + response |

Priority: dynamic `set_rate_limit` > env startup values. Dynamic changes apply instantly but **reset to env defaults after process restart**; use env for persistent limits.

---

## Exposed Tools (5 in v1.1)

### `call_api`

Send HTTP requests through the rate-limited proxy. **All external API calls must go through this tool** (otherwise the limiter has no data and reviews are empty).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | ✅ | Full API URL (http/https only) |
| `method` | string | ❌ | HTTP method, default GET |
| `body` | string | ❌ | Request body as JSON string |
| `headers` | string | ❌ | Custom headers as JSON string |

Returns: API response + `_meta.rateLimit` usage snapshot. If rate limited, returns `RATE_LIMIT_EXCEEDED` with `retryAfterSeconds` suggested wait time.

### `get_rate_limit_status`

Query current rate limit usage: used/remaining calls & tokens, `rejectedCalls` (proxy rejections), `totalDurationMs` (cumulative API time), `avgLatencyMs` (average latency) and a recommendation. **Check `rejectedCalls` to tell where the 429 comes from.**

### `set_rate_limit`

Dynamically adjust rate limit parameters (takes effect instantly, no restart).

| Parameter | Type | Description |
|-----------|------|-------------|
| `callsPerMinute` | number | Max calls per minute (RPM) |
| `tokensPerMinute` | number | Max tokens per minute (TPM) |

### `begin_task` (new in v1.1)

Start a rate-limit observation window and get a `taskId`. Call before long tasks.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Task name (optional) |

### `end_task` (new in v1.1)

Close the window and return the review report.

| Parameter | Type | Description |
|-----------|------|-------------|
| `taskId` | string | taskId from `begin_task` |
| `concurrency` | number | Assumed concurrent calls per round, default 1 (serial) |

Returned fields:

| Field | Meaning |
|-------|---------|
| `wallClockMs` / `apiTimeMs` | Task wall-clock time / pure API time |
| `calls` / `tokens` | Calls made / tokens consumed in this task |
| `rejectedCalls` | Proxy rejections (>0 = our limiter; =0 but still seeing 429 = upstream platform) |
| `estimatedSerialDurationMs` | Estimated serial duration (calls × avg latency) |
| `timeoutRound` | Round at which the cap would be hit at the given concurrency (whichever of the calls/tokens limit comes first; "未达上限"/"cap not reached" = not hit) |

---

## Installation

### MCP Client (ZCode / WorkBuddy, etc.)

```bash
npm install 429-throttle-mcp
```

Add to your MCP config (stdio):

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

**Option 1 (recommended): one-command DSH CLI mount**

```bash
dsh plugin --profile web add dsh-throttle
```

**Option 2: manual mount** — put the plugin into `profiles/<profile>/node_modules/@deepseek-ai/dsh-throttle/` and append an entry to the `- insert:` array in `cordis.patch.yml`:

```yaml
- id: dsh-throttle
  name: '@deepseek-ai/dsh-throttle'
  config: {}
```

---

## 🔍 Most important: how to confirm it is enabled and working after mounting

### MCP Client (WorkBuddy example)

**Step 1 — Enable**: find `429-throttle-mcp` in the connector management page and click **Trust** (required on first mount). If `disabled: true` in config, set it to `false` first.

**Step 2 — Confirm enabled** (any one of these means success):
- ✅ Connector page shows the server **connected**, tools 5/5
- ✅ The session tool list contains `429-throttle-mcp_call_api` / `get_rate_limit_status`, etc.
- ✅ Ask the model to call `get_rate_limit_status` — **a JSON response means the process is alive**

**Step 3 — CLI smoke test** (independent of client UI):

```bash
# Start from the server.js directory; a startup banner means OK
node server.js
```

Expected output: `已启动` + `每分钟调用上限: 30 次` + `工具: call_api / get_rate_limit_status / set_rate_limit / begin_task / end_task`.

**Troubleshooting**:
- Tools not visible → 90% of the time the **session wasn't refreshed**: open a new conversation and retry (MCP tools are loaded at session start).
- Changed `disabled` / env params → **restart the client** to apply.
- Only 3 tools, missing `begin_task`/`end_task` → you installed 1.0.x; upgrade to 1.1.0.

### DeepSeek Harness

1. Install the plugin into `profiles/<profile>/node_modules/@deepseek-ai/dsh-throttle/` and add the patch entry (see above).
2. **Restart the Harness**.
3. The tool list shows `call_api` / `get_rate_limit_status` / `set_rate_limit` / `begin_task` / `end_task` → enabled.
4. Smoke test: call `get_rate_limit_status`.

### Full end-to-end run (recommended, includes review)

```
1. begin_task({name:"demo"})                       → note the taskId
2. call_api({url:"https://example.com"})           → status 200 + _meta.rateLimit
3. end_task({taskId, concurrency:2})               → duration / calls / timeoutRound
4. get_rate_limit_status()                         → cumulative stats
```

---

## Agent Operator Skill (plain-language control, new in v1.1)

Install the `rate-limit-operator` skill into the agent's skill directory (e.g. WorkBuddy `~/.workbuddy/skills/rate-limit-operator/`), and the following plain phrases trigger the agent automatically:

| Phase | User phrase | Agent action |
|-------|-------------|--------------|
| Open | "open the throttle / is throttling on?" | Self-check → report current limits; if not enabled, prompt Trust / flip disabled / restart |
| Tune | "raise it / too slow / limited again / reset to default" | Check `rejectedCalls` first to see if our limiter caused it, then `set_rate_limit` up / down / reset |
| Disable | "turn it off / don't need it" | Set `disabled=true` and prompt restart, or guide closing in the panel |
| Diagnose | "still 429" | Check `rejectedCalls`: >0 = our limiter (tunable); =0 = upstream platform quota (give lookup paths, **never fabricate numbers**) |
| Review | long task finished | `begin_task` / `end_task` produce duration / calls / timeout-round report |

> Key insight: when the user says "still 429", **diagnose before acting**. Upstream platform 429 (free / starter plan quota) cannot be fixed by this proxy — blindly raising our limits hammers the provider harder and gets blocked faster.

---

## Workflow Example (with review)

When a model works on a brand PPT search task:

1. `begin_task({name:"PPT search"})` → note the taskId
2. `get_rate_limit_status` → confirm quota available
3. `call_api` → search brand keywords (if rejected → wait `retryAfterSeconds` and retry)
4. Repeat 2-3 until all info collected
5. `end_task({taskId, concurrency:3})` → review: duration / calls / timeout round
6. `set_rate_limit` → tighten or loosen limits based on the review

---

## Rate Limiting Algorithm

**Sliding Window + Token Bucket**: maintains a 60-second window, recording timestamp and token consumption for each call. Old records outside the window are auto-pruned. When the limit is exceeded, the remaining wait time is calculated from the oldest record.

**Concurrency-safe**: `tryConsume()` is synchronous and atomic within Node.js's single-threaded event loop — no race conditions.

---

## Why this instead of "slow down" in the prompt?

| Approach | Effect |
|----------|--------|
| Prompt says "call every 2 seconds" | ❌ Model has no stopwatch, won't comply, bursts still cause 429 |
| External rate-limit script | ❌ Extra process, model unaware, hard to debug |
| **MCP rate-limit proxy (this project)** | ✅ Model-transparent, structured errors + wait hints |
| **MCP proxy + operator skill** | ✅ Non-technical users open / tune / disable / review in plain language |

---

## Application scenario Keyword

429报错, anti 429, MCP限流, 大模型每分钟调用限制, 免费大模型速率限制, Agent批量调用触发429, MCP排队调用, RPM, TPM, rate limiter mcp, quota guard, mcp server, mcp proxy, throttle, llm api quota, cop, HTTP 429, Too Many Requests, rate limiting, token bucket, sliding window, API proxy, LLM rate limit, AI API throttle, concurrent rate limit, 30 calls per minute, MCP enable verification, MCP smoke test

---

## License

MIT
