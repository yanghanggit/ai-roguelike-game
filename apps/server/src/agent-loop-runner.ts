/**
 * Agent 多步循环执行层。
 *
 * 负责单体循环、批量并发循环与 runAgentLoops 对 state.log 的落盘。
 * 使用 DeepSeekClient tool calling 驱动推理：query_status / strike 两个工具。
 * done 语义改由 finish_reason === "stop" 隐式表达。
 */

import assert from "node:assert";
import type { GameState } from "@roguelike/shared";
import { GameAgent } from "./game-agent.js";
import { DeepSeekClient } from "./ai/deepseek-client.js";
import { logger } from "./logger.js";
import { AgentTask } from "./agent-task.js";

const log = logger.child({ module: "AgentLoopRunner" });

// ─── Agent loop ───────────────────────────────────────────────────────────────

/**
 * 对单个 agent 执行受控多步推理循环（tool calling 版本）。
 *
 * 循环规则：
 * - finish_reason === "tool_calls"：分发工具调用，结果写入 context，继续推理。
 * - finish_reason === "stop"：本回合按兵不动（隐式 done），结束循环。
 * - 调用 strike 工具：经 {@link TOOL_HANDLERS} 分发，由 {@link handleStrikeTool} 写入 state.log，立即结束本回合。
 * - 超过 {@link AGENT_LOOP_MAX_ROUNDS} 轮次：安全退出，视为 done。
 *
 * @param agent - 参与本轮推理的 agent，context 会在循环内持续追加。
 * @param taskPrompt - 本回合触发推理的任务文本（第一步 prompt）。
 * @param state - 当前游戏状态，供工具查询与日志写入使用。
 */
async function agentLoop(agent: GameAgent, task: AgentTask, state: GameState): Promise<void> {
  let round = 0;

  while (round < task.maxRounds) {
    round++;

    // 第一轮注入任务 prompt，后续轮次用 continuation 模式（context 里已有 tool 结果）
    const prompt = round === 1 ? task.prompt : "";

    const client = new DeepSeekClient({
      name: agent.name,
      prompt,
      context: agent.context,
      tools: task.tools,
    });

    await client.chat();

    const responseContent = client.responseContent;
    const toolCalls = client.toolCalls;
    const finishReason = client.finishReason;

    // 将 AI 回复存入 context（有 tool_calls 时一并携带，供后续轮次 context 完整）
    if (toolCalls.length > 0) {
      agent.addAIMessage(responseContent, { tool_calls: toolCalls });
    } else {
      agent.addAIMessage(responseContent);
    }

    // finish_reason === "stop"：LLM 自然结束，视为 done
    if (finishReason === "stop") {
      return;
    }

    if (finishReason !== "tool_calls") {
      log.warn({ name: agent.name, finishReason }, "agentLoop: unexpected finish_reason");
      return;
    }

    // 分发工具调用
    for (const call of toolCalls) {
      let args: Record<string, string> = {};
      try {
        args = JSON.parse(call.function.arguments) as Record<string, string>;
      } catch {
        log.warn({ name: agent.name, call }, "agentLoop: failed to parse tool arguments");
        agent.addToolMessage(call.id, "参数解析失败，请检查工具调用格式。");
        continue;
      }

      const handler = task.handlers[call.function.name];
      const { message, endTurn } = handler
        ? handler(args, agent, state)
        : { message: `未知工具：${call.function.name}` };
      agent.addToolMessage(call.id, message);
      if (endTurn) return;
    }
  }

  log.warn({ name: agent.name, rounds: task.maxRounds }, "agentLoop: max rounds reached");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * 对给定的 agent 列表执行一轮并发推理，结果追加至 `state.log`。
 *
 * @param agents - 本回合参与推理的 agent 列表，通常由 {@link getActiveAgents} 生成。
 * @param task - 本回合的推理任务配置（含提示词与工具集）。
 * @param state - 当前游戏状态，供工具查询与日志写入使用。
 */
export async function runAgentLoops(
  agents: GameAgent[],
  task: AgentTask,
  state: GameState,
): Promise<void> {
  assert(agents.length > 0, "runAgentLoops: agents list must not be empty");

  // 并发执行所有 agent 的推理循环，等待全部完成后再继续游戏流程（如保存状态、打印日志等）
  await Promise.all(agents.map((agent) => agentLoop(agent, task, state)));
}
