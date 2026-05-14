/**
 * 地图生成层。
 *
 * 提供地形/Actor 文本映射与基于显式布局的地图生成。
 * 每格必须声明 terrain；Monster actor 系统提示词来自内联 NPCs 列表。
 */

import { TerrainType, ActorType } from "@roguelike/shared";
import type { Actor, Item, Special, Stage, Tile } from "@roguelike/shared";
import { GAME_SETTING, GLOBAL_RULES } from "./game-constants.js";
import { buildSystemPrompt } from "./prompts.js";

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

export const ACTOR_LOG_MESSAGE = "一只怪物潜伏于此！";
export const SPECIAL_LOG_MESSAGE = "有些不寻常的东西在涌动……";

export const ITEM_LOG_MESSAGE = "你发现了一件物品！";

// ─── CellSpec & layout ────────────────────────────────────────────────────────

/** 布局中单个格子的构建数据：terrain 必填，occupant 可选。 */
export interface CellSpec {
  terrain: TerrainType;
  occupant?: ActorType | "item" | "special";
}

/**
 * 固定布局的 3×3 开发地图，所有元素坐标确定，便于测试与调试。
 *
 * 布局（x 为列，y 为行）：
 *
 *      x=0        x=1       x=2
 * y=0  入口 >     地板 ·    墙壁 #
 * y=1  怪物 E     地板 ·    物品 !
 * y=2  地板 ·     物品 !    特殊 ?
 *
 * 各元素唯一坐标：
 *   Entrance  (0,0)
 *   Monster   (0,1)  → actor.name = MOCK_MONSTERS[0].name（"怪物.骷髅战士"）
 *   Item      (2,1)
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
    { terrain: TerrainType.Floor, occupant: ActorType.Monster },
    { terrain: TerrainType.Floor },
    { terrain: TerrainType.Floor, occupant: "item" },
  ],
  [
    { terrain: TerrainType.Floor },
    { terrain: TerrainType.Floor, occupant: "item" },
    { terrain: TerrainType.Floor, occupant: "special" },
  ],
];

/**
 * 固定布局的 4×4 地图，含 3 只怪物，适合初步游戏测试。
 *
 * 布局（x 为列，y 为行）：
 *
 *      x=0        x=1        x=2        x=3
 * y=0  入口 >     地板 ·     墙壁 #     地板 ·
 * y=1  怪物 E     地板 ·     地板 ·     墙壁 #
 * y=2  地板 ·     怪物 E     物品 !     地板 ·
 * y=3  墙壁 #     地板 ·     怪物 E     物品 !
 *
 * 怪物按 NPCs 顺序分配：骷髅战士(0,1)、史莱姆(1,2)、蝙蝠精(2,3)
 */
export const STAGE_4X4_LAYOUT: CellSpec[][] = [
  [
    { terrain: TerrainType.Entrance },
    { terrain: TerrainType.Floor },
    { terrain: TerrainType.Wall },
    { terrain: TerrainType.Floor },
  ],
  [
    { terrain: TerrainType.Floor, occupant: ActorType.Monster },
    { terrain: TerrainType.Floor },
    { terrain: TerrainType.Floor },
    { terrain: TerrainType.Wall },
  ],
  [
    { terrain: TerrainType.Floor },
    { terrain: TerrainType.Floor, occupant: ActorType.Monster },
    { terrain: TerrainType.Floor, occupant: "item" },
    { terrain: TerrainType.Floor },
  ],
  [
    { terrain: TerrainType.Wall },
    { terrain: TerrainType.Floor },
    { terrain: TerrainType.Floor, occupant: ActorType.Monster },
    { terrain: TerrainType.Floor, occupant: "item" },
  ],
];

// ─── NPCs ────────────────────────────────────────────────────────────────────

/** 可用的 NPC（怪物）模板列表，按遍历顺序循环分配给地图中的 Monster 格。 */
const NPCs: Actor[] = [
  {
    name: "怪物.骷髅战士",
    type: ActorType.Monster,
    systemPrompt: buildSystemPrompt(
      "怪物.骷髅战士",
      GAME_SETTING,
      GLOBAL_RULES,
      `\
**本质**: 被黑暗魔法束缚的战士残骸，意识已灭，只余战斗本能驱动骨骼运作。
**战斗风格**: 冷酷机械，挥剑正面压制，动作无任何多余。感知到生者气息立即发动攻击，无需思考，本能使然——等待不是选项。
**弱点**: 关节处甲胄脆弱；对神圣属性伤害敏感。
**行为**: 从不开口，只有骨骼碰撞与剑刃破风声。受重击时骨骼碎裂，片刻后自行拼合。`,
    ),
  },
  {
    name: "怪物.史莱姆",
    type: ActorType.Monster,
    systemPrompt: buildSystemPrompt(
      "怪物.史莱姆",
      GAME_SETTING,
      GLOBAL_RULES,
      `\
**本质**: 由地下污水与腐化魔素凝聚而成的无意识生命体，形态不固定。
**战斗风格**: 行动迟缓，但腐蚀性极强；以包裹、渗透、分裂等方式消耗对手。
**弱点**: 火焰可令其迅速蒸发；强力斩击使其暂时分离成数个小体。
**行为**: 无声蠕动，留下黏液痕迹；受伤时发出低沉的气泡破裂声。`,
    ),
  },
  {
    name: "怪物.蝙蝠精",
    type: ActorType.Monster,
    systemPrompt: buildSystemPrompt(
      "怪物.蝙蝠精",
      GAME_SETTING,
      GLOBAL_RULES,
      `\
**本质**: 长期栖居地牢顶壁的变异洞穴蝙蝠，超声波感知强化，具备初级捕猎意识。
**战斗风格**: 速攻偷袭，利用黑暗与飞行优势，啃咬后迅速拉开距离，反复骚扰。
**弱点**: 强光令其感知短暂失效；噪音可干扰其回声定位，使其一时迷失。
**行为**: 翅膀扑击发出破风声，受惊时发出刺耳高频尖叫。`,
    ),
  },
  {
    name: "怪物.哥布林斥候",
    type: ActorType.Monster,
    systemPrompt: buildSystemPrompt(
      "怪物.哥布林斥候",
      GAME_SETTING,
      GLOBAL_RULES,
      `\
**本质**: 哥布林部落派遣的探路者，贪婪、胆小却极度狡猾。
**战斗风格**: 投掷石块或毒针进行骚扰，优先消耗对手；陷入劣势时尝试逃跑或跪地求饶。
**弱点**: 胆怯，强力威慑可使其退缩；贪财，可能被金币或食物短暂引开注意力。
**行为**: 用哥布林语嘟囔，偶尔夹杂破碎人语嘲弄对手；翻找尸体和地面寻找掉落物。`,
    ),
  },
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
      if (cell.occupant !== undefined) {
        const occupantType = cell.occupant;

        if (occupantType === ActorType.Monster) {
          // Monster 从 NPCs 列表循环分配，确保系统提示词正确
          tile.occupant = { ...NPCs[monsterIndex++ % NPCs.length]! };
        } else if (occupantType === "item") {
          // Item 使用坐标命名
          const itemOccupant: Item = { type: "item", name: `item-${x}-${y}` };
          tile.occupant = itemOccupant;
        } else {
          // Special 使用坐标命名
          const specialOccupant: Special = { type: "special", name: `special-${x}-${y}` };
          tile.occupant = specialOccupant;
        }
      }
      return tile;
    }),
  );
  return { name, tiles };
}
