/**
 * 游戏动作层。
 *
 * 负责格子揭开、agent 激活与基础广播/初始化。
 */

import { TerrainType, ActorType } from "@roguelike/shared";
import type { GameState, Terrain } from "@roguelike/shared";
import { GameAgent } from "./game-agent.js";
import { DeepSeekClient } from "./ai/deepseek-client.js";

import { TERRAIN_LOG_MESSAGES, ACTOR_LOG_MESSAGES } from "./game-stage.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "GameActions" });

// ─── Reveal ───────────────────────────────────────────────────────────────────

export interface ApplyRevealResult {
  ok: boolean;
  error?: string;
  /** 本次揭开的格子地形（`ok` 为 `true` 时有值）。 */
  terrain?: Terrain;
  /** 本次揭开的 Actor 类型（有 Actor 时有值）。 */
  actorType?: ActorType;
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
  const tile = state.stage.tiles[y]?.[x];
  if (!tile) {
    return { ok: false, error: `坐标 (${x}, ${y}) 超出地图范围` };
  }
  if (tile.revealed) {
    return { ok: true, terrain: tile.terrain, actorType: tile.actor?.type };
  }

  tile.revealed = true;
  state.turn += 1;
  let message = tile.actor
    ? ACTOR_LOG_MESSAGES[tile.actor.type]
    : TERRAIN_LOG_MESSAGES[tile.terrain.type];
  if (tile.actor?.type === ActorType.Monster) {
    const agent = state.agents[tile.actor.name];
    if (agent) message = `${message}==>【${agent.name}】`;
  }
  state.log = [...state.log, { turn: state.turn, message }];

  return {
    ok: true,
    terrain: tile.terrain,
    actorType: tile.actor?.type,
    message,
    agentName: tile.actor?.name,
  };
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

/**
 * 从 state 中提取本回合应参与推理的 agent 列表。
 * 仅包含已激活且非本回合首次激活的 agent（新激活的 agent 从下一回合起行动）。
 */
export function getActiveAgents(state: GameState): GameAgent[] {
  return Object.keys(state.activatedTurns)
    .filter((name) => state.activatedTurns[name]! < state.turn)
    .map((name) => state.agents[name])
    .filter((a) => a !== undefined)
    .map((a) => a as unknown as GameAgent);
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
