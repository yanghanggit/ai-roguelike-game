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

// ─── Game State ──────────────────────────────────────────────────────────────

export interface GameState {
  sessionId: string;
  turn: number;
  mapSize: MapSize;
  depth: number;
  player: Player;
  map: GameMap;
  log: string[];
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
