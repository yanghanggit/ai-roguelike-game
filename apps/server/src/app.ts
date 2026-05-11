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
  activateMonsterAgent,
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

app.post("/game/action", (req, res) => {
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

    if (result.agentName) {
      // 怪物格：仅激活 agent，保持 phase: "player"，给玩家一轮缓冲
      activateMonsterAgent(state, result.agentName);
      console.log(
        `[Action] Monster revealed at (${action.x},${action.y}) — agent "${result.agentName}" activated (${Object.keys(state.agents).length} total), phase stays "player"`,
      );
      // push 最新 state（含新揭开的怪物格），SSE 是唯一状态源
      pushStateToClients(sessionId, state);
    } else if (result.message) {
      // 非怪物格且是新格子：进入 dungeon phase，触发所有已激活 agent 思考
      state.phase = "dungeon";
      console.log(
        `[Action] Non-monster reveal at (${action.x},${action.y}) — phase → "dungeon", firing think for ${Object.keys(state.agents).length} agent(s) (turn=${state.turn})`,
      );
      // 立即 push dungeon 状态，让客户端锁定地图（SSE 是唯一状态源）
      pushStateToClients(sessionId, state);
      void triggerAgentThinking(state).then(() => {
        state.phase = "player";
        console.log(`[Action] Dungeon turn done — phase → "player", log[-1]="${state.log.at(-1)}"`);
        console.log(`[Action] About to push SSE for session ${sessionId.slice(0, 8)}...`);
        pushStateToClients(sessionId, state);
      });
    } else {
      // 格子已揭开：不改 phase，但仍 push 保持 SSE 为唯一状态源
      console.log(
        `[Action] Reveal at (${action.x},${action.y}) — already revealed, no phase change`,
      );
      pushStateToClients(sessionId, state);
    }

    // 立即响应，不等待 AI 推理
    res.json({ state } satisfies ActionResponse);
    return;
  }

  res.status(400).json({ error: "Unknown action type" });
});
