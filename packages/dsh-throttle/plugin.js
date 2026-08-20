/**
 * dsh-throttle — DeepSeek Harness Plugin 适配层
 * ==============================================
 * 基于 DeepSeek Harness Plugin API，将 rate-limiter.js 包装为 DSH 工具。
 * 与 429-throttle-mcp 共享同一个 rate-limiter.js 核心逻辑。
 *
 * 配置来源：DSH config（而非环境变量）
 * 工具注册：通过 dsh-manifest.json 声明
 */

import { RateLimiter, estimateTokens } from "../rate-limiter.js";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// 配置读取 — 从 dsh config 或 dsh-manifest.json
// ============================================================
function loadDshConfig() {
  // 尝试读取 dsh-manifest.json
  const manifestPath = join(__dirname, "..", "dsh-manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      return {
        maxCalls: manifest.rateLimit?.maxCalls || 30,
        maxTokens: manifest.rateLimit?.maxTokens || 750000,
      };
    } catch {
      // fall through to env
    }
  }

  // 回退到环境变量
  return {
    maxCalls: parseInt(process.env.MAX_CALLS || "30", 10),
    maxTokens: parseInt(process.env.MAX_TOKENS || "750000", 10),
  };
}

const dshConfig = loadDshConfig();
const limiter = new RateLimiter(dshConfig.maxCalls, dshConfig.maxTokens);

// ============================================================
// DSH Plugin 定义
// ============================================================
/**
 * DSH Plugin 接口约定：
 * - name: 插件名称
 * - version: 版本号
 * - tools: 工具列表，每个工具包含 name / description / parameters / handler
 * - handlers: 可选的生命周期钩子
 */
const dshThrottlePlugin = {
  name: "dsh-throttle",
  version: "1.0.0",
  description:
    "速率限制代理 — 通过此插件调用外部 API，自动控制每分钟调用次数和 Token 用量，不再被 429 拒绝",

  tools: [
    {
      name: "call_api",
      description: `通过限流代理发送 HTTP 请求。所有外部 API 调用必须经过此工具。

参数：
- url（必填）：目标 API 的完整 URL
- method（可选）：HTTP 方法，默认 GET
- body（可选）：请求体，JSON 字符串
- headers（可选）：自定义请求头，JSON 字符串

返回：API 响应内容 + 速率限制用量快照。
如果被限流拒绝，返回 RATE_LIMIT_EXCEEDED 错误，包含建议等待时间（秒）。`,

      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "目标 API 的完整 URL" },
          method: { type: "string", description: "HTTP 方法", default: "GET" },
          body: { type: "string", description: "请求体，JSON 字符串" },
          headers: { type: "string", description: "自定义请求头，JSON 字符串" },
        },
        required: ["url"],
      },

      async handler({ url, method = "GET", body, headers }) {
        const reqTokens =
          estimateTokens(body || "") + estimateTokens(url);
        const check = limiter.tryConsume(reqTokens);

        if (!check.allowed) {
          const waitSec = Math.ceil(check.retryAfterMs / 1000);
          return {
            error: "RATE_LIMIT_EXCEEDED",
            reason: check.reason,
            retryAfterSeconds: waitSec,
            currentUsage: check.current,
            suggestion: `请等待 ${waitSec} 秒后重试。期间不要发起新的调用。`,
          };
        }

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

          const respTokens = estimateTokens(responseText);
          limiter.consumeResponseTokens(respTokens);

          const snap = limiter.snapshot();
          return {
            status: resp.status,
            data: responseText.slice(0, 10000),
            _meta: {
              rateLimit: snap.rateLimit,
              hint: `已用 ${snap.rateLimit.calls.used}/${snap.rateLimit.calls.max} 次调用，${snap.rateLimit.tokens.used}/${snap.rateLimit.tokens.max} token。${snap.recommendation}`,
            },
          };
        } catch (err) {
          return {
            error: "REQUEST_FAILED",
            message: err.message,
            url,
          };
        }
      },
    },

    {
      name: "get_rate_limit_status",
      description: `查询当前速率限制使用情况。

返回：已用/剩余调用次数和 Token 数，以及建议。
注意：不包含队列计数器，避免用户焦虑。`,

      parameters: { type: "object", properties: {} },

      async handler() {
        return limiter.snapshot();
      },
    },

    {
      name: "set_rate_limit",
      description: `动态调整速率限制参数（实时生效无需重启）。

参数：
- callsPerMinute（可选）：每分钟最大调用次数
- tokensPerMinute（可选）：每分钟最大 Token 数`,

      parameters: {
        type: "object",
        properties: {
          callsPerMinute: { type: "number", description: "每分钟最大调用次数" },
          tokensPerMinute: { type: "number", description: "每分钟最大 Token 数" },
        },
      },

      async handler({ callsPerMinute, tokensPerMinute }) {
        const newCalls = callsPerMinute || dshConfig.maxCalls;
        const newTokens = tokensPerMinute || dshConfig.maxTokens;
        limiter.updateLimits(newCalls, newTokens);
        const snap = limiter.snapshot();
        return {
          updated: true,
          newLimits: {
            maxCallsPerMinute: newCalls,
            maxTokensPerMinute: newTokens,
          },
          currentUsage: snap.rateLimit,
        };
      },
    },
  ],
};

export default dshThrottlePlugin;