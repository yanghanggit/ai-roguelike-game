/**
 * 纯游戏逻辑层（无 HTTP 依赖）。
 *
 * 负责初始状态创建，可被 Express 路由和独立脚本共同引用。
 */

import { TileType } from "@roguelike/shared";
import type { GameMap, GameState, MapSize, Player } from "@roguelike/shared";
import { GameAgent } from "./ai/game-agent.js";
import { MOCK_MONSTERS, extractLabel } from "./mock-monsters.js";

// ─── State ────────────────────────────────────────────────────────────────────

/**
 * 创建初始游戏状态。
 *
 * 遍历地图扫描 Monster 格子，为每个怪物从 `MOCK_MONSTERS` 中分配模板并初始化对应 `GameAgent`。
 *
 * @param sessionId - 当前游戏会话的唯一标识符。
 * @param map - 已生成的地图，函数会直接修改其中 Monster 格子的 `glyph`。
 * @param player - 玩家初始属性对象，直接存入状态不做拷贝。
 * @returns 完整的初始 `GameState`，`turn` 为 0，`log` 为空数组。
 */
export function initializeGame(sessionId: string, map: GameMap, player: Player): GameState {
  const mapSize = map.length as MapSize;

  const agents: Record<string, GameAgent> = {};
  let monsterIndex = 0;
  for (const row of map) {
    for (const tile of row) {
      if (tile.type === TileType.Monster && tile.agentName) {
        const template = MOCK_MONSTERS[monsterIndex % MOCK_MONSTERS.length]!;
        agents[tile.agentName] = new GameAgent(template.name, template.systemPrompt);
        tile.glyph = `E:${extractLabel(template.name)}`;
        monsterIndex++;
      }
    }
  }

  return {
    sessionId,
    turn: 0,
    phase: "player",
    mapSize,
    player,
    map,
    log: [],
    agents,
    activatedTurns: {},
  };
}
