/**
 * Agent 推理任务配置。
 *
 * `AgentTask` 封装单次回合推理所需的提示词、工具集与循环上限，
 * 由调用方构建后传入 `runAgentLoops`，不含任何推理逻辑。
 *
 * 设计原则：所有字段均为必填，无隐式默认值；构造时严格断言，快速暴露调用方错误。
 */

import assert from "node:assert";
import type { GameState } from "@roguelike/shared";
import type { ToolDefinition } from "./ai/deepseek-client.js";
import type { GameAgent } from "./game-agent.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** 工具处理器的返回值。message 注入 context；endTurn 为 true 时循环立即结束本回合。 */
export type ToolHandlerResult = { message: string; endTurn?: boolean };

/** 工具处理器签名。callId 由分发层持有，handler 不感知。 */
export type ToolHandler = (
  args: Record<string, string>,
  agent: GameAgent,
  state: GameState,
) => ToolHandlerResult;

/**
 * 工具配置：将 LLM 工具定义与本地处理器配对，结构上保证对齐。
 * definition 传给 LLM 供其决策调用；handler 在本地执行并返回结果。
 */
export interface AgentTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** 单回合允许的最大推理轮次（安全上限，防止无限循环）。调用方必须显式传入此值或自定义值。 */
export const AGENT_LOOP_MAX_ROUNDS = 6;

// ─── Task ─────────────────────────────────────────────────────────────────────

/** 所有字段均为必填，不提供任何默认值。 */
export interface AgentTaskOptions {
  prompt: string;
  tools: AgentTool[];
  maxRounds: number;
}

/**
 * 封装单次回合推理所需的配置：提示词、工具集与循环上限。
 *
 * 构造时进行严格断言，任何配置错误均立即抛出而非静默降级：
 * - prompt 非空
 * - maxRounds 为整数且 > 1
 * - tools 非空，工具名唯一且每个名称非空
 * - 每个工具均配有 handler 函数
 */
export class AgentTask {
  readonly prompt: string;
  readonly tools: ToolDefinition[];
  readonly maxRounds: number;
  readonly handlers: Record<string, ToolHandler>;

  constructor(options: AgentTaskOptions) {
    const { prompt, tools, maxRounds } = options;

    assert(prompt.trim().length > 0, "AgentTask: prompt must be a non-empty string");
    assert(
      Number.isInteger(maxRounds) && maxRounds > 1,
      `AgentTask: maxRounds must be an integer > 1, got ${maxRounds}`,
    );
    assert(tools.length > 0, "AgentTask: tools list must not be empty");

    const names = tools.map((t) => t.definition.function.name);
    assert(
      names.every((n) => n.trim().length > 0),
      "AgentTask: every tool definition must have a non-empty name",
    );
    const uniqueNames = new Set(names);
    assert(
      uniqueNames.size === names.length,
      `AgentTask: duplicate tool names detected: ${names.filter((n, i) => names.indexOf(n) !== i).join(", ")}`,
    );
    assert(
      tools.every((t) => typeof t.handler === "function"),
      "AgentTask: every tool must have a handler function",
    );

    this.prompt = prompt;
    this.maxRounds = maxRounds;
    this.tools = tools.map((t) => t.definition);
    this.handlers = Object.fromEntries(tools.map((t) => [t.definition.function.name, t.handler]));

    // 构造后二次确认：派生出的工具数与 handler 数须完全对齐
    assert(
      Object.keys(this.handlers).length === this.tools.length,
      "AgentTask: internal error — tools and handlers count mismatch after construction",
    );
  }
}
