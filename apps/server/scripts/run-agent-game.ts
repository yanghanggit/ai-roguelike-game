#!/usr/bin/env tsx
/**
 * Agent Game CLI — 供编程助手（agent）逐步驱动游戏的命令行工具
 *
 * 使用方式（在项目根目录）：
 *   pnpm tsx apps/server/scripts/run-agent-game.ts <command>
 *
 * 命令：
 *   start               创建随机新游戏，存入 saves/，打印初始地图
 *   start-dev           创建固定布局开发地图（元素位置确定，便于测试）
 *   status              读取最新存档，打印地图与玩家信息
 *   reveal <x> <y>      揭开指定坐标的格子，保存带时间戳的新存档
 */

import * as path from "node:path";
import * as url from "node:url";
import { Command } from "commander";
import dotenv from "dotenv";
import pino from "pino";
import {
  createInitialState,
  createDevInitialState,
  applyReveal,
  activateMonsterAgent,
  triggerAgentThinking,
  saveGameState,
  loadLatestGameState,
  GLYPHS,
} from "../src/game.js";
import type { GameState } from "@roguelike/shared";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
/** 所有存档文件都写入此目录，每次操作生成一个带时间戳的快照 */
const SAVES_DIR = path.resolve(__dirname, "../saves");

dotenv.config({ path: path.resolve(ROOT, ".env") });

/** 运维级日志（操作结果、错误、路径提示），与游戏显示输出分离 */
const logger = pino({
  level: "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true, ignore: "pid,hostname" },
  },
});

// ─── Display helpers ──────────────────────────────────────────────────────────

function printMap(state: GameState): void {
  const size = state.mapSize;
  console.log(`\n地图 ${size}×${size}  （第 ${state.depth} 层 · 第 ${state.turn} 回合）`);

  // 列坐标头
  console.log("    " + Array.from({ length: size }, (_, x) => ` ${x}`).join(""));
  console.log("   +" + "──".repeat(size) + "+");

  for (let y = 0; y < size; y++) {
    const row = state.map[y]!;
    const cells = row.map((tile) => (tile.revealed ? ` ${tile.glyph}` : " ?")).join("");
    console.log(` ${y} │${cells} │`);
  }
  console.log("   +" + "──".repeat(size) + "+");

  // 图例
  console.log(
    "\n图例：" +
      Object.entries(GLYPHS)
        .map(([, g]) => g)
        .join(" ") +
      "   ? = 未揭开",
  );
  console.log("  · 地板  # 墙  > 入口  E 怪物  $ 宝箱  ! 物品  ? 特殊\n");
}

function printPlayer(state: GameState): void {
  const p = state.player;
  console.log(
    `玩家状态：HP ${p.hp}/${p.maxHp} · ATK ${p.attack} · DEF ${p.defense} · Lv ${p.level} · XP ${p.xp}`,
  );
}

function printLog(state: GameState): void {
  console.log("\n最近日志：");
  state.log.slice(-5).forEach((msg) => console.log(`  ${msg}`));
}

function printUnrevealed(state: GameState): void {
  const unrevealed: string[] = [];
  state.map.forEach((row, y) => {
    row.forEach((tile, x) => {
      if (!tile.revealed) unrevealed.push(`(${x},${y})`);
    });
  });
  console.log(`\n未揭开格子 [${unrevealed.length}]：${unrevealed.join("  ")}`);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("run-agent-game")
  .description("Agent Game CLI — 每条命令是一个原子操作，状态通过 JSON 文件传递")
  .version("0.0.1");

// ─── start ────────────────────────────────────────────────────────────────────

program
  .command("start")
  .description("创建随机新游戏，保存存档到 saves/")
  .action(() => {
    const sessionId = crypto.randomUUID();
    const state = createInitialState(sessionId);
    const savedPath = saveGameState(state, SAVES_DIR);

    logger.info({ sessionId, savedPath }, "新游戏已创建");
    printMap(state);
    printPlayer(state);
    printUnrevealed(state);
  });

// ─── start-dev ────────────────────────────────────────────────────────────────

program
  .command("start-dev")
  .description("创建固定布局开发地图（元素位置确定，便于测试与调试）")
  .action(() => {
    const sessionId = crypto.randomUUID();
    const state = createDevInitialState(sessionId);
    const savedPath = saveGameState(state, SAVES_DIR);

    logger.info({ sessionId, savedPath }, "【开发模式】固定地图已创建");
    printMap(state);
    printPlayer(state);
    printUnrevealed(state);
  });

// ─── status ───────────────────────────────────────────────────────────────────

program
  .command("status")
  .description("读取当前状态，打印地图与玩家信息")
  .action(() => {
    let state: GameState;
    try {
      state = loadLatestGameState(SAVES_DIR);
    } catch (err) {
      logger.error({ savesDir: SAVES_DIR }, "找不到存档文件，请先运行 start");
      process.exit(1);
    }

    printMap(state);
    printPlayer(state);
    printLog(state);
    printUnrevealed(state);

    const total = state.mapSize * state.mapSize;
    const revealed = state.map.flat().filter((t) => t.revealed).length;
    console.log(`\n进度：${revealed}/${total} 格已揭开`);
  });

// ─── reveal ───────────────────────────────────────────────────────────────────

program
  .command("reveal <x> <y>")
  .description("揭开坐标 (x, y) 的格子")
  .action(async (xStr: string, yStr: string) => {
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);

    if (isNaN(x) || isNaN(y)) {
      logger.error("x 和 y 必须是整数");
      process.exit(1);
    }

    let state: GameState;
    try {
      state = loadLatestGameState(SAVES_DIR);
    } catch (err) {
      logger.error({ savesDir: SAVES_DIR }, "找不到存档文件，请先运行 start");
      process.exit(1);
    }

    const result = applyReveal(state, x, y);
    if (!result.ok) {
      logger.error({ x, y }, result.error);
      process.exit(1);
    }

    // 新 Monster：激活 agent（不触发推理）
    if (result.agentName) {
      activateMonsterAgent(state, result.agentName);
    }

    // CLI：阻塞等待 AI 推理（非 Monster reveal + 已有激活 agent）
    if (!result.agentName && state.agents.length > 0) {
      await triggerAgentThinking(state);
    }

    const savedPath = saveGameState(state, SAVES_DIR);
    logger.info({ x, y, tileType: result.tileType, savedPath }, "格子已揭开");

    if (result.message) {
      console.log(`✓ (${x},${y})：${result.tileType}  →  ${result.message}`);
    } else {
      console.log(`  (${x},${y}) 已揭开，无变化`);
    }

    printMap(state);
    printPlayer(state);
    printUnrevealed(state);

    const total = state.mapSize * state.mapSize;
    const revealed = state.map.flat().filter((t) => t.revealed).length;
    console.log(`\n进度：${revealed}/${total} 格已揭开`);

    if (revealed === total) {
      console.log("\n🎉 所有格子已揭开！游戏结束。");
    }
  });

program.parse();
