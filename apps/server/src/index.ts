import express from "express";
import cors from "cors";
import type {
  GameState,
  StartGameResponse,
  ActionRequest,
  ActionResponse,
  GameMap,
  Tile,
} from "@roguelike/shared";

const app = express();
const PORT = 3001;

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// ─── In-memory session store ─────────────────────────────────────────────────

const sessions = new Map<string, GameState>();

// ─── Map generation (placeholder 10×10) ─────────────────────────────────────

function createStarterMap(): GameMap {
  const ROWS = 10;
  const COLS = 10;
  const map: GameMap = [];

  for (let y = 0; y < ROWS; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < COLS; x++) {
      const isWall = x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1;
      row.push(
        isWall
          ? { type: "wall", glyph: "#", passable: false }
          : { type: "floor", glyph: ".", passable: true },
      );
    }
    map.push(row);
  }
  return map;
}

function createInitialState(sessionId: string): GameState {
  return {
    sessionId,
    turn: 0,
    player: {
      position: { x: 1, y: 1 },
      hp: 20,
      maxHp: 20,
      attack: 5,
      defense: 2,
      level: 1,
      xp: 0,
    },
    map: createStarterMap(),
    monsters: [],
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

app.post("/game/action", (req, res) => {
  const body = req.body as ActionRequest;
  const { sessionId, action } = body;

  const state = sessions.get(sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const log: string[] = [];

  if (action.type === "move") {
    const deltas: Record<string, { dx: number; dy: number }> = {
      north: { dx: 0, dy: -1 },
      south: { dx: 0, dy: 1 },
      west: { dx: -1, dy: 0 },
      east: { dx: 1, dy: 0 },
    };
    const { dx, dy } = deltas[action.direction];
    const nx = state.player.position.x + dx;
    const ny = state.player.position.y + dy;
    const tile = state.map[ny]?.[nx];

    if (tile?.passable) {
      state.player.position = { x: nx, y: ny };
      log.push(`You move ${action.direction}.`);
    } else {
      log.push("Blocked!");
    }
  } else if (action.type === "wait") {
    log.push("You wait a turn.");
  }

  state.turn += 1;
  state.log = [...log, ...state.log].slice(0, 20);

  const response: ActionResponse = { state };
  res.json(response);
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
