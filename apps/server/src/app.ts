import express from "express";
import cors from "cors";
import type {
  GameState,
  StartGameResponse,
  ActionRequest,
  ActionResponse,
  GameMap,
  Tile,
  TileType,
  MapSize,
} from "@roguelike/shared";

export const app = express();

app.use(cors());
app.use(express.json());

// ─── In-memory session store ─────────────────────────────────────────────────

export const sessions = new Map<string, GameState>();

// ─── Map generation ───────────────────────────────────────────────────────────

const GLYPHS: Record<TileType, string> = {
  floor: "·",
  wall: "#",
  entrance: ">",
  monster: "E",
  treasure: "$",
  item: "!",
  special: "?",
};

const WEIGHTS: [TileType, number][] = [
  ["floor", 40],
  ["wall", 20],
  ["monster", 20],
  ["treasure", 10],
  ["item", 5],
  ["special", 5],
];

function weightedRandom(): TileType {
  const rand = Math.random() * 100;
  let cumulative = 0;
  for (const [type, weight] of WEIGHTS) {
    cumulative += weight;
    if (rand < cumulative) return type;
  }
  return "floor";
}

export function createMap(size: MapSize): GameMap {
  const total = size * size;
  const entranceCount = size === 3 ? 1 : 2;

  const pool: TileType[] = Array.from({ length: entranceCount }, (): TileType => "entrance");
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
      row.push({ type, glyph: GLYPHS[type], revealed: false });
    }
    map.push(row);
  }
  return map;
}

export function createInitialState(sessionId: string): GameState {
  const mapSize: MapSize = 4;
  return {
    sessionId,
    turn: 0,
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
    map: createMap(mapSize),
    log: ["Welcome to the dungeon!"],
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/game/start", (_req, res) => {
  const sessionId = crypto.randomUUID();
  const state = createInitialState(sessionId);
  sessions.set(sessionId, state);

  const response: StartGameResponse = { sessionId, state };
  res.json(response);
});

const LOG_MESSAGES: Record<TileType, string> = {
  floor: "The floor is empty.",
  wall: "A solid wall blocks the path.",
  entrance: "An entrance to the next level!",
  monster: "A monster lurks here!",
  treasure: "A treasure chest glitters!",
  item: "You found an item!",
  special: "Something unusual stirs...",
};

app.post("/game/action", (req, res) => {
  const body = req.body as ActionRequest;
  const { sessionId, action } = body;

  const state = sessions.get(sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (action.type === "reveal") {
    const { x, y } = action;
    const row = state.map[y];
    const tile = row?.[x];

    if (!tile) {
      res.status(400).json({ error: "Invalid tile coordinates" });
      return;
    }

    if (tile.revealed) {
      res.json({ state } satisfies ActionResponse);
      return;
    }

    tile.revealed = true;
    state.turn += 1;
    const msg = LOG_MESSAGES[tile.type];
    state.log = [msg, ...state.log].slice(0, 20);

    res.json({ state } satisfies ActionResponse);
    return;
  }

  res.status(400).json({ error: "Unknown action type" });
});
