import type { StageSize } from "./config.js";
export { PORTS, STAGE_SIZES } from "./config.js";
export type { StageSize } from "./config.js";

// ─── TerrainType ─────────────────────────────────────────────────────────────

export const TerrainType = {
  Floor: "floor",
  Wall: "wall",
  Entrance: "entrance",
} as const;

export type TerrainType = (typeof TerrainType)[keyof typeof TerrainType];

// ─── ActorType ────────────────────────────────────────────────────────────────

export const ActorType = {
  Monster: "monster",
  Treasure: "treasure",
  Item: "item",
  Special: "special",
} as const;

export type ActorType = (typeof ActorType)[keyof typeof ActorType];

// ─── Glyphs ───────────────────────────────────────────────────────────────────

export const TERRAIN_GLYPHS: Record<TerrainType, string> = {
  [TerrainType.Floor]: ".",
  [TerrainType.Wall]: "#",
  [TerrainType.Entrance]: ">",
};

export const ACTOR_GLYPHS: Record<ActorType, string> = {
  [ActorType.Monster]: "E",
  [ActorType.Treasure]: "$",
  [ActorType.Item]: "!",
  [ActorType.Special]: "?",
};

// ─── Terrain ─────────────────────────────────────────────────────────────────

/** 格子的地形信息：名称（显示用）与地形类型。 */
export interface Terrain {
  readonly name: string;
  readonly type: TerrainType;
}

// ─── Actor ───────────────────────────────────────────────────────────────────

/** 占据格子的实体（怪物、宝箱、物品、特殊）。`name` 与 `GameState.agents` 中的键一致。 */
export interface Actor {
  readonly name: string;
  type: ActorType;
}

// ─── Tile ────────────────────────────────────────────────────────────────────

export interface Tile {
  terrain: Terrain;
  revealed: boolean;
  actor?: Actor;
}

// ─── Glyph ───────────────────────────────────────────────────────────────────

/** 返回格子的显示字符：有 Actor 时取 Actor 字符，否则取地形字符。 */
export function getTileGlyph(tile: Tile): string {
  return tile.actor ? ACTOR_GLYPHS[tile.actor.type] : TERRAIN_GLYPHS[tile.terrain.type];
}

// ─── Stage ──────────────────────────────────────────────────────────────────

export interface Stage {
  name: string;
  tiles: Tile[][];
}

// ─── Player ──────────────────────────────────────────────────────────────────

export interface Player {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  level: number;
  xp: number;
}

// ─── Agent ───────────────────────────────────────────────────────────────────

/** 单条对话消息，镜像服务端 ContextMessage（纯数据，可 JSON 序列化） */
export interface AgentMessage {
  readonly type: "system" | "human" | "ai" | "tool";
  readonly content: string;
  readonly additionalKwargs: Record<string, unknown>;
  readonly toolCallId?: string;
}

/** 怪物 Agent 快照：名称 + 完整对话上下文 */
export interface GameAgent {
  readonly name: string;
  readonly context: readonly AgentMessage[];
}

/** 单条游戏日志条目，带回合标记 */
export interface LogEntry {
  turn: number;
  message: string;
}

// ─── Turn phase ──────────────────────────────────────────────────────────────

/** 当前回合所属阵营。"player" 时玩家可操作；"dungeon" 时地下城整体行动（含怪物、机关、环境等所有非玩家元素）。 */
export type TurnPhase = "player" | "dungeon";

// ─── Game State ──────────────────────────────────────────────────────────────

export interface GameState {
  sessionId: string;
  turn: number;
  phase: TurnPhase;
  stageSize: StageSize;
  player: Player;
  stage: Stage;
  log: LogEntry[];
  agents: Record<string, GameAgent>;
  activatedTurns: Record<string, number>;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export interface RevealAction {
  type: "reveal";
  x: number;
  y: number;
}

export type GameAction = RevealAction;

// ─── API Shapes ──────────────────────────────────────────────────────────────

export interface StartGameResponse {
  sessionId: string;
  state: GameState;
}

export interface ActionRequest {
  sessionId: string;
  action: GameAction;
}

export interface ActionResponse {
  state: GameState;
}
