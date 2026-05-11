import express from "express";
import cors from "cors";
import type {
  GameState,
  StartGameResponse,
  ActionRequest,
  ActionResponse,
} from "@roguelike/shared";
import { pushStateToClients, registerSseRoute } from "./sse.js";
import {
  createRandomMap,
  createInitialState,
  applyReveal,
  activateAgent,
  triggerAgentThinking,
} from "./game.js";

export { createRandomMap as createMap } from "./game.js";

export const app = express();

app.use(cors());
app.use(express.json());

// ─── In-memory session store ─────────────────────────────────────────────────

export const sessions = new Map<string, GameState>();

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

registerSseRoute(app, sessions);

app.post("/game/player-action", (req, res) => {
  const body = req.body as ActionRequest;
  const { sessionId, action } = body;

  const state = sessions.get(sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (action.type === "reveal") {
    if (state.phase !== "player") {
      res.status(409).json({ error: "敌人行动中，请等待" });
      return;
    }

    const result = applyReveal(state, action.x, action.y);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    if (result.message) {
      // 新格子（怪物或非怪物）：激活 agent（若有），进入 dungeon phase
      if (result.agentName) {
        activateAgent(state, result.agentName);
        console.log(
          `[Action] Monster revealed at (${action.x},${action.y}) — agent "${result.agentName}" activated (${Object.keys(state.agents).length} total)`,
        );
      }
      state.phase = "dungeon";
      console.log(
        `[Action] New tile at (${action.x},${action.y}) — phase → "dungeon" (turn=${state.turn})`,
      );
      pushStateToClients(sessionId, state);
    } else {
      // 格子已揭开：不改 phase，仍 push 保持 SSE 为唯一状态源
      console.log(
        `[Action] Reveal at (${action.x},${action.y}) — already revealed, no phase change`,
      );
      pushStateToClients(sessionId, state);
    }

    res.json({ state } satisfies ActionResponse);
    return;
  }

  res.status(400).json({ error: "Unknown action type" });
});

app.post("/game/dungeon-advance", async (req, res) => {
  const { sessionId } = req.body as { sessionId: string };

  const state = sessions.get(sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (state.phase !== "dungeon") {
    res.status(409).json({ error: "非地下城行动阶段" });
    return;
  }

  await triggerAgentThinking(state);
  state.phase = "player";
  console.log(`[Dungeon] Advance done — phase → "player", log[-1]="${state.log.at(-1)}"`);
  pushStateToClients(sessionId, state);
  res.json({ state } satisfies ActionResponse);
});
