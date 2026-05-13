/**
 * Agent 多步循环执行层。
 *
 * 负责单体循环、批量并发循环与 runAgentLoops 对 state.log 的落盘。
 */

import type { GameState, LogEntry } from "@roguelike/shared";
import { GameAgent } from "./ai/game-agent.js";
import { DeepSeekClient } from "./ai/deepseek-client.js";
import { extractLabel } from "./mock-monsters.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "AgentLoopRunner" });

/** 输出中包含此标记表示怪物想探查环境（GET 类），最多允许 {@link AGENT_LOOP_MAX_PROBES} 次。 */
const MARKER_PROBE = "[PROBE]";
/** 输出中包含此标记表示怪物正式出手（POST 类），本回合立即结束。 */
const MARKER_STRIKE = "[STRIKE]";
/** 输出中包含此标记表示怪物本回合按兵不动。 */
const MARKER_DONE = "[DONE]";
/** 单回合允许的最大 PROBE 次数；超出后强制 STRIKE/DONE。 */
const AGENT_LOOP_MAX_PROBES = 2;

/**
 * 探查行动的占位处理（待实现真实查询逻辑）。
 * @returns 注入 agent 上下文的探查结果字符串。
 */
function mockHandleProbe(_agentName: string, _output: string): string {
  return "【探查结果】（待实现）：周围一片静寂，感知不到明显威胁。";
}

/**
 * 出手行动的占位处理（待实现真实计算逻辑）。
 * @returns 注入 agent 上下文的行动结果通知字符串。
 */
function mockHandleStrike(_agentName: string, _output: string): string {
  return "【行动结果】（待实现）：你的行动已被记录，等待下一回合。";
}

/**
 * 对单个 agent 执行受控多步推理循环。
 *
 * 循环规则：
 * - 输出含 `[PROBE]`：执行探查，获取环境信息后继续推理；每回合最多 {@link AGENT_LOOP_MAX_PROBES} 次。
 * - 输出含 `[STRIKE]`：正式出手，系统通知结果后本回合结束。
 * - 输出含 `[DONE]`：本回合按兵不动，直接结束。
 * - 达到 PROBE 上限后注入强制提示，要求模型选择 STRIKE 或 DONE。
 * - 兜底：LLM 未输出任何标记时直接返回原始输出并结束。
 *
 * @param agent - 参与本轮推理的 agent，`context` 会在循环内持续追加。
 * @param task - 本回合触发推理的任务文本（第一步 prompt）。
 * @returns STRIKE 时返回原始 LLM 输出供写入日志；DONE 或兜底时返回空字符串或原始输出。
 */
async function agentLoop(agent: GameAgent, task: string): Promise<string> {
  let probeCount = 0;
  let currentPrompt = task;

  while (true) {
    const client = new DeepSeekClient({
      name: agent.name,
      prompt: currentPrompt,
      context: agent.context,
    });
    await client.chat();
    const response = client.responseContent;

    agent.addHumanMessage(currentPrompt);
    agent.addAIMessage(response);

    if (response.includes(MARKER_STRIKE)) {
      const notification = mockHandleStrike(agent.name, response);
      agent.addHumanMessage(notification);
      return response;
    }

    if (response.includes(MARKER_DONE)) {
      return "";
    }

    if (response.includes(MARKER_PROBE)) {
      probeCount += 1;
      const probeResult = mockHandleProbe(agent.name, response);
      agent.addHumanMessage(probeResult);
      if (probeCount >= AGENT_LOOP_MAX_PROBES) {
        currentPrompt =
          "你已累计探查 2 次，本回合必须做出行动：使用 [STRIKE] 正式出手，或使用 [DONE] 按兵不动。";
      } else {
        currentPrompt = "请继续思考并决定下一步行动。";
      }
      continue;
    }

    // 兜底：LLM 未输出任何约定标记
    log.warn(
      { name: agent.name, response },
      "agentLoop: no marker found in output, treating as done",
    );
    return response;
  }
}

/**
 * 并发对多个 agent 执行受控多步推理循环，每个 agent 独立跑完自己的循环。
 *
 * @param agents - 参与本轮推理的 agent 列表，顺序与 `tasks` 对应。
 * @param tasks - 各 agent 本回合的任务描述文本，顺序与 `agents` 对应。
 * @returns 与 `agents` 顺序一致的行动描述数组；DONE 或失败时对应项为空字符串。
 */
async function agentLoopBatch(agents: GameAgent[], tasks: string[]): Promise<string[]> {
  if (agents.length !== tasks.length) {
    throw new Error(
      `agentLoopBatch: agents(${agents.length}) 与 tasks(${tasks.length}) 长度不一致`,
    );
  }
  if (agents.length === 0) return [];
  return Promise.all(agents.map((agent, i) => agentLoop(agent, tasks[i]!)));
}

/**
 * 对 `state` 中所有已激活的 agent 执行一轮并发推理，结果追加至 `state.log`。
 *
 * @param state - 当前游戏状态，`activatedTurns` 决定哪些 agent 参与本轮推理。
 * @param task - 本回合触发推理的任务描述，注入给所有参与推理的 agent。
 */
export async function runAgentLoops(state: GameState, task: string): Promise<void> {
  const agentList = Object.keys(state.activatedTurns)
    .filter((name) => state.activatedTurns[name]! < state.turn)
    .map((name) => state.agents[name])
    .filter((a) => a !== undefined)
    .map((a) => a as unknown as GameAgent);

  if (agentList.length === 0) {
    log.debug({ turn: state.turn }, "runAgentLoops: no agents to run");
    return;
  }

  const actions = await agentLoopBatch(
    agentList,
    agentList.map(() => task),
  );

  const entries = actions
    .map((content, i) =>
      content.length > 0 ? `${extractLabel(agentList[i]!.name)}：${content}` : "",
    )
    .filter((a) => a.length > 0);

  if (entries.length > 0) {
    const newEntries: LogEntry[] = entries.map((message) => ({ turn: state.turn, message }));
    state.log = [...state.log, ...newEntries];
  }
}
