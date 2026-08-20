#!/usr/bin/env node
/**
 * 429-throttle-mcp — MCP Server 适配层
 * =====================================
 * 基于 @modelcontextprotocol/sdk，将 rate-limiter.js 包装为 MCP 工具。
 * 模型通过此 MCP 的 call_api 工具发请求，限流在中间透明执行。
 *
 * 环境变量：
 *   MAX_CALLS    — 每分钟最大调用次数（默认 30）
 *   MAX_TOKENS   — 每分钟最大 Token 数（默认 750000）
 */

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { RateLimiter, estimateTokens } from "../../rate-limiter.js";

// ============================================================
// 配置
// ============================================================
const MAX_CALLS = parseInt(process.env.MAX_CALLS || "30", 10);
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "750000", 10);

// ============================================================
// MCP Server
// ============================================================
const server = new Server(
  {
    name: "429-throttle-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const limiter = new RateLimiter(MAX_CALLS, MAX_TOKENS);

// ------------------------------------------------------------
// 工具 1：call_api — 限流代理 HTTP 请求
// ------------------------------------------------------------
server.tool(
  "call_api",
  `通过限流代理发送 HTTP 请求。所有外部 API 调用必须经过此工具。

参数：
- url（必填）：目标 API 的完整 URL
- method（可选）：HTTP 方法，默认 GET
- body（可选）：请求体，JSON 字符串
- headers（可选）：自定义请求头，JSON 字符串

返回：API 响应内容 + 速率限制用量快照。
如果被限流拒绝，返回 RATE_LIMIT_EXCEEDED 错误，包含建议等待时间（秒）。`,
  {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "目标 API 的完整 URL",
      },
      method: {
        type: "string",
        description: "HTTP 方法，如 GET / POST / PUT",
        default: "GET",
      },
      body: {
        type: "string",
        description: "请求体，JSON 字符串（POST/PUT 时使用）",
      },
      headers: {
        type: "string",
        description: "自定义请求头，JSON 字符串",
      },
    },
    required: ["url"],
  },
  async ({ url, method = "GET", body, headers }) => {
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

      const resp = await fetch(url, fetchOptions);
      const responseText = await resp.text();

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
              {
                error: "REQUEST_FAILED",
                message: err.message,
                url,
              },
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
  `查询当前速率限制使用情况。

返回：已用/剩余调用次数和 Token 数，以及建议。
建议值：✅ 额度充足 / ⚠️ 紧张 / ⚠️ Token 额度紧张。

注意：不包含队列计数器，避免用户焦虑。`,
  {
    type: "object",
    properties: {},
  },
  async () => {
    const snap = limiter.snapshot();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(snap, null, 2),
        },
      ],
    };
  }
);

// ------------------------------------------------------------
// 工具 3：set_rate_limit — 动态调整限流参数
// ------------------------------------------------------------
server.tool(
  "set_rate_limit",
  `动态调整速率限制参数（对应滑块调节，实时生效无需重启）。

参数：
- callsPerMinute（可选）：每分钟最大调用次数
- tokensPerMinute（可选）：每分钟最大 Token 数

示例：set_rate_limit(callsPerMinute=60, tokensPerMinute=1000000)`,
  {
    type: "object",
    properties: {
      callsPerMinute: {
        type: "number",
        description: "每分钟最大调用次数",
      },
      tokensPerMinute: {
        type: "number",
        description: "每分钟最大 Token 数",
      },
    },
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

// ============================================================
// 启动
// ============================================================
const transport = new StdioServerTransport();
await server.connect(transport);

console.error(`[429-throttle-mcp] 已启动`);
console.error(`  每分钟调用上限: ${MAX_CALLS} 次`);
console.error(`  每分钟 Token 上限: ${MAX_TOKENS}`);
console.error(`  工具: call_api / get_rate_limit_status / set_rate_limit`);