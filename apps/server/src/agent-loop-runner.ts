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

const ACTION_QUERY = "query";
const ACTION_ACT = "act";
const ACTION_DONE = "done";

const QUERY_PLAYER_STATUS = "player_status";
const QUERY_NEARBY_MONSTERS = "nearby_monsters";

const ACT_STRIKE = "strike";

/** 单回合允许的最大 QUERY 次数；超出后强制 ACT/DONE。 */
const AGENT_LOOP_MAX_QUERIES = 2;
/** JSON 格式错误时，最多给予 1 次纠错机会。 */
const MAX_FORMAT_RETRIES = 1;

type QueryType = typeof QUERY_PLAYER_STATUS | typeof QUERY_NEARBY_MONSTERS;
type ActType = typeof ACT_STRIKE;

interface QueryDecision {
  actionType: typeof ACTION_QUERY;
  queryType: QueryType;
}

interface ActDecision {
  actionType: typeof ACTION_ACT;
  actType: ActType;
  summary?: string;
}

interface DoneDecision {
  actionType: typeof ACTION_DONE;
}

type AgentDecision = QueryDecision | ActDecision | DoneDecision;

/**
 * 将 LLM 输出解析为 JSON 决策。
 */
function parseAgentDecision(output: string): AgentDecision {
  const cleaned = output
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("invalid_json");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("invalid_shape");
  }

  const decision = parsed as Record<string, unknown>;
  const actionType = decision["actionType"];
  if (actionType === ACTION_QUERY) {
    const queryType = decision["queryType"];
    if (queryType === QUERY_PLAYER_STATUS || queryType === QUERY_NEARBY_MONSTERS) {
      return { actionType: ACTION_QUERY, queryType };
    }
    throw new Error("invalid_query_type");
  }

  if (actionType === ACTION_ACT) {
    const actType = decision["actType"];
    if (actType !== ACT_STRIKE) {
      throw new Error("invalid_act_type");
    }
    const summary = typeof decision["summary"] === "string" ? decision["summary"] : undefined;
    return { actionType: ACTION_ACT, actType, summary };
  }

  if (actionType === ACTION_DONE) {
    return { actionType: ACTION_DONE };
  }

  throw new Error("invalid_action_type");
}

/**
 * Query 的占位处理（第一版接入基础状态读取）。
 */
function handleQuery(agentName: string, queryType: QueryType, state: GameState): string {
  if (queryType === QUERY_PLAYER_STATUS) {
    return `【查询结果/player_status】玩家状态：HP ${state.player.hp}/${state.player.maxHp}，攻击 ${state.player.attack}，防御 ${state.player.defense}。`;
  }

  const others = Object.keys(state.activatedTurns)
    .filter((name) => name !== agentName)
    .map((name) => state.agents[name])
    .filter((a): a is GameAgent => a !== undefined)
    .map((a) => extractLabel(a.name));

  if (others.length === 0) {
    return "【查询结果/nearby_monsters】当前未发现其他已激活怪物。";
  }

  return `【查询结果/nearby_monsters】其他已激活怪物：${others.join("、")}。`;
}

/**
 * Act 的占位处理（第一版仅支持 strike）。
 */
function handleAct(decision: ActDecision): { notification: string; logMessage: string } {
  const logMessage =
    decision.summary && decision.summary.trim().length > 0
      ? decision.summary.trim()
      : "发动了攻击。";
  return {
    notification: "【行动结果/strike】你的出手已被系统记录，等待下一回合。",
    logMessage,
  };
}

/**
 * 对单个 agent 执行受控多步推理循环。
 *
 * 循环规则：
 * - 输出 JSON actionType=query：执行查询并继续推理；每回合最多 {@link AGENT_LOOP_MAX_QUERIES} 次。
 * - 输出 JSON actionType=act：执行动作，通知结果后本回合结束。
 * - 输出 JSON actionType=done：本回合按兵不动，直接结束。
 * - 达到 QUERY 上限后注入强制提示，要求模型选择 ACT 或 DONE。
 * - JSON 解析/校验失败时注入格式纠正提示，最多重试 1 次。
 *
 * @param agent - 参与本轮推理的 agent，`context` 会在循环内持续追加。
 * @param task - 本回合触发推理的任务文本（第一步 prompt）。
 * @param maxQueries - 单回合允许的最大 query 次数。
 * @returns ACT 时返回可写入日志的行动摘要；DONE 或兜底时返回空字符串。
 */
async function agentLoop(
  agent: GameAgent,
  task: string,
  state: GameState,
  maxQueries: number,
): Promise<string> {
  let queryCount = 0;
  let formatRetries = 0;
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

    let decision: AgentDecision;
    try {
      decision = parseAgentDecision(response);
    } catch {
      if (formatRetries >= MAX_FORMAT_RETRIES) {
        log.warn({ name: agent.name, response }, "agentLoop: invalid decision json after retry");
        return "";
      }

      formatRetries += 1;
      currentPrompt =
        "你上一步输出不符合协议。请仅输出单个 JSON 对象，不要附加解释文本。可用 actionType：query/act/done。";
      continue;
    }
    formatRetries = 0;

    if (decision.actionType === ACTION_DONE) {
      return "";
    }

    if (decision.actionType === ACTION_ACT) {
      const actResult = handleAct(decision);
      agent.addHumanMessage(actResult.notification);
      return actResult.logMessage;
    }

    if (queryCount >= maxQueries) {
      currentPrompt =
        `你已累计 query ${maxQueries} 次，本回合必须输出 JSON：actionType=act（actType=strike）或 actionType=done。`;
      continue;
    }

    queryCount += 1;
    const queryResult = handleQuery(agent.name, decision.queryType, state);
    agent.addHumanMessage(queryResult);

    if (queryCount >= maxQueries) {
      currentPrompt =
        `你已累计 query ${maxQueries} 次，本回合必须输出 JSON：actionType=act（actType=strike）或 actionType=done。`;
    } else {
      currentPrompt = "请基于查询结果继续决策，并仅输出一个 JSON 对象。";
    }
  }
}

/**
 * 对 `state` 中所有已激活的 agent 执行一轮并发推理，结果追加至 `state.log`。
 *
 * @param state - 当前游戏状态，`activatedTurns` 决定哪些 agent 参与本轮推理。
 * @param task - 本回合触发推理的任务描述，注入给所有参与推理的 agent。
 */
export async function runAgentLoops(state: GameState, task: string): Promise<void> {

  // 选择所有已激活且非本回合首次被激活的 agent 参与推理，确保新激活的 agent 从下一回合开始参与。
  const agentList = Object.keys(state.activatedTurns)
    .filter((name) => state.activatedTurns[name]! < state.turn)
    .map((name) => state.agents[name])
    .filter((a) => a !== undefined)
    .map((a) => a as unknown as GameAgent);

  // 无需推理的情况直接返回，避免不必要的日志记录和状态更新。
  if (agentList.length === 0) {
    log.debug({ turn: state.turn }, "runAgentLoops: no agents to run");
    return;
  }

  // 并发执行所有 agent 的推理循环，收集行动摘要。
  const actions = await Promise.all(
    agentList.map((agent) => agentLoop(agent, task, state, AGENT_LOOP_MAX_QUERIES)),
  );

  // 将所有行动摘要追加到 state.log 中，供玩家查看。
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
