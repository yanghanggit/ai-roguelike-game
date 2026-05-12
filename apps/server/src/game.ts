/**
 * 纯游戏逻辑层（无 HTTP 依赖）
 *
 * 负责：初始状态创建、游戏动作处理、JSON 持久化。
 * 可被 Express 路由和独立脚本共同引用。
 */

import { TileType } from "@roguelike/shared";
import type { GameMap, GameState, MapSize, Player } from "@roguelike/shared";
import { GameAgent } from "./ai/game-agent.js";
import { MOCK_MONSTERS, extractLabel } from "./mock-monsters.js";

// ─── State ────────────────────────────────────────────────────────────────────

export function createInitialState(sessionId: string, map: GameMap, player: Player): GameState {
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
