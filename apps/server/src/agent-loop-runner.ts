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
const QUERY_TYPES = [QUERY_PLAYER_STATUS, QUERY_NEARBY_MONSTERS] as const;

const ACT_STRIKE = "strike";
const ACT_TYPES = [ACT_STRIKE] as const;

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
 * 构建注入到每回合任务末尾的行动规则说明段落。
 *
 * 说明包含：可用 actionType 列表、各类型的合法子字段、输出示例以及 query 次数上限提示。
 *
 * @param maxQueries - 本回合允许的最大 query 次数，用于在规则文本中动态填充限制说明。
 * @returns 以 Markdown 格式组织的行动规则字符串。
 */
function buildActionRulesPrompt(maxQueries: number): string {
  return [
    "## 行动规则",
    "你每一步都必须只输出一个 JSON 对象，不得附加任何额外文本、解释或 markdown 代码块。",
    "",
    "可用 actionType：",
    "- query：获取信息，不直接改变世界状态。",
    `  - queryType 仅允许：${QUERY_TYPES.join("、")}`,
    "- act：执行会改变局势的动作。",
    `  - 第一版仅允许：actType = \"${ACT_STRIKE}\"`,
    "  - 可选：summary（一句简短动作描述，供日志记录）",
    "- done：本回合结束，不采取行动。",
    "",
    "输出示例：",
    `- {\"actionType\":\"${ACTION_QUERY}\",\"queryType\":\"${QUERY_PLAYER_STATUS}\"}`,
    `- {\"actionType\":\"${ACTION_QUERY}\",\"queryType\":\"${QUERY_NEARBY_MONSTERS}\"}`,
    `- {\"actionType\":\"${ACTION_ACT}\",\"actType\":\"${ACT_STRIKE}\",\"summary\":\"我挥剑直劈玩家。\"}`,
    `- {\"actionType\":\"${ACTION_DONE}\"}`,
    "",
    `限制：每回合最多使用 ${maxQueries} 次 query。若已使用 ${maxQueries} 次，下一步必须输出 act 或 done。`,
  ].join("\n");
}

/**
 * 构建完整的回合任务提示词，供 `agentLoop` 作为第一步 prompt 使用。
 *
 * 由两部分拼接而成：本回合事件摘要 + 行动规则说明（{@link buildActionRulesPrompt}）。
 *
 * @param eventSummary - 描述本回合触发事件的一句话文本（如「玩家揭开了新格子」）。
 * @param maxQueries - 本回合允许的最大 query 次数，默认为 {@link AGENT_LOOP_MAX_QUERIES}。
 * @returns 完整的任务提示词字符串。
 */
export function buildTurnTaskPrompt(
  eventSummary: string,
  maxQueries: number = AGENT_LOOP_MAX_QUERIES,
): string {
  return [`本回合事件：${eventSummary}`, "", buildActionRulesPrompt(maxQueries)].join("\n");
}

/**
 * 构建 JSON 格式错误时的纠正提示词。
 *
 * 在模型输出无法解析为合法 `AgentDecision` 时注入，告知模型上一步输出不符合协议，
 * 并重新附加完整行动规则，引导其输出正确格式的 JSON。
 *
 * @param maxQueries - 本回合允许的最大 query 次数，透传至行动规则段落。
 * @returns 格式纠正提示词字符串。
 */
function buildFormatErrorPrompt(maxQueries: number): string {
  return [
    "你上一步输出不符合协议。",
    "请仅输出单个 JSON 对象，不要附加解释文本。",
    "",
    buildActionRulesPrompt(maxQueries),
  ].join("\n");
}

/**
 * 构建 query 次数达到上限时的强制决策提示词。
 *
 * 当本回合 query 累计次数达到 `maxQueries` 时注入，要求模型在下一步只能选择 act 或 done，
 * 不得再发起新的 query。
 *
 * @param maxQueries - 本回合已达到的 query 上限值，用于在提示中明确告知模型当前计数。
 * @returns 强制决策提示词字符串。
 */
function buildQueryLimitPrompt(maxQueries: number): string {
  return `你已累计 query ${maxQueries} 次，本回合必须输出 JSON：actionType=act（actType=${ACT_STRIKE}）或 actionType=done。`;
}

