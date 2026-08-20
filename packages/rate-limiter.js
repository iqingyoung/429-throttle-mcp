/**
 * rate-limiter.js — 核心限流逻辑
 * ==============================
 * 滑动窗口 + 令牌桶算法，纯 JS，零依赖。
 * 被 MCP Server 和 DSH Plugin 共同引用，不修改。
 *
 * 线程安全说明：
 *   Node.js 单线程事件循环，tryConsume() 是同步函数，
 *   多次并发调用在事件循环中天然串行化，不会出现竞态。
 */

class RateLimiter {
  /**
   * @param {number} maxCalls    每分钟最大调用次数
   * @param {number} maxTokens   每分钟最大 Token 数（请求体 + 响应体）
   */
  constructor(maxCalls, maxTokens) {
    this.maxCalls = maxCalls;
    this.maxTokens = maxTokens;
    this.windowMs = 60_000; // 60 秒滑动窗口

    /** @type {number[]} 每次调用的时间戳 */
    this.callTimestamps = [];
    /** @type {number[]} 每次调用消耗的 token 数（与 callTimestamps 等长） */
    this.tokenUsage = [];

    this.stats = {
      totalCalls: 0,
      totalTokens: 0,
      rejectedCalls: 0,
      startTime: Date.now(),
    };
  }

  /**
   * 尝试消费一次调用额度。
   * 此方法同步、原子 — 在单线程事件循环中不会被中断。
   *
   * @param {number} tokens 本次请求预估消耗的 token 数
   * @returns {{allowed: boolean, retryAfterMs?: number, reason?: string, current?: object}}
   */
  tryConsume(tokens) {
    const now = Date.now();
    this._prune(now);

    // --- 检查调用次数 ---
    if (this.callTimestamps.length >= this.maxCalls) {
      const oldest = this.callTimestamps[0];
      const retryAfterMs = Math.max(0, oldest + this.windowMs - now);
      this.stats.rejectedCalls++;
      return {
        allowed: false,
        retryAfterMs,
        reason: `已达每分钟调用上限 ${this.maxCalls} 次`,
        current: this._currentUsage(),
      };
    }

    // --- 检查 token 用量 ---
    const currentTokens = this._sumTokens();
    if (currentTokens + tokens > this.maxTokens) {
      // 找到 token 消耗最早的记录，计算需要等多久才能腾出额度
      const oldestIdx = this._earliestTokenIndex();
      const retryAfterMs =
        oldestIdx >= 0
          ? Math.max(0, this.callTimestamps[oldestIdx] + this.windowMs - now)
          : 0;
      this.stats.rejectedCalls++;
      return {
        allowed: false,
        retryAfterMs,
        reason: `已达每分钟 Token 上限 ${this.maxTokens}`,
        current: this._currentUsage(),
      };
    }

    // --- 通过：记录本次调用 ---
    this.callTimestamps.push(now);
    this.tokenUsage.push(tokens);
    this.stats.totalCalls++;
    this.stats.totalTokens += tokens;

    return { allowed: true };
  }

  /**
   * 记录响应体消耗的 token（在收到响应后追加）。
   * @param {number} tokens
   */
  consumeResponseTokens(tokens) {
    if (this.tokenUsage.length === 0) return;
    this.tokenUsage[this.tokenUsage.length - 1] += tokens;
    this.stats.totalTokens += tokens;
  }

  /** 清理滑动窗口外的旧记录 */
  _prune(now) {
    const cutoff = now - this.windowMs;
    while (this.callTimestamps.length && this.callTimestamps[0] < cutoff) {
      this.callTimestamps.shift();
      this.tokenUsage.shift();
    }
  }

  /** 当前窗口内 token 总和 */
  _sumTokens() {
    let sum = 0;
    for (const t of this.tokenUsage) sum += t;
    return sum;
  }

  /** 返回 token 消耗最早的记录索引（用于计算等待时间） */
  _earliestTokenIndex() {
    if (this.tokenUsage.length === 0) return -1;
    // tokenUsage 与 callTimestamps 同索引一一对应
    // 最早的 token 记录就是数组最左侧的
    return 0;
  }

  /** 当前用量快照（不含队列计数器，避免用户焦虑） */
  _currentUsage() {
    return {
      calls: {
        used: this.callTimestamps.length,
        max: this.maxCalls,
        remaining: Math.max(0, this.maxCalls - this.callTimestamps.length),
      },
      tokens: {
        used: this._sumTokens(),
        max: this.maxTokens,
        remaining: Math.max(0, this.maxTokens - this._sumTokens()),
      },
    };
  }

  /**
   * 获取公开快照（供 get_rate_limit_status 工具返回）。
   * @returns {object}
   */
  snapshot() {
    const now = Date.now();
    this._prune(now);
    const usage = this._currentUsage();

    let recommendation;
    if (usage.calls.remaining <= 3) {
      recommendation = "⚠️ 调用额度紧张，建议放慢节奏";
    } else if (usage.tokens.remaining < this.maxTokens * 0.1) {
      recommendation = "⚠️ Token 额度紧张，建议减小单次请求体";
    } else {
      recommendation = "✅ 额度充足";
    }

    return {
      rateLimit: usage,
      limits: {
        maxCallsPerMinute: this.maxCalls,
        maxTokensPerMinute: this.maxTokens,
      },
      windowMs: this.windowMs,
      stats: {
        totalCalls: this.stats.totalCalls,
        totalTokens: this.stats.totalTokens,
        rejectedCalls: this.stats.rejectedCalls,
        uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
      },
      recommendation,
    };
  }

  /**
   * 动态调整限流参数（对应 set_rate_limit 工具 / 滑块调节）。
   * @param {number} maxCalls
   * @param {number} maxTokens
   */
  updateLimits(maxCalls, maxTokens) {
    this.maxCalls = maxCalls;
    this.maxTokens = maxTokens;
  }
}

/**
 * 粗略 token 估算（MVP 版本）。
 * 中文字符每个约 1.5 token，英文单词每个约 0.75 token。
 * 生产环境建议替换为对应模型的精确 tokenizer。
 *
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherWords = text
    .replace(/[\u4e00-\u9fa5]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.ceil(chineseChars * 1.5 + otherWords * 0.75);
}

module.exports = { RateLimiter, estimateTokens };