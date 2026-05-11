import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import request from "supertest";
import { app, sessions, createMap } from "./app.js";
import type { GameState } from "@roguelike/shared";
import { TileType } from "@roguelike/shared";
import { GameAgent as GameAgentClass } from "./ai/index.js";

// ─── DeepSeek fetch mock helper ───────────────────────────────────────────────

function mockFetch(content: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content } }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 0,
        },
      }),
    }),
  );
}

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /game/start", () => {
  beforeEach(() => sessions.clear());

  it("returns a valid 4×4 game state", async () => {
    const res = await request(app).post("/game/start");
    expect(res.status).toBe(200);
    const state: GameState = res.body.state;
    expect(state.mapSize).toBe(4);
    expect(state.map).toHaveLength(4);
    expect(state.map[0]).toHaveLength(4);
    expect(state.depth).toBe(1);
    expect(state.turn).toBe(0);
    expect(state.phase).toBe("player");
  });

  it("all tiles start hidden (revealed=false)", async () => {
    const res = await request(app).post("/game/start");
    const state: GameState = res.body.state;
    const allHidden = state.map.every((row) => row.every((tile) => !tile.revealed));
    expect(allHidden).toBe(true);
  });

  it("map has at least 2 entrance tiles", async () => {
    const res = await request(app).post("/game/start");
    const state: GameState = res.body.state;
    const entranceCount = state.map.flat().filter((t) => t.type === "entrance").length;
    expect(entranceCount).toBeGreaterThanOrEqual(2);
  });

  it("stores session and creates unique sessionIds", async () => {
    const res1 = await request(app).post("/game/start");
    const res2 = await request(app).post("/game/start");
    expect(res1.body.state.sessionId).not.toBe(res2.body.state.sessionId);
    expect(sessions.has(res1.body.state.sessionId)).toBe(true);
  });
});

describe("POST /game/action — reveal", () => {
  let sessionId: string;

  beforeEach(async () => {
    sessions.clear();
    vi.unstubAllGlobals();
    const res = await request(app).post("/game/start");
    sessionId = res.body.state.sessionId;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reveals a hidden tile and increments turn", async () => {
    // 确保 (0,0) 是非怪物格
    const state0 = sessions.get(sessionId)!;
    state0.map[0]![0]!.type = TileType.Floor;
    delete (state0.map[0]![0]! as { agentName?: string }).agentName;

    const res = await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });
    expect(res.status).toBe(200);
    const state: GameState = res.body.state;
    expect(state.map[0]![0]!.revealed).toBe(true);
    expect(state.turn).toBe(1);
  });

  it("非怪物格 reveal 后，HTTP 响应 phase 为 dungeon", async () => {
    const state0 = sessions.get(sessionId)!;
    state0.map[0]![0]!.type = TileType.Floor;
    delete (state0.map[0]![0]! as { agentName?: string }).agentName;

    const res = await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });
    expect(res.status).toBe(200);
    expect(res.body.state.phase).toBe("dungeon");
  });

  it("dungeon phase 期间 reveal 返回 409", async () => {
    const state0 = sessions.get(sessionId)!;
    state0.phase = "dungeon";

    const res = await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });
    expect(res.status).toBe(409);
  });

  it("appends a log message on reveal", async () => {
    const res = await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });
    const state: GameState = res.body.state;
    expect(state.log.length).toBeGreaterThan(1);
  });

  it("revealing an already-revealed tile does not increment turn", async () => {
    await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });
    const res = await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });
    expect(res.status).toBe(200);
    expect(res.body.state.turn).toBe(1);
  });

  it("returns 404 for unknown sessionId", async () => {
    const res = await request(app)
      .post("/game/action")
      .send({ sessionId: "unknown", action: { type: "reveal", x: 0, y: 0 } });
    expect(res.status).toBe(404);
  });
});

describe("createMap", () => {
  it("creates a 3×3 map with at least 1 entrance", () => {
    const map = createMap(3);
    expect(map).toHaveLength(3);
    expect(map[0]).toHaveLength(3);
    const entrances = map.flat().filter((t) => t.type === "entrance").length;
    expect(entrances).toBeGreaterThanOrEqual(1);
  });

  it("creates a 4×4 map with at least 2 entrances", () => {
    const map = createMap(4);
    expect(map).toHaveLength(4);
    expect(map[0]).toHaveLength(4);
    const entrances = map.flat().filter((t) => t.type === "entrance").length;
    expect(entrances).toBeGreaterThanOrEqual(2);
  });

  it("all tiles start unrevealed", () => {
    const map = createMap(4);
    expect(map.flat().every((t) => !t.revealed)).toBe(true);
  });
});

