/**
 * throttle.cjs — call_api / get_rate_limit_status / set_rate_limit 的业务实现（CJS）
 * 移植自 429-throttle-mcp/packages/dsh-throttle/plugin.js，并补充 URL scheme 安全校验。
 *
 * 安全说明（已审查）：
 *  - 仅允许 http:// 与 https:// 两种 scheme，拒绝 file:/data:/javascript:/ftp: 等，
 *    避免被诱导读取本机文件或将请求转为非 HTTP 协议。
 *  - 不做目标主机白/黑名单（保留上游“通用 API 代理”用途）；如需限制内网，请在部署侧把控。
 */

const { RateLimiter, estimateTokens } = require("./rate-limiter.cjs");

function loadConfig() {
  const maxCalls = parseInt(process.env.MAX_CALLS || "30", 10);
  const maxTokens = parseInt(process.env.MAX_TOKENS || "750000", 10);
  return { maxCalls, maxTokens };
}

const cfg = loadConfig();
const limiter = new RateLimiter(cfg.maxCalls, cfg.maxTokens);

/** 仅放行 http/https，返回标准化错误对象或 null */
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

async function callApi({ url, method = "GET", body, headers }) {
  const blocked = checkUrl(url);
  if (blocked) return blocked;

  const reqTokens = estimateTokens(body || "") + estimateTokens(url);
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

    const t0 = Date.now();
    const resp = await fetch(url, fetchOptions);
    const responseText = await resp.text();
    limiter.recordDuration(Date.now() - t0);

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
    return { error: "REQUEST_FAILED", message: err.message, url };
  }
}

function getStatus() {
  return limiter.snapshot();
}

function setLimit({ callsPerMinute, tokensPerMinute } = {}) {
  const newCalls = callsPerMinute || cfg.maxCalls;
  const newTokens = tokensPerMinute || cfg.maxTokens;
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
}

function beginTask({ name } = {}) {
  return limiter.beginTask(name);
}

function endTask({ taskId, concurrency } = {}) {
  return limiter.endTask(taskId, concurrency || 1);
}

module.exports = { callApi, getStatus, setLimit, beginTask, endTask, limiter };
