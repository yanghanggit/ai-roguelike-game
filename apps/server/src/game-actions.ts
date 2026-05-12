/**
 * 游戏动作层
 *
 * 负责：格子揭开、agent 激活、agent 批量推理。
 * 包含与 AI 交互的 think / thinkBatch 函数。
 */

import { TileType } from "@roguelike/shared";
import type { GameState, LogEntry } from "@roguelike/shared";
import { GameAgent } from "./ai/game-agent.js";
import { DeepSeekClient } from "./ai/deepseek-client.js";
import { humanMessage, aiMessage } from "./ai/messages.js";
import { extractLabel } from "./mock-monsters.js";
import { LOG_MESSAGES } from "./game-map.js";

// ─── Reveal ───────────────────────────────────────────────────────────────────

export interface ApplyRevealResult {
  ok: boolean;
  error?: string;
  /** 本次揭开的格子类型（ok 为 true 时有值） */
  tileType?: TileType;
  /** 本次追加的日志消息（ok 为 true 且格子未曾揭开时有值） */
  message?: string;
  /** Monster 格子专用：对应 GameAgent 的 name，供调用方激活 agent */
  agentName?: string;
}

/**
 * 对 state 执行 reveal 动作（直接 mutate）。
 * 若格子已揭开，返回 ok:true 但不更新状态。
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
 * 将指定 agentName 的 GameAgent 激活（翻转 activated: true）。
 * 要求 agent 已在 state.agents 中预存在（地图创建时建立）。
 */
export function activateAgent(state: GameState, agentName: string): void {
  const agent = state.agents[agentName];
  if (!agent) {
    console.warn(`[activateMonsterAgent] agent "${agentName}" not found in state.agents`);
    return;
  }
  state.activatedTurns[agentName] = state.turn;
}

// ─── AI think ────────────────────────────────────────────────────────────────

/**
 * 将 agent 的当前上下文连同本轮感知输入发往 DeepSeek，
 * 把这一轮的 HumanMessage + AIMessage 追加进 agent.context，
 * 返回 AI 的行动描述字符串。
 *
 * 失败时返回空字符串（游戏容错优先，本回合该实体跳过行动）。
 */
export async function think(agent: GameAgent, perception: string): Promise<string> {
  const client = new DeepSeekClient({
    name: agent.name,
    prompt: perception,
    context: agent.context,
  });

  await client.chat();

  const response = client.responseContent;

  agent.context.push(humanMessage(perception));
  agent.context.push(aiMessage(response));

  return response;
}

/**
 * 同一回合内让多个 agent 并发思考，复用 DeepSeekClient.batchChat() 的并发逻辑。
 * agents[i] 对应 perceptions[i]，返回的字符串数组顺序与输入一致。
 * 若 agents 与 perceptions 长度不一致则抛出错误（调用方问题，快速失败）。
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
    agents[i]!.context.push(humanMessage(perceptions[i]!));
    agents[i]!.context.push(aiMessage(response));
    return response;
  });
}

// ─── Agent thinking trigger ──────────────────────────────────────────────────

/**
 * 让 state.agents 中所有已激活的 agent 并发推理一轮，结果追加到 state.log。
 * HTTP 层以 fire-and-forget（void）方式调用；CLI 层 await 阻塞等待。
 */
export async function triggerAgentThinking(state: GameState): Promise<void> {
  const agentList = Object.keys(state.activatedTurns)
    .filter((name) => state.activatedTurns[name]! < state.turn)
    .map((name) => state.agents[name])
    .filter((a): a is GameAgent => a !== undefined);
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