/**
 * 将 LLM 原始输出解析并校验为类型安全的 `AgentDecision`。
 *
 * 解析步骤：
 * 1. 去除首尾空白及可能存在的 markdown 代码块包裹（\`\`\`json / \`\`\`）。
 * 2. JSON.parse 反序列化，失败时抛出 `"invalid_json"`。
 * 3. 按 `actionType` 分支校验子字段合法性：
 *    - query：`queryType` 必须属于 {@link QUERY_TYPES}，否则抛出 `"invalid_query_type"`。
 *    - act：`actType` 必须属于 {@link ACT_TYPES}，否则抛出 `"invalid_act_type"`。
 *    - done：无需额外字段。
 *    - 其他：抛出 `"invalid_action_type"`。
 *
 * @param output - LLM 返回的原始文本内容。
 * @returns 经过类型收窄的 `AgentDecision` 对象。
 * @throws 校验失败时抛出包含错误码字符串的 `Error`。
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
    if (typeof queryType === "string") {
      const normalizedQueryType = queryType as QueryType;
      if (QUERY_TYPES.includes(normalizedQueryType)) {
        return { actionType: ACTION_QUERY, queryType: normalizedQueryType };
      }
    }
    throw new Error("invalid_query_type");
  }

  if (actionType === ACTION_ACT) {
    const actType = decision["actType"];
    if (typeof actType === "string") {
      const normalizedActType = actType as ActType;
      if (ACT_TYPES.includes(normalizedActType)) {
        const summary = typeof decision["summary"] === "string" ? decision["summary"] : undefined;
        return { actionType: ACTION_ACT, actType: normalizedActType, summary };
      }
    }
    throw new Error("invalid_act_type");
  }

  if (actionType === ACTION_DONE) {
    return { actionType: ACTION_DONE };
  }

  throw new Error("invalid_action_type");
}

/**
 * 执行一次 query 决策，返回可直接注入 agent 上下文的查询结果文本。
 *
 * 支持的 queryType：
 * - `player_status`：读取玩家当前 HP、攻击、防御数值。
 * - `nearby_monsters`：列出其他已激活怪物的显示名称（排除自身）。
 *
 * @param agentName - 发起查询的 agent 名称，用于过滤 `nearby_monsters` 时排除自身。
 * @param queryType - 本次查询的类型，必须属于 {@link QUERY_TYPES}。
 * @param state - 当前游戏状态，提供玩家信息与已激活怪物列表。
 * @returns 格式化的查询结果字符串，以「【查询结果/...】」前缀标识。
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
 * 执行一次 act 决策，返回面向 agent 的通知文本与面向玩家日志的行动摘要。
 *
 * 第一版仅支持 `actType=strike`：
 * - `notification` 注入 agent 上下文，告知出手已被记录。
 * - `logMessage` 写入 `state.log`，优先使用 `decision.summary`，缺省时回退为通用描述。
 *
 * @param decision - 已校验的 act 类型决策对象，含可选 `summary` 字段。
 * @returns 包含 `notification`（agent 侧反馈）与 `logMessage`（日志侧摘要）的对象。
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
 * @param taskPrompt - 本回合触发推理的任务文本（第一步 prompt）。
 * @param maxQueries - 单回合允许的最大 query 次数。
 * @returns ACT 时返回可写入日志的行动摘要；DONE 或兜底时返回空字符串。
 */
async function agentLoop(
  agent: GameAgent,
  taskPrompt: string,
  state: GameState,
  maxQueries: number,
): Promise<string> {
  let queryCount = 0;
  let formatRetries = 0;
  let currentPrompt = taskPrompt;

  while (true) {
    // 调用 LLM 获取决策
    const client = new DeepSeekClient({
      name: agent.name,
      prompt: currentPrompt,
      context: agent.context,
    });

    // 注意：agent.context 会在循环内持续追加，包含系统提示、历史人机消息和本轮决策过程中的查询结果等，供模型参考。
    await client.chat();

    // 解析 LLM 输出为结构化决策，包含 actionType、queryType/actType 等字段。
    const response = client.responseContent;

    // 将当前 prompt、LLM 响应追加到 agent 上下文中，供后续决策参考（但不写入 state.log）。
    agent.addHumanMessage(currentPrompt);
    agent.addAIMessage(response);

    let decision: AgentDecision;
    try {
      // 解析决策 JSON，验证结构与字段合法性，确保符合协议要求。
      decision = parseAgentDecision(response);
    } catch {
      // 解析失败时，根据错误类型判断是否重试，最多给予一次纠正机会。
      if (formatRetries >= MAX_FORMAT_RETRIES) {
        log.warn({ name: agent.name, response }, "agentLoop: invalid decision json after retry");
        return "";
      }

      // 格式错误重试，注入纠正提示后继续循环，不增加 queryCount。
      formatRetries += 1;

      // 根据错误类型构建纠正提示，当前版本统一使用格式错误提示。
      currentPrompt = buildFormatErrorPrompt(maxQueries);
      continue;
    }

    // 成功解析出决策，重置格式错误重试计数。
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
      currentPrompt = buildQueryLimitPrompt(maxQueries);
      continue;
    }

    // 处理查询决策，生成查询结果并追加到 agent 上下文中，供后续决策参考。
    queryCount += 1;

    // 根据 queryType 生成查询结果，目前版本直接从 state 中读取相关信息构建文本结果，供模型参考。未来可接入更复杂的查询处理逻辑。
    const queryResult = handleQuery(agent.name, decision.queryType, state);
    agent.addHumanMessage(queryResult);

    // 根据当前 queryCount 判断是否达到上限，若达到则注入强制提示要求模型选择 ACT 或 DONE。
    if (queryCount >= maxQueries) {
      currentPrompt = buildQueryLimitPrompt(maxQueries);
    } else {
      currentPrompt = "请基于查询结果继续决策，并仅输出一个 JSON 对象。";
    }
  }
}

/**
 * 对 `state` 中所有已激活的 agent 执行一轮并发推理，结果追加至 `state.log`。
 *
 * @param state - 当前游戏状态，`activatedTurns` 决定哪些 agent 参与本轮推理。
 * @param task - 本回合已构建完成的任务提示词（包含事件事实与行动规则）。
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
