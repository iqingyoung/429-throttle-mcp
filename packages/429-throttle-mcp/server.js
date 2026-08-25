#!/usr/bin/env node
/**
 * 429-throttle-mcp — MCP Server 适配层
 * =====================================
 * 基于 @modelcontextprotocol/sdk 的 McpServer（高层 API），将 rate-limiter.js 包装为 MCP 工具。
 * 模型通过此 MCP 的 call_api 工具发请求，限流在中间透明执行。
 *
 * v1.2.0 变更：
 *  - @modelcontextprotocol/sdk 升级至 ^1.16.0，工具改用 registerTool 并补全四个
 *    annotations（readOnlyHint/destructiveHint/idempotentHint/openWorldHint，OpenAI 目录硬性要求）。
 *  - set_rate_limit：非法值（非正数/非数字）直接拒绝；超过安全上限时返回 needsConfirmation，
 *    需携带 confirm=true 二次确认才生效（防止误设超大值触发上游平台真实 429）。
 *  - call_api：30 秒超时（AbortSignal.timeout）+ 响应体最多读取 200KB 后截断，
 *    防止慢速端点挂起任务、超大响应撑爆内存。
 *  - 错误处理：仅返回标准化错误码（TIMEOUT/ECONNREFUSED 等），不再回显原始报错文本，
 *    避免内部网络细节进入模型上下文。
 *
 * 环境变量：
 *   MAX_CALLS    — 每分钟最大调用次数（默认 30）
 *   MAX_TOKENS   — 每分钟最大 Token 数（默认 750000）
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RateLimiter, estimateTokens } from "./rate-limiter.js";

// ============================================================
// 配置
// ============================================================
const MAX_CALLS = parseInt(process.env.MAX_CALLS || "30", 10);
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "750000", 10);

/** 超过此值的限流参数需 confirm=true 二次确认（可能触发上游平台限流） */
const SAFE_CALLS_MAX = 120;
const SAFE_TOKENS_MAX = 2_000_000;

/** 单次请求超时与响应体读取上限 */
const FETCH_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 200_000;

// ============================================================
// 工具函数
// ============================================================
const text = (obj) => ({
  content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
});

/** 标准化错误码，不透传原始 message（避免泄露内网拓扑到模型上下文） */
function errCode(err) {
  if (!err) return "UNKNOWN";
  if (err.name === "TimeoutError" || err.name === "AbortError") return "TIMEOUT";
  return err.cause?.code || err.code || "UNKNOWN";
}

/** 流式读取响应体，最多 MAX_RESPONSE_BYTES 字节后取消，内存占用恒定 */
async function readCapped(resp) {
  if (!resp.body) return (await resp.text()).slice(0, 10000);
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (received < MAX_RESPONSE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
    }
    if (received >= MAX_RESPONSE_BYTES) await reader.cancel();
  } catch {
    // 读流中断时用已收到的部分即可
  }
  return Buffer.concat(chunks).toString("utf8", 0, MAX_RESPONSE_BYTES);
}

// ============================================================
// MCP Server（高层 API）
// ============================================================
const server = new McpServer({
  name: "429-throttle-mcp",
  version: "1.2.0",
});

const limiter = new RateLimiter(MAX_CALLS, MAX_TOKENS);

