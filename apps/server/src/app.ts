/**
 * Express 路由层。
 *
 * 挂载所有 HTTP 路由与 SSE 端点，持有内存 session 存储。
 * 无业务逻辑，所有游戏操作委托给 game-actions.ts / game.ts。
 */
import * as path from "node:path";
import * as url from "node:url";
import express from "express";
import cors from "cors";
import type {
  GameState,
  StartGameResponse,
  ActionRequest,
  ActionResponse,
} from "@roguelike/shared";
import { pushStateToClients, registerSseRoute } from "./sse.js";
import { createStage, STAGE_4X4_LAYOUT } from "./game-stage.js";
import { initializeGame } from "./game.js";
import {
  applyReveal,
  activateAgent,
  getActiveAgents,
  initializeAgents,
  broadcastToAgents,
  BROADCAST_ENCOUNTERED,
  BROADCAST_PLAYER_ACTED,
} from "./game-actions.js";
import { AgentTask, AGENT_LOOP_MAX_ROUNDS } from "./agent-task.js";
import { buildTurnTaskPrompt } from "./prompts.js";
import { runAgentLoops } from "./agent-loop-runner.js";
import { queryStatusTool, strikeTool } from "./agent-tools.js";
import { GameAgent } from "./game-agent.js";
import { saveGameState } from "./game-persistence.js";
import { logger } from "./logger.js";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
/** 存档根目录，优先读取 SAVES_DIR 环境变量（由 CLI 注入），fallback 到包内 saves/ */
const SAVES_DIR = process.env["SAVES_DIR"] ?? path.resolve(__dirname, "../saves");

const log = logger.child({ module: "Action" });

export const app = express();

app.use(cors());
app.use(express.json());

// ─── In-memory session store ─────────────────────────────────────────────────

export const sessions = new Map<string, GameState>();
registerSseRoute(app, sessions);

// ─── Routes ──────────────────────────────────────────────────────────────────

/** 健康检查，供 `pnpm cli health` 探测服务是否就绪。 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/** 创建新游戏会话，返回 sessionId 与初始 `GameState`。 */
app.post("/game/start", async (_req, res) => {
  // 生成唯一 sessionId，创建初始游戏状态并存储到 sessions 中
  const sessionId = crypto.randomUUID();

  // 初始状态：
  const state = initializeGame(sessionId, createStage(STAGE_4X4_LAYOUT), {
    hp: 20,
    maxHp: 20,
    attack: 5,
    defense: 2,
    level: 1,
    xp: 0,
  });

  // 将新状态存入内存 session 存储
  sessions.set(sessionId, state);

  // 初始化所有 agent（当前仅有怪物），确保它们在首次被激活前已完成至少一次推理。
  await initializeAgents(state);

  // 保存初始存档快照（含 agent 初始化结果）
  saveGameState(state, path.join(SAVES_DIR, sessionId));

  // 返回 sessionId 与初始状态
  const response: StartGameResponse = { sessionId, state };
  res.json(response);
});

/**
 * 处理玩家动作（当前仅支持 `reveal`）。
 *
 * 揭开新格子时切换 phase 为 `"dungeon"` 并通过 SSE 推送状态；
 * 格子已揭开时不改 phase，仍推送以保持 SSE 为唯一状态源。
 */
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
        // 广播给被揭开的怪物自身
        const encounteredAgent = state.agents[result.agentName] as unknown as GameAgent | undefined;
        if (encounteredAgent) broadcastToAgents([encounteredAgent], BROADCAST_ENCOUNTERED);
        log.info(
          {
            x: action.x,
            y: action.y,
            agent: result.agentName,
            totalAgents: Object.keys(state.agents).length,
          },
          "Monster revealed — agent activated",
        );
      }

      // 广播给所有其他已激活怪物（排除刚激活的）
      const otherAgents = Object.keys(state.activatedTurns)
        .filter((name) => name !== result.agentName)
        .map((name) => state.agents[name] as unknown as GameAgent | undefined)
        .filter((a): a is GameAgent => a !== undefined);

      // 广播玩家行动给其他已激活怪物，触发它们的感知更新（但不立即推理，等 dungeon-advance 统一触发）
      if (otherAgents.length > 0) broadcastToAgents(otherAgents, BROADCAST_PLAYER_ACTED);

      // 切换到地下城行动阶段，等待 dungeon-advance 触发怪物行动
      state.phase = "dungeon";
      log.info({ x: action.x, y: action.y, turn: state.turn }, `New tile — phase → "dungeon"`);

      // 保存存档快照（phase = "dungeon"，等待 AI 推理）
      saveGameState(state, path.join(SAVES_DIR, sessionId));

      // 推送更新后的状态到客户端，触发前端界面刷新
      pushStateToClients(sessionId, state);
    } else {
      // 格子已揭开：不改 phase，仍 push 保持 SSE 为唯一状态源
      log.debug({ x: action.x, y: action.y }, "Reveal — already revealed, no phase change");
      pushStateToClients(sessionId, state);
    }

    res.json({ state } satisfies ActionResponse);
    return;
  }

  res.status(400).json({ error: "Unknown action type" });
});

/**
 * 推进地下城行动阶段：触发所有已激活 agent 的 AI 推理，
 * 完成后将 phase 切回 `"player"` 并推送最新状态。
 */
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

  // 触发所有已激活 agent 的 AI 推理，完成后切回玩家行动阶段
  const agents = getActiveAgents(state);
  if (agents.length > 0) {
    const task = new AgentTask({
      prompt: buildTurnTaskPrompt(state.turn),
      tools: [queryStatusTool, strikeTool],
      maxRounds: AGENT_LOOP_MAX_ROUNDS,
    });
    await runAgentLoops(agents, task, state);
  }

  // 切回玩家行动阶段，等待下一次 reveal 触发
  state.phase = "player";

  log.info(
    { turn: state.turn, lastLog: state.log.at(-1)?.message },
    `Dungeon advance done — phase → "player"`,
  );

  // 保存存档快照（phase = "player"，AI 推理已完成）
  saveGameState(state, path.join(SAVES_DIR, sessionId));

  // 推送更新后的状态到客户端，触发前端界面刷新
  pushStateToClients(sessionId, state);

  // 响应当前状态（主要用于调试，前端不依赖此响应）
  res.json({ state } satisfies ActionResponse);
});
