import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import request from "supertest";
import { app, sessions } from "./app.js";
import { createRandomMap } from "./game-map.js";
import type { GameState } from "@roguelike/shared";
import { TileType } from "@roguelike/shared";
import { GameAgent as GameAgentClass } from "./ai/index.js";

// ─── DeepSeek fetch mock helper ───────────────────────────────────────────────

function mockFetch(summary: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_001",
                  type: "function",
                  function: {
                    name: "strike",
                    arguments: JSON.stringify({ target: "player", summary }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
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

  it("returns a valid game state (3×3 or 4×4)", async () => {
    const res = await request(app).post("/game/start");
    expect(res.status).toBe(200);
    const state: GameState = res.body.state;
    expect([3, 4]).toContain(state.mapSize);
    expect(state.map).toHaveLength(state.mapSize);
    expect(state.map[0]).toHaveLength(state.mapSize);
    expect(state.turn).toBe(0);
    expect(state.phase).toBe("player");
  });

  it("all tiles start hidden (revealed=false)", async () => {
    const res = await request(app).post("/game/start");
    const state: GameState = res.body.state;
    const allHidden = state.map.every((row) => row.every((tile) => !tile.revealed));
    expect(allHidden).toBe(true);
  });

  it("map has at least 1 entrance tile", async () => {
    const res = await request(app).post("/game/start");
    const state: GameState = res.body.state;
    const entranceCount = state.map.flat().filter((t) => t.type === "entrance").length;
    expect(entranceCount).toBeGreaterThanOrEqual(1);
  });

  it("stores session and creates unique sessionIds", async () => {
    const res1 = await request(app).post("/game/start");
    const res2 = await request(app).post("/game/start");
    expect(res1.body.state.sessionId).not.toBe(res2.body.state.sessionId);
    expect(sessions.has(res1.body.state.sessionId)).toBe(true);
  });
});

describe("POST /game/player-action — reveal", () => {
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
      .post("/game/player-action")
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
      .post("/game/player-action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });
    expect(res.status).toBe(200);
    expect(res.body.state.phase).toBe("dungeon");
  });

  it("dungeon phase 期间 reveal 返回 409", async () => {
    const state0 = sessions.get(sessionId)!;
    state0.phase = "dungeon";

    const res = await request(app)
      .post("/game/player-action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });
    expect(res.status).toBe(409);
  });

  it("appends a log message on reveal", async () => {
    const res = await request(app)
      .post("/game/player-action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });
    const state: GameState = res.body.state;
    expect(state.log.length).toBeGreaterThan(0);
  });

  it("revealing an already-revealed tile does not increment turn", async () => {
    // 事前に (0,0) を revealed = true に設定することで phase が変わらず再テストできる
    const state0 = sessions.get(sessionId)!;
    state0.map[0]![0]!.revealed = true;
    state0.map[0]![0]!.type = TileType.Floor;

    const res = await request(app)
      .post("/game/player-action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });
    expect(res.status).toBe(200);
    expect(res.body.state.turn).toBe(0);
  });

  it("returns 404 for unknown sessionId", async () => {
    const res = await request(app)
      .post("/game/player-action")
      .send({ sessionId: "unknown", action: { type: "reveal", x: 0, y: 0 } });
    expect(res.status).toBe(404);
  });
});

describe("createRandomMap", () => {
  it("creates a 3×3 map with at least 1 entrance", () => {
    const map = createRandomMap(3);
    expect(map).toHaveLength(3);
    expect(map[0]).toHaveLength(3);
    const entrances = map.flat().filter((t) => t.type === "entrance").length;
    expect(entrances).toBeGreaterThanOrEqual(1);
  });

  it("creates a 4×4 map with at least 2 entrances", () => {
    const map = createRandomMap(4);
    expect(map).toHaveLength(4);
    expect(map[0]).toHaveLength(4);
    const entrances = map.flat().filter((t) => t.type === "entrance").length;
    expect(entrances).toBeGreaterThanOrEqual(2);
  });

  it("all tiles start unrevealed", () => {
    const map = createRandomMap(4);
    expect(map.flat().every((t) => !t.revealed)).toBe(true);
  });
});

// ─── POST /game/player-action — Monster 激活 GameAgent ──────────────────────

describe("POST /game/player-action — Monster 激活 GameAgent", () => {
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

  it("reveal Monster 格子后，agent 已激活，phase 变为 dungeon", async () => {
    // 强制 (0,0) 为 Monster，并在 agents 中预建立对应的 agent
    const state = sessions.get(sessionId)!;
    state.map[0]![0]!.type = TileType.Monster;
    state.map[0]![0]!.agentName = "monster-0-0";
    state.agents["monster-0-0"] = new GameAgentClass("怪物.测试怪物", "测试怪物");

    const res = await request(app)
      .post("/game/player-action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });

    expect(res.status).toBe(200);
    const returned: GameState = res.body.state;
    expect(returned.agents["monster-0-0"]).toBeDefined();
    expect(returned.activatedTurns["monster-0-0"]).toBe(1);
    // 怪物揭开也新タイルなので dungeon phase に遷移する
    expect(returned.phase).toBe("dungeon");
  });

  it("reveal Monster 后，dungeon-advance 前は AI 未行動（log 末尾に AI 台詞なし）", async () => {
    mockFetch("我决定攻击玩家！");

    const state = sessions.get(sessionId)!;
    state.map[0]![0]!.type = TileType.Monster;
    state.map[0]![0]!.agentName = "monster-0-0";
    state.agents["monster-0-0"] = new GameAgentClass("怪物.测试怪物", "测试怪物");

    const res = await request(app)
      .post("/game/player-action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });

    const returned: GameState = res.body.state;
    // agent は activatedTurns に登録済み、phase は dungeon
    expect(returned.activatedTurns["monster-0-0"]).toBeDefined();
    expect(returned.phase).toBe("dungeon");
    // dungeon-advance を呼んでいないので AI 台詞はまだ現れない
    expect(returned.log[returned.log.length - 1]).not.toBe("我决定攻击玩家！");
  });

  it("dungeon-advance 後、激活怪物の AI 行動が log に現れ phase が player に戻る", async () => {
    mockFetch("我决定攻击玩家！");

    const state = sessions.get(sessionId)!;
    state.agents["monster-0-0"] = new GameAgentClass("怪物.测试怪物", "测试怪物");
    // 手动预设：monster 在上一回合（turn=0）被发现，当前 turn=1 → 0 < 1 → 可以行动
    state.activatedTurns["monster-0-0"] = 0;
    state.turn = 1;
    state.phase = "dungeon";

    const res = await request(app).post("/game/dungeon-advance").send({ sessionId });

    expect(res.status).toBe(200);
    expect(res.body.state.phase).toBe("player");
    expect(res.body.state.log[res.body.state.log.length - 1].message).toContain("我决定攻击玩家！");
  });

  it("reveal 非 Monster 格子后，state.agents 仍为空", async () => {
    const state = sessions.get(sessionId)!;
    state.map[0]![0]!.type = TileType.Floor;
    delete (state.map[0]![0]! as { agentName?: string }).agentName;

    const res = await request(app)
      .post("/game/player-action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });

    expect(res.status).toBe(200);
    // activatedTurns 中没有激活的怪物
    expect(Object.keys(res.body.state.activatedTurns as GameState["activatedTurns"]).length).toBe(
      0,
    );
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

// ─── POST /game/dungeon-advance ───────────────────────────────────────────────

describe("POST /game/dungeon-advance", () => {
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

  it("phase が player のときは 409 を返す", async () => {
    const res = await request(app).post("/game/dungeon-advance").send({ sessionId });
    expect(res.status).toBe(409);
  });

  it("未知 sessionId で 404 を返す", async () => {
    const res = await request(app).post("/game/dungeon-advance").send({ sessionId: "unknown" });
    expect(res.status).toBe(404);
  });

  it("dungeon phase のとき、AI 思考後に phase が player に戻る", async () => {
    const state = sessions.get(sessionId)!;
    state.phase = "dungeon";
    // 激活済みの agent がなければ triggerAgentThinking は即座に返る（mock 不要）
    const res = await request(app).post("/game/dungeon-advance").send({ sessionId });
    expect(res.status).toBe(200);
    expect(res.body.state.phase).toBe("player");
  });
});
