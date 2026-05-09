import express from "express";
import cors from "cors";
import type {
  GameState,
  StartGameResponse,
  ActionRequest,
  ActionResponse,
} from "@roguelike/shared";
import type { Response } from "express";
import { createRandomMap, createInitialState, applyReveal, activateMonsterAgent, triggerAgentThinking } from "./game.js";

export { createRandomMap as createMap } from "./game.js";

export const app = express();

app.use(cors());
app.use(express.json());

// ─── In-memory session store ─────────────────────────────────────────────────

export const sessions = new Map<string, GameState>();

// ─── SSE client registry ─────────────────────────────────────────────────────

const sseClients = new Map<string, Set<Response>>();

function pushStateToClients(sessionId: string, state: GameState): void {
  const clients = sseClients.get(sessionId);
  if (!clients || clients.size === 0) return;
  const data = JSON.stringify(state);
  for (const client of clients) {
    client.write(`data: ${data}\n\n`);
  }
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

app.get("/game/events/:sessionId", (req, res) => {
  const { sessionId } = req.params as { sessionId: string };
  if (!sessions.has(sessionId)) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (!sseClients.has(sessionId)) sseClients.set(sessionId, new Set());
  sseClients.get(sessionId)!.add(res);

  req.on("close", () => {
    const clients = sseClients.get(sessionId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) sseClients.delete(sessionId);
    }
  });
});

app.post("/game/action", (req, res) => {
  const body = req.body as ActionRequest;
  const { sessionId, action } = body;

  const state = sessions.get(sessionId);
  if (!state) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (action.type === "reveal") {
    const result = applyReveal(state, action.x, action.y);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    // 新 Monster：仅激活，不触发推理
    if (result.agentName) {
      activateMonsterAgent(state, result.agentName);
    } else if (state.agents.length > 0) {
      // 非 Monster + 已有激活 agent → fire-and-forget think，完成后 SSE 推送
      void triggerAgentThinking(state).then(() => pushStateToClients(sessionId, state));
    }

    // 立即响应，不等待 AI 推理
    res.json({ state } satisfies ActionResponse);
    return;
  }

  res.status(400).json({ error: "Unknown action type" });
});




