import express from "express";
import cors from "cors";
import { TileType } from "@roguelike/shared";
import type {
  GameState,
  StartGameResponse,
  ActionRequest,
  ActionResponse,
  GameMap,
  Tile,
  MapSize,
} from "@roguelike/shared";

export const app = express();

app.use(cors());
app.use(express.json());

// ─── In-memory session store ─────────────────────────────────────────────────

export const sessions = new Map<string, GameState>();

// ─── Map generation ───────────────────────────────────────────────────────────

const GLYPHS: Record<TileType, string> = {
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

function weightedRandom(): TileType {
  const rand = Math.random() * 100;
  let cumulative = 0;
  for (const [type, weight] of WEIGHTS) {
    cumulative += weight;
    if (rand < cumulative) return type;
  }
  return TileType.Floor;
}

export function createMap(size: MapSize): GameMap {
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
    log: ["欢迎来到地牢！"],
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
  [TileType.Floor]: "地面空无一物。",
  [TileType.Wall]: "坚固的墙壁挡住了去路。",
  [TileType.Entrance]: "通往下一层的入口！",
  [TileType.Monster]: "一只怪物潜伏于此！",
  [TileType.Treasure]: "一个宝箱在闪闪发光！",
  [TileType.Item]: "你发现了一件物品！",
  [TileType.Special]: "有些不寻常的东西在涌动……",
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
    state.log = [...state.log, msg].slice(-20);

    res.json({ state } satisfies ActionResponse);
    return;
  }

  res.status(400).json({ error: "Unknown action type" });
});
