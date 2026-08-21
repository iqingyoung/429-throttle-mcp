/**
 * rate-limiter.cjs — 核心限流逻辑（CJS 版，供 DSH 原生插件复用）
 * 直接移植自 429-throttle-mcp/packages/rate-limiter.js（已审查：零依赖、无副作用）。
 * 滑动窗口 + 令牌桶算法。
 */

class RateLimiter {
  constructor(maxCalls, maxTokens) {
    this.maxCalls = maxCalls;
    this.maxTokens = maxTokens;
    this.windowMs = 60_000;

    this.callTimestamps = [];
    this.tokenUsage = [];

    this.stats = {
      totalCalls: 0,
      totalTokens: 0,
      rejectedCalls: 0,
      totalDurationMs: 0,
      startTime: Date.now(),
    };
    this.latencySamples = [];
    this.tasks = new Map();
    this._taskSeq = 0;
  }

  tryConsume(tokens) {
    const now = Date.now();
    this._prune(now);

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

    const currentTokens = this._sumTokens();
    if (currentTokens + tokens > this.maxTokens) {
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

    this.callTimestamps.push(now);
    this.tokenUsage.push(tokens);
    this.stats.totalCalls++;
    this.stats.totalTokens += tokens;

    return { allowed: true };
  }

  consumeResponseTokens(tokens) {
    if (this.tokenUsage.length === 0) return;
    this.tokenUsage[this.tokenUsage.length - 1] += tokens;
    this.stats.totalTokens += tokens;
  }

  recordDuration(ms) {
    if (typeof ms === "number" && ms >= 0) {
      this.stats.totalDurationMs += ms;
      this.latencySamples.push(ms);
      if (this.latencySamples.length > 50) this.latencySamples.shift();
    }
  }

  get avgLatencyMs() {
    if (this.latencySamples.length === 0) return 0;
    const sum = this.latencySamples.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.latencySamples.length);
  }

  _statsSnapshot() {
    return {
      totalCalls: this.stats.totalCalls,
      totalTokens: this.stats.totalTokens,
      rejectedCalls: this.stats.rejectedCalls,
      totalDurationMs: this.stats.totalDurationMs,
    };
  }

  beginTask(name) {
    this._taskSeq++;
    const taskId = "task-" + this._taskSeq;
    this.tasks.set(taskId, {
      id: taskId,
      name: name || "",
      startedAt: Date.now(),
      snap: this._statsSnapshot(),
    });
    return { taskId, startedAt: this.tasks.get(taskId).startedAt };
  }

  endTask(taskId, concurrency = 1) {
    const task = this.tasks.get(taskId);
    if (!task) return { error: "TASK_NOT_FOUND", taskId };
    this.tasks.delete(taskId);

    const end = this._statsSnapshot();
    const start = task.snap;
    const callsDelta = end.totalCalls - start.totalCalls;
    const tokensDelta = end.totalTokens - start.totalTokens;
    const rejectedDelta = end.rejectedCalls - start.rejectedCalls;
    const apiTimeMs = end.totalDurationMs - start.totalDurationMs;
    const wallClockMs = Date.now() - task.startedAt;

    const avgLat = this.avgLatencyMs;
    const estimatedSerialMs =
      callsDelta > 0 && avgLat > 0 ? callsDelta * avgLat : 0;

    let timeoutRound = null;
    if (callsDelta > 0) {
      const R = Math.max(1, concurrency);
      const callsRound = Math.ceil(this.maxCalls / R);
      const tokensPerRound = (tokensDelta / callsDelta) * R;
      const tokensRound =
        tokensPerRound > 0 ? Math.ceil(this.maxTokens / tokensPerRound) : Infinity;
      timeoutRound = Math.min(callsRound, tokensRound);
    }

    return {
      taskId,
      name: task.name,
      wallClockMs,
      apiTimeMs,
      calls: callsDelta,
      tokens: tokensDelta,
      rejectedCalls: rejectedDelta,
      estimatedSerialDurationMs: estimatedSerialMs,
      concurrency,
      timeoutRound:
        timeoutRound === null
          ? "未基于此任务估算"
          : Number.isFinite(timeoutRound)
          ? timeoutRound
          : "未达上限",
      note:
        rejectedDelta > 0
          ? `本次有 ${rejectedDelta} 次被本代理限流（RATE_LIMIT_EXCEEDED），非上游 429。`
          : "本任务未被本代理限流；若仍见 429，来自上游平台配额。",
    };
  }

  _prune(now) {
    const cutoff = now - this.windowMs;
    while (this.callTimestamps.length && this.callTimestamps[0] < cutoff) {
      this.callTimestamps.shift();
      this.tokenUsage.shift();
    }
  }

  _sumTokens() {
    let sum = 0;
    for (const t of this.tokenUsage) sum += t;
    return sum;
  }

  _earliestTokenIndex() {
    if (this.tokenUsage.length === 0) return -1;
    return 0;
  }

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
        totalDurationMs: this.stats.totalDurationMs,
        avgLatencyMs: this.avgLatencyMs,
        uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
      },
      recommendation,
    };
  }

  updateLimits(maxCalls, maxTokens) {
    this.maxCalls = maxCalls;
    this.maxTokens = maxTokens;
  }
}

function estimateTokens(text) {
  if (!text) return 0;
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const otherWords = text
    .replace(/[一-鿿]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.ceil(chineseChars * 1.5 + otherWords * 0.75);
}

module.exports = { RateLimiter, estimateTokens };
