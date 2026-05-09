export { PORTS } from "./config.js";

// ─── Tile ────────────────────────────────────────────────────────────────────

export type TileType = "floor" | "wall" | "door" | "stairs";

export interface Tile {
  type: TileType;
  glyph: string;
  passable: boolean;
}

// ─── Position ────────────────────────────────────────────────────────────────

export interface Position {
  x: number;
  y: number;
}

// ─── Player ──────────────────────────────────────────────────────────────────

export interface Player {
  position: Position;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  level: number;
  xp: number;
}

// ─── Monster ─────────────────────────────────────────────────────────────────

export interface Monster {
  id: string;
  position: Position;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  glyph: string;
  name: string;
}

// ─── Map ─────────────────────────────────────────────────────────────────────

export type GameMap = Tile[][];

// ─── Game State ──────────────────────────────────────────────────────────────

export interface GameState {
  sessionId: string;
  turn: number;
  player: Player;
  map: GameMap;
  monsters: Monster[];
  log: string[];
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export type Direction = "north" | "south" | "east" | "west";

export type ActionType = "move" | "wait" | "attack";

export interface MoveAction {
  type: "move";
  direction: Direction;
}

export interface WaitAction {
  type: "wait";
}

export type GameAction = MoveAction | WaitAction;

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
