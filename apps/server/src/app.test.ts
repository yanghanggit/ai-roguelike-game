import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app, sessions } from "./app.js";
import type { StartGameResponse, ActionResponse } from "@roguelike/shared";

beforeEach(() => {
  sessions.clear();
});

// ─── Health ───────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

// ─── POST /game/start ─────────────────────────────────────────────────────────

describe("POST /game/start", () => {
  it("returns a valid game state", async () => {
    const res = await request(app).post("/game/start");
    expect(res.status).toBe(200);

    const body = res.body as StartGameResponse;
    expect(body.sessionId).toBeTypeOf("string");
    expect(body.state.turn).toBe(0);
    expect(body.state.player.hp).toBe(20);
    expect(body.state.map).toHaveLength(10);
    expect(body.state.log[0]).toBe("Welcome to the dungeon!");
  });

  it("stores the session in memory", async () => {
    const res = await request(app).post("/game/start");
    const { sessionId } = res.body as StartGameResponse;
    expect(sessions.has(sessionId)).toBe(true);
  });

  it("each call creates a unique session", async () => {
    const a = await request(app).post("/game/start");
    const b = await request(app).post("/game/start");
    expect(a.body.sessionId).not.toBe(b.body.sessionId);
  });
});

// ─── POST /game/action ────────────────────────────────────────────────────────

describe("POST /game/action — move", () => {
  async function startSession() {
    const res = await request(app).post("/game/start");
    return res.body as StartGameResponse;
  }

  it("moves player south and increments turn", async () => {
    const { sessionId, state } = await startSession();
    const { x, y } = state.player.position;

    const res = await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "move", direction: "south" } });

    expect(res.status).toBe(200);
    const body = res.body as ActionResponse;
    expect(body.state.turn).toBe(1);
    expect(body.state.player.position).toEqual({ x, y: y + 1 });
  });

  it("does not move into a wall and logs Blocked!", async () => {
    const { sessionId } = await startSession();

    // Player starts at (1,1). Move north hits wall at y=0.
    const res = await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "move", direction: "north" } });

    const body = res.body as ActionResponse;
    expect(body.state.player.position).toEqual({ x: 1, y: 1 });
    expect(body.state.log[0]).toBe("Blocked!");
  });

  it("wait action increments turn without moving", async () => {
    const { sessionId, state } = await startSession();
    const pos = state.player.position;

    const res = await request(app)
      .post("/game/action")
      .send({ sessionId, action: { type: "wait" } });

    const body = res.body as ActionResponse;
    expect(body.state.turn).toBe(1);
    expect(body.state.player.position).toEqual(pos);
  });

  it("returns 404 for unknown sessionId", async () => {
    const res = await request(app)
      .post("/game/action")
      .send({ sessionId: "nonexistent", action: { type: "wait" } });

    expect(res.status).toBe(404);
  });
});