/** 仅放行 http/https；返回错误对象或 null */
function checkUrl(url) {
  if (typeof url !== "string" || !url.trim()) {
    return { error: "INVALID_URL", message: "url 缺失或非法" };
  }
  let u;
  try {
    u = new URL(url);
  } catch {
    return { error: "INVALID_URL", message: "url 无法解析" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return {
      error: "SCHEME_NOT_ALLOWED",
      message: `仅允许 http/https，收到 ${u.protocol || "(空)"}`,
    };
  }
  return null;
}

// ------------------------------------------------------------
// 工具 1：call_api — 限流代理 HTTP 请求
// ------------------------------------------------------------
server.registerTool(
  "call_api",
  {
    description: `通过限流代理发送 HTTP 请求。所有外部 API 调用建议经此工具。
参数：url（必填）/ method（可选，默认 GET）/ body（可选，JSON 字符串）/ headers（可选，JSON 字符串）。
返回：API 响应内容 + 速率限制用量快照。被限流时返回 RATE_LIMIT_EXCEEDED 及建议等待秒数。
仅允许 http/https。请求 30 秒超时，响应最多返回前 10000 字符。`,
    inputSchema: {
      url: z.string().describe("目标 API 的完整 URL"),
      method: z.string().optional().default("GET").describe("HTTP 方法，如 GET / POST / PUT"),
      body: z.string().optional().describe("请求体，JSON 字符串（POST/PUT 时使用）"),
      headers: z.string().optional().describe("自定义请求头，JSON 字符串"),
    },
    annotations: {
      title: "Rate-limited API Call",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ url, method, body, headers }) => {
    const blocked = checkUrl(url);
    if (blocked) return text(blocked);

    // 1. 估算本次请求消耗的 token（请求体 + URL）
    const reqTokens = estimateTokens(body || "") + estimateTokens(url);
    const check = limiter.tryConsume(reqTokens);

    // 2. 限流拒绝 — 告知模型等待时间
    if (!check.allowed) {
      const waitSec = Math.ceil(check.retryAfterMs / 1000);
      return text({
        error: "RATE_LIMIT_EXCEEDED",
        reason: check.reason,
        retryAfterSeconds: waitSec,
        currentUsage: check.current,
        suggestion: `请等待 ${waitSec} 秒后重试。期间不要发起新的调用。`,
      });
    }

    // 3. 通过限流 — 实际发送请求（30s 超时 + 流式限量读取）
    try {
      const fetchOptions = {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(headers ? JSON.parse(headers) : {}),
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      };
      if (body && method !== "GET") {
        fetchOptions.body = body;
      }

      const t0 = Date.now();
      const resp = await fetch(url, fetchOptions);
      const responseText = await readCapped(resp);
      limiter.recordDuration(Date.now() - t0);

      // 4. 扣除响应 token
      const respTokens = estimateTokens(responseText);
      limiter.consumeResponseTokens(respTokens);

      // 5. 返回结果 + 用量提示
      const snap = limiter.snapshot();
      return text({
        status: resp.status,
        data: responseText.slice(0, 10000), // 截断过长响应
        _meta: {
          rateLimit: snap.rateLimit,
          hint: `已用 ${snap.rateLimit.calls.used}/${snap.rateLimit.calls.max} 次调用，${snap.rateLimit.tokens.used}/${snap.rateLimit.tokens.max} token。${snap.recommendation}`,
        },
      });
    } catch (err) {
      return text({ error: "REQUEST_FAILED", code: errCode(err), url });
    }
  }
);

// ------------------------------------------------------------
// 工具 2：get_rate_limit_status — 查询当前用量
// ------------------------------------------------------------
server.registerTool(
  "get_rate_limit_status",
  {
    description: "查询当前速率限制使用情况。返回已用/剩余调用次数和 Token 数、建议与统计。",
    inputSchema: {},
    annotations: {
      title: "Get Rate Limit Status",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => text(limiter.snapshot())
);

// ------------------------------------------------------------
// 工具 3：set_rate_limit — 动态调整限流参数
// ------------------------------------------------------------
server.registerTool(
  "set_rate_limit",
  {
    description: `动态调整速率限制参数（实时生效无需重启）。callsPerMinute / tokensPerMinute 可选。
注意：非正数会被拒绝；callsPerMinute > ${SAFE_CALLS_MAX} 或 tokensPerMinute > ${SAFE_TOKENS_MAX} 属于超大值，
可能触发上游平台真实限流，首次调用会返回 needsConfirmation，需带 confirm=true 再次调用确认。`,
    inputSchema: {
      callsPerMinute: z.number().optional().describe("每分钟最大调用次数"),
      tokensPerMinute: z.number().optional().describe("每分钟最大 Token 数"),
      confirm: z.boolean().optional().describe("设置超大值时的二次确认标记"),
    },
    annotations: {
      title: "Set Rate Limit",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ callsPerMinute, tokensPerMinute, confirm }) => {
    // 1. 非法值直接拒绝
    for (const [k, v] of [
      ["callsPerMinute", callsPerMinute],
      ["tokensPerMinute", tokensPerMinute],
    ]) {
      if (v === undefined) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        return text({
          error: "INVALID_VALUE",
          message: `${k} 必须为正数，收到 ${v}`,
        });
      }
    }

    // 2. 超大值需二次确认（可能触发上游平台真实 429）
    const warnings = [];
    if (callsPerMinute !== undefined && callsPerMinute > SAFE_CALLS_MAX) {
      warnings.push(`callsPerMinute=${callsPerMinute} 超过安全上限 ${SAFE_CALLS_MAX} 次/分钟`);
    }
    if (tokensPerMinute !== undefined && tokensPerMinute > SAFE_TOKENS_MAX) {
      warnings.push(`tokensPerMinute=${tokensPerMinute} 超过安全上限 ${SAFE_TOKENS_MAX} token/分钟`);
    }
    if (warnings.length > 0 && !confirm) {
      return text({
        needsConfirmation: true,
        warning: warnings,
        message: `超大限流值可能触发上游平台的真实 429 限制。如确认要设置，请携带 confirm=true 再次调用本工具。`,
      });
    }

    // 3. 生效
    const newCalls = callsPerMinute ?? MAX_CALLS;
    const newTokens = tokensPerMinute ?? MAX_TOKENS;
    limiter.updateLimits(newCalls, newTokens);
    const snap = limiter.snapshot();
    return text({
      updated: true,
      confirmedWithoutPrompt: warnings.length > 0,
      newLimits: {
        maxCallsPerMinute: newCalls,
        maxTokensPerMinute: newTokens,
      },
      currentUsage: snap.rateLimit,
    });
  }
);

// ------------------------------------------------------------
// 工具 4：begin_task — 开启任务计时区间（用于长任务复盘）
// ------------------------------------------------------------
server.registerTool(
  "begin_task",
  {
    description:
      "开始一个限流观测任务区间，返回 taskId。长任务开始前调用，结束后用 end_task 取复盘报告（用时/调用次数/原定用时/第几轮并发会超时）。",
    inputSchema: {
      name: z.string().optional().describe("任务名（可选，便于辨识）"),
    },
    annotations: {
      title: "Begin Task",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ name }) => text(limiter.beginTask(name))
);

// ------------------------------------------------------------
// 工具 5：end_task — 结束任务区间并返回复盘报告
// ------------------------------------------------------------
server.registerTool(
  "end_task",
  {
    description:
      "结束 begin_task 开启的区间，返回本次任务复盘：实际用时、调用次数、被限流次数、原定串行用时、以及按给定并发度第几轮会触顶。",
    inputSchema: {
      taskId: z.string().describe("begin_task 返回的 taskId"),
      concurrency: z.number().optional().default(1).describe("假设每轮并发调用数，默认 1（串行）"),
    },
    annotations: {
      title: "End Task",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ taskId, concurrency }) =>
    text(limiter.endTask(taskId, concurrency || 1))
);

// ============================================================
// 启动
// ============================================================
const transport = new StdioServerTransport();
await server.connect(transport);

console.error(`[429-throttle-mcp] 已启动`);
console.error(`  每分钟调用上限: ${MAX_CALLS} 次`);
console.error(`  每分钟 Token 上限: ${MAX_TOKENS}`);
console.error(`  工具: call_api / get_rate_limit_status / set_rate_limit / begin_task / end_task`);
