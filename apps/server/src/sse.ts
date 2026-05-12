import type { Express, Response } from "express";
import type { GameState } from "@roguelike/shared";

// ─── SSE client registry ─────────────────────────────────────────────────────

const sseClients = new Map<string, Set<Response>>();

/**
 * 向指定 session 的所有已连接 SSE 客户端推送最新游戏状态。
 *
 * 若该 session 当前无订阅者则跳过推送并打印日志。
 *
 * @param sessionId - 目标游戏会话的唯一标识符。
 * @param state - 要推送的最新 `GameState`，序列化为 SSE `data:` 帧。
 */
export function pushStateToClients(sessionId: string, state: GameState): void {
  const clients = sseClients.get(sessionId);
  if (!clients || clients.size === 0) {
    console.log(`[SSE] ❌ push skipped — no clients for session ${sessionId.slice(0, 8)}`);
    return;
  }
  console.log(
    `[SSE] ▶ pushing phase="${state.phase}" to ${clients.size} client(s) (session ${sessionId.slice(0, 8)}, turn=${state.turn})`,
  );
  const data = JSON.stringify(state);
  let written = 0;
  for (const client of clients) {
    const ok = client.write(`data: ${data}\n\n`);
    console.log(`[SSE]   write() returned ${ok} (false=backpressure)`);
    written++;
  }
  console.log(`[SSE] ✓ wrote to ${written} client(s)`);
}

/**
 * 在 Express 应用上注册 `GET /game/events/:sessionId` SSE 路由。
 *
 * 客户端连接后立即推送一次当前状态（catch-up push），防止连接建立前已发生的状态更新丢失。
 * 连接断开时自动从订阅者集合中移除；集合清空后删除对应 session 条目。
 *
 * @param app - Express 应用实例。
 * @param sessions - 全局 session 存储，用于校验 session 是否存在及获取当前状态。
 */
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
    const ok = res.write(`data: ${JSON.stringify(currentState)}\n\n`);
    console.log(`[SSE] catch-up push phase="${currentState.phase}" write()=${ok}`);

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
