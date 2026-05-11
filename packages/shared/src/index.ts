import type { MapSize } from "./config.js";
export { PORTS, MAP_SIZES } from "./config.js";
export type { MapSize } from "./config.js";

// ─── Tile ────────────────────────────────────────────────────────────────────

export const TileType = {
  Floor: "floor",
  Wall: "wall",
  Entrance: "entrance",
  Monster: "monster",
  Treasure: "treasure",
  Item: "item",
  Special: "special",
} as const;

export type TileType = (typeof TileType)[keyof typeof TileType];

export interface Tile {
  type: TileType;
  glyph: string;
  revealed: boolean;
  /** Monster 格子专用：关联 GameAgent 的 name，用于在 GameState.agents 中查找上下文 */
  agentName?: string;
}

// ─── Map ─────────────────────────────────────────────────────────────────────

export type GameMap = Tile[][];

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
  readonly type: "system" | "human" | "ai";
  readonly content: string;
  readonly additionalKwargs: Record<string, unknown>;
}

/** 怪物 Agent 快照：名称 + 完整对话上下文 + 激活状态 */
export interface GameAgent {
  readonly name: string;
  readonly displayName: string;
  readonly context: AgentMessage[];
  /** 是否已被玩家揭开（揭开前不参与推理）*/
  activated: boolean;
}

// ─── Turn phase ──────────────────────────────────────────────────────────────

/** 当前回合所属阵营。"player" 时玩家可操作；"dungeon" 时地下城整体行动（含怪物、机关、环境等所有非玩家元素）。 */
export type TurnPhase = "player" | "dungeon";

// ─── Game State ──────────────────────────────────────────────────────────────

export interface GameState {
  sessionId: string;
  turn: number;
  /** 当前回合阶段：玩家操作阶段 or 敌人行动阶段 */
  phase: TurnPhase;
  mapSize: MapSize;
  depth: number;
  player: Player;
  map: GameMap;
  log: string[];
  /** 本局已激活（已翻开）的 Agent，含完整对话上下文，key = agentName */
  agents: Record<string, GameAgent>;
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
