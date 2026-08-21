#!/usr/bin/env node
/**
 * 429-throttle-mcp — MCP Server 适配层
 * =====================================
 * 基于 @modelcontextprotocol/sdk 的 McpServer（高层 API），将 rate-limiter.js 包装为 MCP 工具。
 * 模型通过此 MCP 的 call_api 工具发请求，限流在中间透明执行。
 *
 * 修复说明（相对上游）：
 *  - 上游用低层 `Server` + `server.tool()`，但 `.tool()` 仅存在于高层 `McpServer`，
 *    且 SDK 1.30 的 exports 不再提供无扩展名的 `@modelcontextprotocol/sdk/server/stdio`；
 *    工具入参改用 McpServer.tool 的 Zod raw shape（现代 SDK 要求）。
 *  - call_api 增加 URL scheme 白名单（仅 http/https），与 DSH 插件保持一致。
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

// ============================================================
// MCP Server（高层 API）
// ============================================================
const server = new McpServer({
  name: "429-throttle-mcp",
  version: "1.1.0",
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
server.tool(
  "call_api",
  `通过限流代理发送 HTTP 请求。所有外部 API 调用建议经此工具。
参数：url（必填）/ method（可选，默认 GET）/ body（可选，JSON 字符串）/ headers（可选，JSON 字符串）。
返回：API 响应内容 + 速率限制用量快照。被限流时返回 RATE_LIMIT_EXCEEDED 及建议等待秒数。
仅允许 http/https。`,
  {
    url: z.string().describe("目标 API 的完整 URL"),
    method: z.string().optional().default("GET").describe("HTTP 方法，如 GET / POST / PUT"),
    body: z.string().optional().describe("请求体，JSON 字符串（POST/PUT 时使用）"),
    headers: z.string().optional().describe("自定义请求头，JSON 字符串"),
  },
  async ({ url, method, body, headers }) => {
    const blocked = checkUrl(url);
    if (blocked) {
      return { content: [{ type: "text", text: JSON.stringify(blocked, null, 2) }] };
    }

    // 1. 估算本次请求消耗的 token（请求体 + URL）
    const reqTokens = estimateTokens(body || "") + estimateTokens(url);
    const check = limiter.tryConsume(reqTokens);

    // 2. 限流拒绝 — 告知模型等待时间
    if (!check.allowed) {
      const waitSec = Math.ceil(check.retryAfterMs / 1000);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "RATE_LIMIT_EXCEEDED",
                reason: check.reason,
                retryAfterSeconds: waitSec,
                currentUsage: check.current,
                suggestion: `请等待 ${waitSec} 秒后重试。期间不要发起新的调用。`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // 3. 通过限流 — 实际发送请求
    try {
      const fetchOptions = {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(headers ? JSON.parse(headers) : {}),
        },
      };
      if (body && method !== "GET") {
        fetchOptions.body = body;
      }

      const t0 = Date.now();
      const resp = await fetch(url, fetchOptions);
      const responseText = await resp.text();
      limiter.recordDuration(Date.now() - t0);

      // 4. 扣除响应 token
      const respTokens = estimateTokens(responseText);
      limiter.consumeResponseTokens(respTokens);

      // 5. 返回结果 + 用量提示
      const snap = limiter.snapshot();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: resp.status,
                data: responseText.slice(0, 10000), // 截断过长响应
                _meta: {
                  rateLimit: snap.rateLimit,
                  hint: `已用 ${snap.rateLimit.calls.used}/${snap.rateLimit.calls.max} 次调用，${snap.rateLimit.tokens.used}/${snap.rateLimit.tokens.max} token。${snap.recommendation}`,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { error: "REQUEST_FAILED", message: err.message, url },
              null,
              2
            ),
          },
        ],
      };
    }
  }
);

// ------------------------------------------------------------
// 工具 2：get_rate_limit_status — 查询当前用量
// ------------------------------------------------------------
server.tool(
  "get_rate_limit_status",
  "查询当前速率限制使用情况。返回已用/剩余调用次数和 Token 数、建议与统计。",
  {},
  async () => {
    const snap = limiter.snapshot();
    return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
  }
);

// ------------------------------------------------------------
// 工具 3：set_rate_limit — 动态调整限流参数
// ------------------------------------------------------------
server.tool(
  "set_rate_limit",
  "动态调整速率限制参数（实时生效无需重启）。callsPerMinute / tokensPerMinute 可选。",
  {
    callsPerMinute: z.number().optional().describe("每分钟最大调用次数"),
    tokensPerMinute: z.number().optional().describe("每分钟最大 Token 数"),
  },
  async ({ callsPerMinute, tokensPerMinute }) => {
    const newCalls = callsPerMinute || MAX_CALLS;
    const newTokens = tokensPerMinute || MAX_TOKENS;
    limiter.updateLimits(newCalls, newTokens);
    const snap = limiter.snapshot();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              updated: true,
              newLimits: {
                maxCallsPerMinute: newCalls,
                maxTokensPerMinute: newTokens,
              },
              currentUsage: snap.rateLimit,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ------------------------------------------------------------
// 工具 4：begin_task — 开启任务计时区间（用于长任务复盘）
// ------------------------------------------------------------
server.tool(
  "begin_task",
  "开始一个限流观测任务区间，返回 taskId。长任务开始前调用，结束后用 end_task 取复盘报告（用时/调用次数/原定用时/第几轮并发会超时）。",
  { name: z.string().optional().describe("任务名（可选，便于辨识）") },
  async ({ name }) => {
    const r = limiter.beginTask(name);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  }
);

// ------------------------------------------------------------
// 工具 5：end_task — 结束任务区间并返回复盘报告
// ------------------------------------------------------------
server.tool(
  "end_task",
  "结束 begin_task 开启的区间，返回本次任务复盘：实际用时、调用次数、被限流次数、原定串行用时、以及按给定并发度第几轮会触顶。",
  {
    taskId: z.string().describe("begin_task 返回的 taskId"),
    concurrency: z.number().optional().default(1).describe("假设每轮并发调用数，默认 1（串行）"),
  },
  async ({ taskId, concurrency }) => {
    const r = limiter.endTask(taskId, concurrency || 1);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  }
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