// ─── POST /game/action — Monster 激活 GameAgent ───────────────────────────────

describe("POST /game/action — Monster 激活 GameAgent", () => {
  let sessionId: string;

  beforeEach(async () => {
    sessions.clear();
    vi.unstubAllGlobals();
    process.env["DEEPSEEK_API_KEY"] = "test-key";
    const res = await request(app).post("/game/start");
    sessionId = res.body.state.sessionId;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["DEEPSEEK_API_KEY"];
  });

  it("reveal Monster 格子后，state.agents 新增一个条目，phase 保持 player", async () => {
    mockFetch("我向玩家移动。");

    // 强制 (0,0) 为 Monster，并在 agents 中预建立对应的 agent
    const state = sessions.get(sessionId)!;
    state.map[0]![0]!.type = TileType.Monster;
    state.map[0]![0]!.agentName = "monster-0-0";
    state.agents["monster-0-0"] = new GameAgentClass("monster-0-0", "测试怪物");

    const res = await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });

    expect(res.status).toBe(200);
    const returned: GameState = res.body.state;
    expect(returned.agents["monster-0-0"]).toBeDefined();
    expect(returned.agents["monster-0-0"]!.activated).toBe(true);
    // 怪物揭开后 phase 保持 player，给玩家一轮缓冲
    expect(returned.phase).toBe("player");
  });

  it("reveal Monster 时仅激活，不立即 think（log 末尾不含 AI 行动）", async () => {
    mockFetch("我决定攻击玩家！");

    const state = sessions.get(sessionId)!;
    state.map[0]![0]!.type = TileType.Monster;
    state.map[0]![0]!.agentName = "monster-0-0";
    state.agents["monster-0-0"] = new GameAgentClass("monster-0-0", "测试怪物");

    const res = await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });

    const returned: GameState = res.body.state;
    // agents 已激活
    expect(returned.agents["monster-0-0"]!.activated).toBe(true);
    // 但 AI 行动尚未出现（log 末尾应为 Monster 的系统消息，而非 AI 台词）
    expect(returned.log[returned.log.length - 1]).not.toBe("我决定攻击玩家！");
  });

  it("Monster 激活后再次 reveal，HTTP 立即响应（非阶塞验证）", async () => {
    mockFetch("我决定攻击玩家！");

    const state = sessions.get(sessionId)!;
    // (0,0) 设为 Monster，(1,0) 设为 Floor
    state.map[0]![0]!.type = TileType.Monster;
    state.map[0]![0]!.agentName = "monster-0-0";
    state.agents["monster-0-0"] = new GameAgentClass("monster-0-0", "测试怪物");
    state.map[0]![1]!.type = TileType.Floor;
    delete (state.map[0]![1]! as { agentName?: string }).agentName;

    // 第一次 reveal Monster → 仅激活
    await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });

    // 第二次 reveal Floor → 后台 think，HTTP 立即返回
    const res = await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "reveal", x: 1, y: 0 } });

    // HTTP 响应在 AI 推理完成前发出，响应体不含 AI 内容
    expect(res.status).toBe(200);
    expect(res.body.state.turn).toBe(2);
    expect(res.body.state.agents["monster-0-0"]!.activated).toBe(true);
    expect(res.body.state.log[res.body.state.log.length - 1]).not.toBe("我决定攻击玩家！");
  });

  it("reveal 非 Monster 格子后，state.agents 仍为空", async () => {
    const state = sessions.get(sessionId)!;
    state.map[0]![0]!.type = TileType.Floor;
    delete (state.map[0]![0]! as { agentName?: string }).agentName;

    const res = await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });

    expect(res.status).toBe(200);
    // agents 中少有地图测试设置的怪物，但未激活
    const activated = Object.values(res.body.state.agents as GameState["agents"]).filter(
      (a) => a.activated,
    );
    expect(activated).toHaveLength(0);
  });
});

// ─── GET /game/events — SSE 端点 ───────────────────────────────────────────────────

describe("GET /game/events", () => {
  beforeEach(() => sessions.clear());

  it("未知 sessionId 返回 404", async () => {
    const res = await request(app).get("/game/events/nonexistent-session-id");
    expect(res.status).toBe(404);
  });
});
