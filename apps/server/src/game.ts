/**
 * 纯游戏逻辑层（无 HTTP 依赖）
 *
 * 负责：地图生成、初始状态创建、游戏动作处理、JSON 持久化。
 * 可被 Express 路由和独立脚本共同引用。
 */

import * as path from "node:path";
import fse from "fs-extra";
import { TileType } from "@roguelike/shared";
import type { GameMap, GameState, MapSize, Tile } from "@roguelike/shared";
import { GameAgent, thinkBatch } from "./ai/index.js";
import { MOCK_MONSTERS } from "./mock-monsters.js";

// ─── Glyphs & weights ─────────────────────────────────────────────────────────

export const GLYPHS: Record<TileType, string> = {
  [TileType.Floor]: "·",
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

export function createRandomMap(size: MapSize): GameMap {
  const total = size * size;
  const entranceCount = size === 3 ? 1 : 2;

  const pool: TileType[] = Array.from({ length: entranceCount }, (): TileType => TileType.Entrance);
  for (let i = entranceCount; i < total; i++) pool.push(weightedRandom());

  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }

  const map: GameMap = [];
  for (let y = 0; y < size; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < size; x++) {
      const type = pool[y * size + x]!;
      const tile: Tile = { type, glyph: GLYPHS[type], revealed: false };
      if (type === TileType.Monster) {
        tile.agentName = `monster-${x}-${y}`;
      }
      row.push(tile);
    }
    map.push(row);
  }
  return map;
}

export function createInitialState(sessionId: string): GameState {
  const mapSize: MapSize = 4;
  const map = createRandomMap(mapSize);
  return {
    sessionId,
    turn: 0,
    phase: "player",
    mapSize,
    depth: 1,
    player: {
      hp: 20,
      maxHp: 20,
      attack: 5,
      defense: 2,
      level: 1,
      xp: 0,
    },
    map,
    log: ["欢迎来到地牢！"],
    agents: buildAgentsFromMap(map),
  };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

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
 *   Monster   (0,1)  → agentName = "monster-0-1"
 *   Treasure  (3,1)
 *   Item      (1,2)
 *   Special   (3,3)
 *   Wall      (2,0), (2,2)
 *   Floor     其余 9 格
 */
export function createDevMap(): GameMap {
  const layout: TileType[][] = [
    [TileType.Entrance, TileType.Floor, TileType.Wall, TileType.Floor],
    [TileType.Monster, TileType.Floor, TileType.Floor, TileType.Treasure],
    [TileType.Floor, TileType.Item, TileType.Wall, TileType.Floor],
    [TileType.Floor, TileType.Floor, TileType.Floor, TileType.Special],
  ];

  return layout.map((row, y) =>
    row.map((type, x) => {
      const tile: Tile = { type, glyph: GLYPHS[type], revealed: false };
      if (type === TileType.Monster) {
        tile.agentName = `monster-${x}-${y}`;
      }
      return tile;
    }),
  );
}

export function createDevInitialState(sessionId: string): GameState {
  const mapSize: MapSize = 4;
  const map = createDevMap();
  return {
    sessionId,
    turn: 0,
    phase: "player",
    mapSize,
    depth: 1,
    player: { hp: 20, maxHp: 20, attack: 5, defense: 2, level: 1, xp: 0 },
    map,
    log: ["【开发模式】固定地图已加载。"],
    agents: buildAgentsFromMap(map),
  };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

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
  const message = LOG_MESSAGES[tile.type];
  state.log = [...state.log, message].slice(-20);

  return { ok: true, tileType: tile.type, message, agentName: tile.agentName };
}

// ─── Agent helpers ────────────────────────────────────────────────────────────

/**
 * 扫描地图中所有 Monster 格，预先创建全部 GameAgent（activated: false）。
 * 地图生成时调用一次，后续揭开操作只需翻转激活状态。
 */
function buildAgentsFromMap(map: GameMap): Record<string, GameAgent> {
  const agents: Record<string, GameAgent> = {};
  let monsterIndex = 0;
  for (const row of map) {
    for (const tile of row) {
      if (tile.type === TileType.Monster && tile.agentName) {
        const template = MOCK_MONSTERS[monsterIndex % MOCK_MONSTERS.length]!;
        agents[tile.agentName] = new GameAgent(tile.agentName, template.systemPrompt);
        monsterIndex++;
      }
    }
  }
  return agents;
}

/**
 * 将指定 agentName 的 GameAgent 激活（翻转 activated: true）。
 * 要求 agent 已在 state.agents 中预存在（地图创建时建立）。
 */
export function activateMonsterAgent(state: GameState, agentName: string): void {
  const agent = state.agents[agentName];
  if (!agent) {
    console.warn(`[activateMonsterAgent] agent "${agentName}" not found in state.agents`);
    return;
  }
  agent.activated = true;
}

/**
 * 让 state.agents 中所有已激活的 agent 并发推理一轮，结果追加到 state.log。
 * 并发写入无锁（方案 A：接受并发，slice(-20) 保证不爆）。
 * HTTP 层以 fire-and-forget（void）方式调用；CLI 层 await 阻塞等待。
 */
export async function triggerAgentThinking(state: GameState): Promise<void> {
  const agentList = (Object.values(state.agents) as GameAgent[]).filter((a) => a.activated);
  if (agentList.length === 0) return;
  const perceptions = agentList.map(() => `第 ${state.turn} 回合，玩家揭开了一个新格子。`);
  const actions = await thinkBatch(agentList, perceptions);
  const entries = actions.filter((a) => a.length > 0);
  if (entries.length > 0) {
    state.log = [...state.log, ...entries].slice(-20);
  }
}

// ─── JSON persistence ─────────────────────────────────────────────────────────

/** 生成带时间戳的存档文件名，格式：game-state-20260509T143857-123.json */
function makeTimestampedFilename(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
  return `game-state-${ts}.json`;
}

/**
 * 将 GameState 保存为带时间戳的 JSON 文件（自动创建 savesDir）。
 * 返回实际写入的文件路径。
 */
export function saveGameState(state: GameState, savesDir: string): string {
  const filePath = path.join(savesDir, makeTimestampedFilename());
  fse.outputJsonSync(filePath, state, { spaces: 2 });
  return filePath;
}

/** 从指定路径直接读取存档（供单次精确加载使用） */
export function loadGameState(filePath: string): GameState {
  return fse.readJsonSync(filePath) as GameState;
}

/**
 * 从 savesDir 中读取最新的存档文件。
 * 文件名按字典序排序，ISO 时间戳天然可排序。
 */
export function loadLatestGameState(savesDir: string): GameState {
  const files = fse
    .readdirSync(savesDir)
    .filter((f) => f.startsWith("game-state-") && f.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new Error(`saves 目录中没有找到存档文件：${savesDir}`);
  }
  const latest = files[files.length - 1]!;
  return fse.readJsonSync(path.join(savesDir, latest)) as GameState;
}
