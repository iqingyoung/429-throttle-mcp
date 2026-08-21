/**
 * plugin.js — 原生 DeepSeek Harness (DSH) 插件入口
 * 合同：export const name / export const inject / export function apply(ctx)
 * 工具通过 ctx.tools.register(defineTool({...})) 注册（来自 @deepseek-ai/dsh-tools）。
 *
 * v1.1 已重写为合规形态（原版本导出 { tools:[{handler}] }，与 DSH 真实契约不符）。
 * 逻辑与 lib/ 下的 rate-limiter.cjs / throttle.cjs 配套使用。
 */
import { createRequire } from "module";
import { defineTool } from "@deepseek-ai/dsh-tools";

const require = createRequire(import.meta.url);
const { callApi, getStatus, setLimit, beginTask, endTask } = require("./lib/throttle.cjs");

export const name = "dsh-throttle";
export const inject = ["tools"];

const OUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: { text: { type: "string" } },
};
const renderText = (_args, value) => [{ type: "text", text: value.text }];

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: "call_api",
      description:
        "通过限流代理发送 HTTP 请求（DSH 原生插件）。所有外部 API 调用建议经此工具，自动按 RPM/TPM 限流，避免 429。仅允许 http/https。",
      parameters: {
        url: { type: "string", required: true, description: "目标 API 的完整 URL" },
        method: { type: "string", default: "GET", description: "HTTP 方法 GET/POST/PUT" },
        body: { type: "string", description: "请求体，JSON 字符串（POST/PUT 时使用）" },
        headers: { type: "string", description: "自定义请求头，JSON 字符串" },
      },
      output: {
        schema: OUT_SCHEMA,
        render: renderText,
      },
      async execute(args) {
        const result = await callApi(args);
        return { text: "```json\n" + JSON.stringify(result, null, 2) + "\n```" };
      },
    })
  );

  ctx.tools.register(
    defineTool({
      name: "get_rate_limit_status",
      description: "查询当前速率限制使用情况（已用/剩余调用次数与 Token 数、建议、统计）。",
      parameters: {},
      output: {
        schema: OUT_SCHEMA,
        render: renderText,
      },
      async execute() {
        return { text: "```json\n" + JSON.stringify(getStatus(), null, 2) + "\n```" };
      },
    })
  );

  ctx.tools.register(
    defineTool({
      name: "set_rate_limit",
      description: "动态调整限流参数（实时生效，无需重启）。",
      parameters: {
        callsPerMinute: { type: "number", description: "每分钟最大调用次数 (RPM)" },
        tokensPerMinute: { type: "number", description: "每分钟最大 Token 数 (TPM)" },
      },
      output: {
        schema: OUT_SCHEMA,
        render: renderText,
      },
      async execute(args) {
        return { text: "```json\n" + JSON.stringify(setLimit(args), null, 2) + "\n```" };
      },
    })
  );

  ctx.tools.register(
    defineTool({
      name: "begin_task",
      description: "开启一个限流观测任务区间，返回 taskId。长任务开始前调用，结束后用 end_task 取复盘报告。",
      parameters: {
        name: { type: "string", description: "任务名（可选）" },
      },
      output: { schema: OUT_SCHEMA, render: renderText },
      async execute(args) {
        return { text: "```json\n" + JSON.stringify(beginTask(args), null, 2) + "\n```" };
      },
    })
  );

  ctx.tools.register(
    defineTool({
      name: "end_task",
      description: "结束 begin_task 开启的区间，返回复盘：实际用时、调用次数、被限流次数、原定串行用时、第几轮并发会触顶。",
      parameters: {
        taskId: { type: "string", required: true, description: "begin_task 返回的 taskId" },
        concurrency: { type: "number", description: "假设每轮并发调用数，默认 1（串行）" },
      },
      output: { schema: OUT_SCHEMA, render: renderText },
      async execute(args) {
        return { text: "```json\n" + JSON.stringify(endTask(args), null, 2) + "\n```" };
      },
    })
  );
}
