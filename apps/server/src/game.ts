/**
 * 纯游戏逻辑层（无 HTTP 依赖）。
 *
 * 负责初始状态创建，可被 Express 路由和独立脚本共同引用。
 */

import { ActorType } from "@roguelike/shared";
import type { Stage, GameState, StageSize, Player } from "@roguelike/shared";
import { GameAgent } from "./game-agent.js";

// ─── State ────────────────────────────────────────────────────────────────────

/**
 * 创建初始游戏状态。
 *
 * 遍历地图扫描 Monster 格子，为每个怪物从 `MOCK_MONSTERS` 中分配模板并初始化对应 `GameAgent`。
 *
 * @param sessionId - 当前游戏会话的唯一标识符。
 * @param stage - 已生成的地图。
 * @param player - 玩家初始属性对象，直接存入状态不做拷贝。
 * @returns 完整的初始 `GameState`，`turn` 为 0，`log` 为空数组。
 */
export function initializeGame(sessionId: string, stage: Stage, player: Player): GameState {
  const stageSize = stage.tiles.length as StageSize;

  const agents: Record<string, GameAgent> = {};
  for (const row of stage.tiles) {
    for (const tile of row) {
      if (tile.occupant?.type === ActorType.Monster && tile.occupant.systemPrompt) {
        agents[tile.occupant.name] = new GameAgent(tile.occupant.name, tile.occupant.systemPrompt);
      }
    }
  }

  return {
    sessionId,
    turn: 0,
    phase: "player",
    stageSize,
    player,
    stage,
    log: [],
    agents,
    activatedTurns: {},
  };
}
