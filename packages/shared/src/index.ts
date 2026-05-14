import type { StageSize } from "./config.js";
export { PORTS, STAGE_SIZES } from "./config.js";
export type { StageSize } from "./config.js";

// ─── TileType ────────────────────────────────────────────────────────────────

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

// ─── Actor ───────────────────────────────────────────────────────────────────

/** 占据格子的实体（当前为怪物）。`name` 与 `GameState.agents` 中的键一致。 */
export interface Actor {
  readonly name: string;
}

// ─── Tile ────────────────────────────────────────────────────────────────────

export interface Tile {
  type: TileType;
  glyph: string;
  revealed: boolean;
  /** Monster 格子专用：占据该格子的 Actor，其 name 用于在 GameState.agents 中查找上下文 */
  actor?: Actor;
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
