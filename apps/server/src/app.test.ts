import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app, sessions, createMap } from "./app.js";
import type { GameState } from "@roguelike/shared";

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
    const res = await request(app).post("/game/start");
    sessionId = res.body.state.sessionId;
  });

  it("reveals a hidden tile and increments turn", async () => {
    const res = await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "reveal", x: 0, y: 0 } });
    expect(res.status).toBe(200);
    const state: GameState = res.body.state;
    expect(state.map[0]![0]!.revealed).toBe(true);
    expect(state.turn).toBe(1);
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
