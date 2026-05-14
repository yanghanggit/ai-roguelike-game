/**
 * 地图生成层。
 *
 * 提供地形/Actor 文本映射与基于显式布局的地图生成。
 * 每格必须声明 terrain；Monster actor 名称来自 MOCK_MONSTERS。
 */

import { TerrainType, ActorType } from "@roguelike/shared";
import type { Stage, Tile } from "@roguelike/shared";
import { MOCK_MONSTERS } from "./mock-monsters.js";

// ─── Messages ─────────────────────────────────────────────────────────────────

const TERRAIN_NAMES: Record<TerrainType, string> = {
  [TerrainType.Floor]: "地板",
  [TerrainType.Wall]: "墙壁",
  [TerrainType.Entrance]: "入口",
};

export const TERRAIN_LOG_MESSAGES: Record<TerrainType, string> = {
  [TerrainType.Floor]: "地面空无一物。",
  [TerrainType.Wall]: "坚固的墙壁挡住了去路。",
  [TerrainType.Entrance]: "通往下一层的入口！",
};

export const ACTOR_LOG_MESSAGES: Record<ActorType, string> = {
  [ActorType.Monster]: "一只怪物潜伏于此！",
  [ActorType.Treasure]: "一个宝箱在闪闪发光！",
  [ActorType.Item]: "你发现了一件物品！",
  [ActorType.Special]: "有些不寻常的东西在涌动……",
};

// ─── CellSpec & layout ────────────────────────────────────────────────────────

/** 布局中单个格子的构建数据：terrain 必填，actor 可选。 */
export interface CellSpec {
  terrain: TerrainType;
  actor?: ActorType;
}

/**
 * 固定布局的 3×3 开发地图，所有元素坐标确定，便于测试与调试。
 *
 * 布局（x 为列，y 为行）：
 *
 *      x=0        x=1       x=2
 * y=0  入口 >     地板 ·    墙壁 #
 * y=1  怪物 E     地板 ·    宝箱 $
 * y=2  地板 ·     物品 !    特殊 ?
 *
 * 各元素唯一坐标：
 *   Entrance  (0,0)
 *   Monster   (0,1)  → actor.name = MOCK_MONSTERS[0].name（"怪物.骷髅战士"）
 *   Treasure  (2,1)
 *   Item      (1,2)
 *   Special   (2,2)
 *   Wall      (2,0)
 *   Floor     其余 3 格
 */
export const DEV_STAGE_LAYOUT: CellSpec[][] = [
  [
    { terrain: TerrainType.Entrance },
    { terrain: TerrainType.Floor },
    { terrain: TerrainType.Wall },
  ],
  [
    { terrain: TerrainType.Floor, actor: ActorType.Monster },
    { terrain: TerrainType.Floor },
    { terrain: TerrainType.Floor, actor: ActorType.Treasure },
  ],
  [
    { terrain: TerrainType.Floor },
    { terrain: TerrainType.Floor, actor: ActorType.Item },
    { terrain: TerrainType.Floor, actor: ActorType.Special },
  ],
];

// ─── Stage factory ────────────────────────────────────────────────────────────

/**
 * 根据显式布局生成地图。
 *
 * - 每格 terrain 由 `layout[y][x].terrain` 决定，不再隐式假设 Floor。
 * - Monster actor 按遍历顺序从 `MOCK_MONSTERS` 循环取名；其余 actor 使用坐标命名。
 *
 * @param layout - 二维 `CellSpec` 数组，行数与列数决定地图尺寸。
 * @param name   - 地图名称，默认 `"dungeon"`。
 */
export function createStage(layout: CellSpec[][], name = "dungeon"): Stage {
  let monsterIndex = 0;
  const tiles: Tile[][] = layout.map((row, y) =>
    row.map((cell, x) => {
      const tile: Tile = {
        terrain: { name: TERRAIN_NAMES[cell.terrain], type: cell.terrain },
        revealed: false,
      };
      if (cell.actor !== undefined) {
        const actorType = cell.actor;
        const actorName =
          actorType === ActorType.Monster
            ? MOCK_MONSTERS[monsterIndex++ % MOCK_MONSTERS.length]!.name
            : `${actorType}-${x}-${y}`;
        tile.actor = { name: actorName, type: actorType };
      }
      return tile;
    }),
  );
  return { name, tiles };
}
