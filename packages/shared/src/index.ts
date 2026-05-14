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
} as const;

export type ActorType = (typeof ActorType)[keyof typeof ActorType];

// ─── Glyphs ───────────────────────────────────────────────────────────────────

export const TERRAIN_GLYPHS: Record<TerrainType, string> = {
  [TerrainType.Floor]: ".",
  [TerrainType.Wall]: "#",
  [TerrainType.Entrance]: ">",
};

export const ACTOR_GLYPH = "E";
export const SPECIAL_GLYPH = "?";
export const ITEM_GLYPH = "!";

// ─── Terrain ─────────────────────────────────────────────────────────────────

/** 格子的地形信息：名称（显示用）与地形类型。 */
export interface Terrain {
  readonly name: string;
  readonly type: TerrainType;
}

// ─── Actor ───────────────────────────────────────────────────────────────────

/** 主动实体（怪物、特殊）。`name` 与 `GameState.agents` 中的键一致。 */
export interface Actor {
  readonly name: string;
  type: ActorType;
  /** 怪物的系统提示词，来自 MonsterTemplate；非怪物 actor 无此字段。 */
  systemPrompt?: string;
}

// ─── Item ────────────────────────────────────────────────────────────────────

/** 被动物品实体，与 Actor 平级，占据格子但无 AI 行为。 */
export interface Item {
  readonly type: "item";
  readonly name: string;
}

// ─── Special ────────────────────────────────────────────────────────────────

/** 特殊事件实体，与 Actor/Item 平级，触发特殊叙事效果。 */
export interface Special {
  readonly type: "special";
  readonly name: string;
}

// ─── Occupant ────────────────────────────────────────────────────────────────

/** 占据格子的抽象占有者，通过 `type` 字段区分：`Actor`（"monster"）、`Item`（"item"）或 `Special`（"special"）。 */
export type Occupant = Actor | Item | Special;

// ─── Tile ────────────────────────────────────────────────────────────────────

export interface Tile {
  terrain: Terrain;
  revealed: boolean;
  occupant?: Occupant;
}

// ─── Glyph ───────────────────────────────────────────────────────────────────

/** 返回格子的完整信息字符串（多行）：occupant 类型+名称 / terrain 类型+名称。 */
export function getTileGlyph(tile: Tile): string {
  const lines: string[] = [];
  if (tile.occupant) {
    const { type } = tile.occupant;
    const glyph = type === "item" ? ITEM_GLYPH : type === "special" ? SPECIAL_GLYPH : ACTOR_GLYPH;
    lines.push(`${glyph} ${tile.occupant.name}`);
  }
  lines.push(`${TERRAIN_GLYPHS[tile.terrain.type]} ${tile.terrain.name}`);
  return lines.join("\n");
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
