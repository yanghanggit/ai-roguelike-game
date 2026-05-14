/**
 * 地图生成层。
 *
 * 提供瓦片字符映射、随机地图生成与固定开发地图生成。
 * 无副作用，无外部状态依赖。
 */

import { TerrainType, ActorType } from "@roguelike/shared";
import type { Stage, StageSize, Tile } from "@roguelike/shared";
import { Actor } from "./actor.js";
import { Terrain } from "./terrain.js";

// ─── Weights & messages ──────────────────────────────────────────────────────

const TERRAIN_NAMES: Record<TerrainType, string> = {
  [TerrainType.Floor]: "地板",
  [TerrainType.Wall]: "墙壁",
  [TerrainType.Entrance]: "入口",
};

const WEIGHTS: [TerrainType | ActorType, number][] = [
  [TerrainType.Floor, 40],
  [TerrainType.Wall, 20],
  [ActorType.Monster, 20],
  [ActorType.Treasure, 10],
  [ActorType.Item, 5],
  [ActorType.Special, 5],
];

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

// ─── Map generation ───────────────────────────────────────────────────────────

const ACTOR_TYPE_VALUES = new Set<string>(Object.values(ActorType));

function weightedRandom(): TerrainType | ActorType {
  const rand = Math.random() * 100;
  let cumulative = 0;
  for (const [type, weight] of WEIGHTS) {
    cumulative += weight;
    if (rand < cumulative) return type;
  }
  return TerrainType.Floor;
}

/**
 * 生成指定尺寸的随机地图。
 *
 * 保证包含至少一个入口（3×3 地图 1 个，4×4 地图 2 个），
 * 其余格子按权重随机分配，Monster 格子自动赋予 `actor`。
 *
 * @param size - 地图边长，支持 `3` 或 `4`。
 * @returns 尺寸为 `size × size` 的二维 `Tile` 数组，所有格子初始为未揭开状态。
 */
export function createRandomStage(size: StageSize, name = "dungeon"): Stage {
  const total = size * size;
  const entranceCount = size === 3 ? 1 : 2;

  const pool: (TerrainType | ActorType)[] = Array.from(
    { length: entranceCount },
    (): TerrainType => TerrainType.Entrance,
  );
  for (let i = entranceCount; i < total; i++) pool.push(weightedRandom());

  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }

  const tiles: Tile[][] = [];
  for (let y = 0; y < size; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < size; x++) {
      const content = pool[y * size + x]!;
      if (ACTOR_TYPE_VALUES.has(content)) {
        const actorType = content as ActorType;
        const terrainType = TerrainType.Floor;
        const tile: Tile = {
          terrain: new Terrain(TERRAIN_NAMES[terrainType], terrainType),
          revealed: false,
        };
        tile.actor = new Actor(`${actorType}-${x}-${y}`, actorType);
        row.push(tile);
      } else {
        const terrainType = content as TerrainType;
        row.push({
          terrain: new Terrain(TERRAIN_NAMES[terrainType], terrainType),
          revealed: false,
        });
      }
    }
    tiles.push(row);
  }
  return { name, tiles };
}

/**
 * 固定布局的 4×4 开发地图，所有元素坐标确定，便于测试与调试。
 *
 * 布局（x 为列，y 为行）：
 *
 *      x=0        x=1       x=2        x=3
 * y=0  入口 >     地板 ·    墙壁 #     地板 ·
 * y=1  怪物 E     地板 ·    地板 ·     宝箱 $
 * y=2  地板 ·     物品 !    墙壁 #     地板 ·
 * y=3  地板 ·     地板 ·    地板 ·     特殊 ?
 *
 * 各元素唯一坐标：
 *   Entrance  (0,0)
 *   Monster   (0,1)  → actor.name = "monster-0-1"
 *   Treasure  (3,1)
 *   Item      (1,2)
 *   Special   (3,3)
 *   Wall      (2,0), (2,2)
 *   Floor     其余 9 格
 */
export function createDevStage(name = "dev"): Stage {
  const layout: (TerrainType | ActorType)[][] = [
    [TerrainType.Entrance, TerrainType.Floor, TerrainType.Wall, TerrainType.Floor],
    [ActorType.Monster, TerrainType.Floor, TerrainType.Floor, ActorType.Treasure],
    [TerrainType.Floor, ActorType.Item, TerrainType.Wall, TerrainType.Floor],
    [TerrainType.Floor, TerrainType.Floor, TerrainType.Floor, ActorType.Special],
  ];

  const tiles = layout.map((row, y) =>
    row.map((content, x) => {
      if (ACTOR_TYPE_VALUES.has(content)) {
        const actorType = content as ActorType;
        const terrainType = TerrainType.Floor;
        const tile: Tile = {
          terrain: new Terrain(TERRAIN_NAMES[terrainType], terrainType),
          revealed: false,
        };
        tile.actor = new Actor(`${actorType}-${x}-${y}`, actorType);
        return tile;
      }
      const terrainType = content as TerrainType;
      return {
        terrain: new Terrain(TERRAIN_NAMES[terrainType], terrainType),
        revealed: false,
      } satisfies Tile;
    }),
  );
  return { name, tiles };
}
