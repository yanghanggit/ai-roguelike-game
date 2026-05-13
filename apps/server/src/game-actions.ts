/**
 * 游戏动作层。
 *
 * 负责格子揭开、agent 激活与批量 AI 推理。
 * 包含与 AI 后端通信的 `thinkBatch` 辅助函数。
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

// ─── AI think ────────────────────────────────────────────────────────────────

/**
 * 在同一回合内并发执行多个 agent 的推理，委托给 `DeepSeekClient.batchChat()`。
 *
 * `agents[i]` 对应 `perceptions[i]`，返回数组顺序与输入一致。
 * 两数组长度不一致时抛出错误（属调用方问题，快速失败）。
 *
 * @param agents - 参与本轮推理的 agent 列表，顺序与 `perceptions` 对应。
 * @param perceptions - 各 agent 本回合的感知描述文本，顺序与 `agents` 对应。
 * @returns 与 `agents` 顺序一致的 AI 行动描述数组；单个 agent 失败时对应项为空字符串。
 */
export async function thinkBatch(agents: GameAgent[], perceptions: string[]): Promise<string[]> {
  if (agents.length !== perceptions.length) {
    throw new Error(
      `thinkBatch: agents(${agents.length}) 与 perceptions(${perceptions.length}) 长度不一致`,
    );
  }
  if (agents.length === 0) return [];

  const clients = agents.map(
    (agent, i) =>
      new DeepSeekClient({
        name: agent.name,
        prompt: perceptions[i]!,
        context: agent.context,
      }),
  );

  await DeepSeekClient.batchChat(clients);

  return clients.map((client, i) => {
    const response = client.responseContent;
    agents[i]!.addHumanMessage(perceptions[i]!);
    agents[i]!.addAIMessage(response);
    return response;
  });
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

// ─── Agent thinking trigger ──────────────────────────────────────────────────

/**
 * 对 `state` 中所有已激活的 agent 执行一轮并发推理，结果追加至 `state.log`。
 *
 * HTTP 层以 fire-and-forget（`void`）方式调用；CLI 层 `await` 阻塞等待。
 *
 * @param state - 当前游戏状态，`activatedTurns` 决定哪些 agent 参与本轮推理。
 */
export async function triggerAgentThinking(state: GameState): Promise<void> {
  const agentList = Object.keys(state.activatedTurns)
    .filter((name) => state.activatedTurns[name]! < state.turn)
    .map((name) => state.agents[name])
    .filter((a) => a !== undefined)
    .map((a) => a as unknown as GameAgent);
  if (agentList.length === 0) return;
  const perceptions = agentList.map(() => `第 ${state.turn} 回合，玩家揭开了一个新格子。`);
  const actions = await thinkBatch(agentList, perceptions);
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
