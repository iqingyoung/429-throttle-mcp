/**
 * throttle.cjs — call_api / get_rate_limit_status / set_rate_limit 的业务实现（CJS）
 * 移植自 429-throttle-mcp/packages/dsh-throttle/plugin.js，并补充 URL scheme 安全校验。
 *
 * 安全说明（已审查）：
 *  - 仅允许 http:// 与 https:// 两种 scheme，拒绝 file:/data:/javascript:/ftp: 等，
 *    避免被诱导读取本机文件或将请求转为非 HTTP 协议。
 *  - 不做目标主机白/黑名单（保留上游"通用 API 代理"用途，含内网/127.0.0.1 反代场景）；如需限制，请在部署侧把控。
 *
 * v1.2.0 变更：
 *  - set_rate_limit：非法值（非正数/非数字）直接拒绝；超过安全上限时返回 needsConfirmation，
 *    需携带 confirm=true 二次确认才生效。
 *  - call_api：30 秒超时 + 响应体最多读取 200KB 后截断；错误仅返回标准化错误码，
 *    不再回显原始报错文本（避免内部网络细节进入模型上下文）。
 */

const { RateLimiter, estimateTokens } = require("./rate-limiter.cjs");

/** 超过此值的限流参数需 confirm=true 二次确认（可能触发上游平台限流） */
const SAFE_CALLS_MAX = 120;
const SAFE_TOKENS_MAX = 2_000_000;

/** 单次请求超时与响应体读取上限 */
const FETCH_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 200_000;

function loadConfig() {
  const maxCalls = parseInt(process.env.MAX_CALLS || "30", 10);
  const maxTokens = parseInt(process.env.MAX_TOKENS || "750000", 10);
  return { maxCalls, maxTokens };
}

const cfg = loadConfig();
const limiter = new RateLimiter(cfg.maxCalls, cfg.maxTokens);

/** 标准化错误码，不透传原始 message（避免泄露内网拓扑到模型上下文） */
function errCode(err) {
  if (!err) return "UNKNOWN";
  if (err.name === "TimeoutError" || err.name === "AbortError") return "TIMEOUT";
  return (err.cause && err.cause.code) || err.code || "UNKNOWN";
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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    };
    if (body && method !== "GET") {
      fetchOptions.body = body;
    }

    const t0 = Date.now();
    const resp = await fetch(url, fetchOptions);
    const responseText = await readCapped(resp);
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
    return { error: "REQUEST_FAILED", code: errCode(err), url };
  }
}

function getStatus() {
  return limiter.snapshot();
}

/**
 * 动态调整限流参数。
 * 非法值直接拒绝；超大值返回 needsConfirmation，调用方需携带 confirm=true 再调一次。
 */
function setLimit({ callsPerMinute, tokensPerMinute, confirm } = {}) {
  // 1. 非法值直接拒绝
  for (const [k, v] of [
    ["callsPerMinute", callsPerMinute],
    ["tokensPerMinute", tokensPerMinute],
  ]) {
    if (v === undefined || v === null) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) {
      return { error: "INVALID_VALUE", message: `${k} 必须为正数，收到 ${v}` };
    }
  }

  // 2. 超大值需二次确认
  const warnings = [];
  if (callsPerMinute !== undefined && callsPerMinute > SAFE_CALLS_MAX) {
    warnings.push(`callsPerMinute=${callsPerMinute} 超过安全上限 ${SAFE_CALLS_MAX} 次/分钟`);
  }
  if (tokensPerMinute !== undefined && tokensPerMinute > SAFE_TOKENS_MAX) {
    warnings.push(`tokensPerMinute=${tokensPerMinute} 超过安全上限 ${SAFE_TOKENS_MAX} token/分钟`);
  }
  if (warnings.length > 0 && !confirm) {
    return {
      needsConfirmation: true,
      warning: warnings,
      message:
        "超大限流值可能触发上游平台的真实 429 限制。如确认要设置，请携带 confirm=true 再次调用本工具。",
    };
  }

  // 3. 生效
  const newCalls = callsPerMinute ?? cfg.maxCalls;
  const newTokens = tokensPerMinute ?? cfg.maxTokens;
  limiter.updateLimits(newCalls, newTokens);
  const snap = limiter.snapshot();
  return {
    updated: true,
    confirmedWithoutPrompt: warnings.length > 0,
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
