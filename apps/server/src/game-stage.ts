/**
 * 地图生成层。
 *
 * 提供瓦片字符映射、随机地图生成与固定开发地图生成。
 * 无副作用，无外部状态依赖。
 */

import { TileType } from "@roguelike/shared";
import type { Stage, StageSize, Tile } from "@roguelike/shared";
import { Actor } from "./actor.js";

// ─── Glyphs & weights ─────────────────────────────────────────────────────────

export const GLYPHS: Record<TileType, string> = {
  [TileType.Floor]: ".",
  [TileType.Wall]: "#",
  [TileType.Entrance]: ">",
  [TileType.Monster]: "E",
  [TileType.Treasure]: "$",
  [TileType.Item]: "!",
  [TileType.Special]: "?",
};

const WEIGHTS: [TileType, number][] = [
  [TileType.Floor, 40],
  [TileType.Wall, 20],
  [TileType.Monster, 20],
  [TileType.Treasure, 10],
  [TileType.Item, 5],
  [TileType.Special, 5],
];

export const LOG_MESSAGES: Record<TileType, string> = {
  [TileType.Floor]: "地面空无一物。",
  [TileType.Wall]: "坚固的墙壁挡住了去路。",
  [TileType.Entrance]: "通往下一层的入口！",
  [TileType.Monster]: "一只怪物潜伏于此！",
  [TileType.Treasure]: "一个宝箱在闪闪发光！",
  [TileType.Item]: "你发现了一件物品！",
  [TileType.Special]: "有些不寻常的东西在涌动……",
};

// ─── Map generation ───────────────────────────────────────────────────────────

function weightedRandom(): TileType {
  const rand = Math.random() * 100;
  let cumulative = 0;
  for (const [type, weight] of WEIGHTS) {
    cumulative += weight;
    if (rand < cumulative) return type;
  }
  return TileType.Floor;
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

  const pool: TileType[] = Array.from({ length: entranceCount }, (): TileType => TileType.Entrance);
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
      const type = pool[y * size + x]!;
      const tile: Tile = { type, glyph: GLYPHS[type], revealed: false };
      if (type === TileType.Monster) {
        tile.actor = new Actor(`monster-${x}-${y}`);
      }
      row.push(tile);
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
  const layout: TileType[][] = [
    [TileType.Entrance, TileType.Floor, TileType.Wall, TileType.Floor],
    [TileType.Monster, TileType.Floor, TileType.Floor, TileType.Treasure],
    [TileType.Floor, TileType.Item, TileType.Wall, TileType.Floor],
    [TileType.Floor, TileType.Floor, TileType.Floor, TileType.Special],
  ];

  const tiles = layout.map((row, y) =>
    row.map((type, x) => {
      const tile: Tile = { type, glyph: GLYPHS[type], revealed: false };
      if (type === TileType.Monster) {
        tile.actor = new Actor(`monster-${x}-${y}`);
      }
      return tile;
    }),
  );
  return { name, tiles };
}
