import type { Express, Response } from "express";
import type { GameState } from "@roguelike/shared";

// ─── SSE client registry ─────────────────────────────────────────────────────

const sseClients = new Map<string, Set<Response>>();

export function pushStateToClients(sessionId: string, state: GameState): void {
  const clients = sseClients.get(sessionId);
  if (!clients || clients.size === 0) {
    console.log(`[SSE] push skipped — no clients for session ${sessionId}`);
    return;
  }
  console.log(
    `[SSE] pushing state to ${clients.size} client(s) for session ${sessionId} (turn=${state.turn}, log[-1]="${state.log.at(-1)}")`,
  );
  const data = JSON.stringify(state);
  for (const client of clients) {
    client.write(`data: ${data}\n\n`);
  }
}

export function registerSseRoute(app: Express, sessions: Map<string, GameState>): void {
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
    console.log(
      `[SSE] client connected — session ${sessionId} now has ${sseClients.get(sessionId)!.size} subscriber(s)`,
    );

    // Catch-up push：立即推送当前状态，防止客户端在连接建立前错过的 push（竞态修复）
    const currentState = sessions.get(sessionId)!;
    res.write(`data: ${JSON.stringify(currentState)}\n\n`);

    req.on("close", () => {
      const clients = sseClients.get(sessionId);
      if (clients) {
        clients.delete(res);
        console.log(
          `[SSE] client disconnected — session ${sessionId} now has ${clients.size} subscriber(s)`,
        );
        if (clients.size === 0) sseClients.delete(sessionId);
      }
    });
  });
}
