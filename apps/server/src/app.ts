import express from "express";
import cors from "cors";
import type {
  GameState,
  StartGameResponse,
  ActionRequest,
  ActionResponse,
} from "@roguelike/shared";
import { createMap, createInitialState, applyReveal } from "./game.js";
import { GameAgent, thinkBatch } from "./ai/index.js";

// GameAgent 在服务端为 class，在 shared 为 interface；两者结构兼容。
// 这里的 GameAgent 是服务端 class，用于创建实例并调用 think() / thinkBatch()。

export { createMap } from "./game.js";

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

app.post("/game/action", async (req, res) => {
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

    // 新翻开了一个 Monster 格子 → 激活对应的 GameAgent
    if (result.agentName) {
      const systemPrompt = `你是一只地牢怪物（${result.agentName}）。每个回合描述你的行动，一句话即可。`;
      state.agents.push(new GameAgent(result.agentName, systemPrompt));
    }

    // 每次 reveal 后，让所有已激活的 agent 并发 think 一次
    if (state.agents.length > 0) {
      const perceptions = state.agents.map(
        () => `第 ${state.turn} 回合，玩家揭开了一个新格子。`
      );
      const actions = await thinkBatch(state.agents as GameAgent[], perceptions);
      const entries = actions.filter((a) => a.length > 0);
      if (entries.length > 0) {
        state.log = [...state.log, ...entries].slice(-20);
      }
    }

    res.json({ state } satisfies ActionResponse);
    return;
  }

  res.status(400).json({ error: "Unknown action type" });
});




