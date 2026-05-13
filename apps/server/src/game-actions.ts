/**
 * 游戏动作层。
 *
 * 负责格子揭开、agent 激活与批量 AI 推理（agentLoop）。
 */

import { TileType } from "@roguelike/shared";
import type { GameState, LogEntry } from "@roguelike/shared";
import { GameAgent } from "./ai/game-agent.js";
import { DeepSeekClient } from "./ai/deepseek-client.js";

import { extractLabel } from "./mock-monsters.js";
import { LOG_MESSAGES } from "./game-map.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "GameActions" });

// ─── Reveal ───────────────────────────────────────────────────────────────────

export interface ApplyRevealResult {
  ok: boolean;
  error?: string;
  /** 本次揭开的格子类型（`ok` 为 `true` 时有值）。 */
  tileType?: TileType;
  /** 本回合追加的日志消息（`ok` 为 `true` 且格子首次揭开时有值）。 */
  message?: string;
  /** Monster 格子专用：关联的 `GameAgent` 名称，供调用方激活对应 agent。 */
  agentName?: string;
}

/**
 * 对 `state` 执行揭开动作（直接修改原对象）。
 *
 * 若格子已揭开，返回 `ok: true` 但不更新状态。
 *
 * @param state - 当前游戏状态（会被直接修改）。
 * @param x - 目标格子的列坐标（0-based）。
 * @param y - 目标格子的行坐标（0-based）。
 * @returns 揭开结果，包含是否成功、格子类型、日志消息及可选的 agentName。
 */
export function applyReveal(state: GameState, x: number, y: number): ApplyRevealResult {
  const tile = state.map[y]?.[x];
  if (!tile) {
    return { ok: false, error: `坐标 (${x}, ${y}) 超出地图范围` };
  }
  if (tile.revealed) {
    return { ok: true, tileType: tile.type };
  }

  tile.revealed = true;
  state.turn += 1;
  let message = LOG_MESSAGES[tile.type];
  if (tile.type === TileType.Monster && tile.agentName) {
    const agent = state.agents[tile.agentName];
    if (agent) message = `${message}==>【${extractLabel(agent.name)}】`;
  }
  state.log = [...state.log, { turn: state.turn, message }];

  return { ok: true, tileType: tile.type, message, agentName: tile.agentName };
}

// ─── Agent activation ─────────────────────────────────────────────────────────

/**
 * 将指定 agent 标记为已激活，并记录激活时的回合数。
 *
 * agent 必须已预存在 `state.agents` 中（地图创建时写入）。
 *
 * @param state - 当前游戏状态（会被直接修改）。
 * @param agentName - 要激活的 agent 名称，需与 `state.agents` 中的键一致。
 */
export function activateAgent(state: GameState, agentName: string): void {
  const agent = state.agents[agentName];
  if (!agent) {
    log.warn({ agentName }, "activateAgent: agent not found in state.agents");
    return;
  }
  state.activatedTurns[agentName] = state.turn;
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

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
 * @param perception - 本回合触发推理的感知文本（第一步的 prompt）。
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

// ─── Agent initialization ────────────────────────────────────────────────────

const INIT_PERCEPTION = "游戏开始，你已苏醒，开始警戒地下城。";
/** 怪物被玩家揭开时，注入给该怪物自身的感知。 */
export const BROADCAST_ENCOUNTERED = "玩家发现了你，你已被激活，进入警戒状态。";
/** 玩家每次揭开格子时，注入给所有其他已激活怪物的感知。 */
export const BROADCAST_PLAYER_ACTED = "玩家揭开了一个新格子。";

/**
 * 在游戏创建后对所有怪物 agent 执行一次初始化推理。
 *
 * 向每个 agent 发送开场感知词，将产生的 `HumanMessage` + `AIMessage`
 * 追加至各自的 `context`，但不写入 `state.log`（对玩家不可见）。
 *
 * 使该 agent 的上下文结构为：
 *   [SystemMessage]  角色设定
 *   [HumanMessage]   "游戏开始，你已苏醒..."
 *   [AIMessage]      怪物初始反应
 *   （后续游戏循环消息...）
 *
 * @param state - 当前游戏状态，`agents` 中的所有 agent 都会参与初始化。
 */
export async function initializeAgents(state: GameState): Promise<void> {
  const agentList = Object.values(state.agents)
    .filter((a) => a !== undefined)
    .map((a) => a as unknown as GameAgent);
  if (agentList.length === 0) return;

  const clients = agentList.map(
    (agent) =>
      new DeepSeekClient({
        name: agent.name,
        prompt: INIT_PERCEPTION,
        context: agent.context,
      }),
  );

  await DeepSeekClient.batchChat(clients);

  for (let i = 0; i < agentList.length; i++) {
    const response = clients[i]!.responseContent;
    agentList[i]!.addHumanMessage(INIT_PERCEPTION);
    agentList[i]!.addAIMessage(response);
  }
}

// ─── Agent broadcast ─────────────────────────────────────────────────────────

/**
 * 向指定 agent 列表的每个 agent 注入一条 `HumanMessage`，不触发 AI 推理，不写 `state.log`。
 *
 * 调用方负责按场景筛选 agent 列表（被揭开的怪物、其他已激活怪物等），
 * 本函数只做统一的上下文写入，是所有广播操作的单一入口。
 *
 * @param agents - 接收广播的 agent 列表。
 * @param message - 注入的感知文本。
 */
export function broadcastToAgents(agents: GameAgent[], message: string): void {
  for (const agent of agents) {
    agent.addHumanMessage(message);
  }
}

// ─── Agent loop runner ───────────────────────────────────────────────────────

/**
 * 对 `state` 中所有已激活的 agent 执行一轮并发推理，结果追加至 `state.log`。
 *
 * HTTP 层以 fire-and-forget（`void`）方式调用；CLI 层 `await` 阻塞等待。
 *
 * @param state - 当前游戏状态，`activatedTurns` 决定哪些 agent 参与本轮推理。
 * @param task - 本回合触发推理的任务描述，注入给所有参与推理的 agent。
 */
export async function runAgentLoops(state: GameState, task: string): Promise<void> {
  // 筛选出所有已激活且上回合未激活的 agent，准备并发推理
  const agentList = Object.keys(state.activatedTurns)
    .filter((name) => state.activatedTurns[name]! < state.turn)
    .map((name) => state.agents[name])
    .filter((a) => a !== undefined)
    .map((a) => a as unknown as GameAgent);

  // 没有符合条件的 agent 则直接返回，避免不必要的计算和日志记录
  if (agentList.length === 0) {
    log.debug({ turn: state.turn }, "runAgentLoops: no agents to run");
    return;
  }

  // 为每个 agent 应用本回合任务描述，并执行并发推理
  const actions = await agentLoopBatch(
    agentList,
    agentList.map(() => task),
  );

  // 将每个 agent 的行动结果（非空）格式化为日志消息并追加到 state.log 中
  const entries = actions
    .map((content, i) =>
      content.length > 0 ? `${extractLabel(agentList[i]!.name)}：${content}` : "",
    )
    .filter((a) => a.length > 0);

  // 只有当至少有一个 agent 有有效行动时才追加日志，避免无意义的空消息
  if (entries.length > 0) {
    const newEntries: LogEntry[] = entries.map((message) => ({ turn: state.turn, message }));
    state.log = [...state.log, ...newEntries];
  }
}
