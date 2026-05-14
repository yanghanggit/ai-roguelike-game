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
import { createDevStage, createRandomStage } from "../src/game-stage.js";
import { initializeGame } from "../src/game.js";
import {
  applyReveal,
  activateAgent,
  getActiveAgents,
  initializeAgents,
  broadcastToAgents,
  BROADCAST_ENCOUNTERED,
  BROADCAST_PLAYER_ACTED,
} from "../src/game-actions.js";
import { AgentTask, AGENT_LOOP_MAX_ROUNDS } from "../src/agent-task.js";
import { buildTurnTaskPrompt } from "../src/prompts.js";
import { runAgentLoops } from "../src/agent-loop-runner.js";
import { queryStatusTool, strikeTool } from "../src/agent-tools.js";
import { GameAgent } from "../src/game-agent.js";
import { saveGameState, loadGameState } from "../src/game-persistence.js";
import type { GameState } from "@roguelike/shared";
import { getTileGlyph } from "@roguelike/shared";

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
  const size = state.stageSize;
  logger.info(`\n地图 ${size}×${size}  （第 ${state.turn} 回合）`);

  // 列坐标头
  logger.info("    " + Array.from({ length: size }, (_, x) => ` ${x}`).join(""));
  logger.info("   +" + "──".repeat(size) + "+");

  for (let y = 0; y < size; y++) {
    const row = state.stage.tiles[y]!;
    const cells = row.map((tile) => (tile.revealed ? ` ${getTileGlyph(tile)}` : " ?")).join("");
    logger.info(` ${y} │${cells} │`);
  }
  logger.info("   +" + "──".repeat(size) + "+");

  // 图例
  logger.info("\n图例：. # > E $ ! ?   ? = 未揭开");
  logger.info("  . 地板  # 墙  > 入口  E:名称 怪物  $ 宝箱  ! 物品  ? 特殊\n");
}

function printPlayer(state: GameState): void {
  const p = state.player;
  logger.info(
    `玩家状态：HP ${p.hp}/${p.maxHp} · ATK ${p.attack} · DEF ${p.defense} · Lv ${p.level} · XP ${p.xp}`,
  );
}

function printLog(state: GameState): void {
  logger.info("\n最近日志：");
  state.log.slice(-5).forEach((entry) => logger.info(`  ${entry.message}`));
}

function printUnrevealed(state: GameState): void {
  const unrevealed: string[] = [];
  state.stage.tiles.forEach((row, y) => {
    row.forEach((tile, x) => {
      if (!tile.revealed) unrevealed.push(`(${x},${y})`);
    });
  });
  logger.info(`\n未揭开格子 [${unrevealed.length}]：${unrevealed.join("  ")}`);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("run-agent-game")
  .description("Agent Game CLI — 每条命令是一个原子操作，状态通过 JSON 文件传递")
  .version("0.0.1")
  .option("-s, --save <path>", "要加载的存档目录路径（save 命令输出的目录）");

// ─── start ────────────────────────────────────────────────────────────────────

program
  .command("start")
  .description("创建随机新游戏，保存存档到 saves/")
  .action(async () => {
    // 创建新游戏状态，使用随机地图与初始玩家属性
    const sessionId = crypto.randomUUID();
    const state = initializeGame(sessionId, createRandomStage(4), {
      hp: 20,
      maxHp: 20,
      attack: 5,
      defense: 2,
      level: 1,
      xp: 0,
    });

    // 初始化所有 agent（当前仅有怪物），确保它们在首次被激活前已完成至少一次推理。
    await initializeAgents(state);

    // 保存当前状态为新存档，形成时间线快照
    const savedPath = saveGameState(state, SAVES_DIR);

    logger.info({ sessionId, savedPath }, "新游戏已创建");
    logger.info(`\n下次操作请传入：--save ${savedPath}`);
    printMap(state);
    printPlayer(state);
    printUnrevealed(state);
  });

// ─── start-dev ────────────────────────────────────────────────────────────────

program
  .command("start-dev")
  .description("创建固定布局开发地图（元素位置确定，便于测试与调试）")
  .action(async () => {
    // 与 start 命令类似，但使用 createDevStage 生成固定地图，便于测试与调试
    const sessionId = crypto.randomUUID();
    const state = initializeGame(sessionId, createDevStage(), {
      hp: 20,
      maxHp: 20,
      attack: 5,
      defense: 2,
      level: 1,
      xp: 0,
    });

    // 初始化所有 agent
    await initializeAgents(state);

    // 保存当前状态为新存档，形成时间线快照
    const savedPath = saveGameState(state, SAVES_DIR);

    logger.info({ sessionId, savedPath }, "【开发模式】固定地图已创建");
    logger.info(`\n下次操作请传入：--save ${savedPath}`);
    printMap(state);
    printPlayer(state);
    printUnrevealed(state);
  });

// ─── status ───────────────────────────────────────────────────────────────────

program
  .command("status")
  .description("读取当前状态，打印地图与玩家信息")
  .action(() => {
    const savePath: string | undefined = program.opts().save;
    if (!savePath) {
      logger.error("请通过 --save <path> 指定要加载的存档目录");
      process.exit(1);
    }
    let state: GameState;
    try {
      state = loadGameState(savePath);
    } catch (err) {
      logger.error({ savePath }, "无法读取存档，请检查路径是否正确");
      process.exit(1);
    }

    printMap(state);
    printPlayer(state);
    printLog(state);
    printUnrevealed(state);

    const total = state.stageSize * state.stageSize;
    const revealed = state.stage.tiles.flat().filter((t) => t.revealed).length;
    logger.info(`\n进度：${revealed}/${total} 格已揭开`);
  });

// ─── reveal ───────────────────────────────────────────────────────────────────

program
  .command("reveal <x> <y>")
  .description(
    "揭开坐标 (x, y) 的格子，激活怪物 agent，phase 切为 dungeon（对应 /game/player-action）",
  )
  .action((xStr: string, yStr: string) => {
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);

    if (isNaN(x) || isNaN(y)) {
      logger.error("x 和 y 必须是整数");
      process.exit(1);
    }

    const savePath: string | undefined = program.opts().save;
    if (!savePath) {
      logger.error("请通过 --save <path> 指定要加载的存档目录");
      process.exit(1);
    }
    let state: GameState;
    try {
      state = loadGameState(savePath);
    } catch (err) {
      logger.error({ savePath }, "无法读取存档，请检查路径是否正确");
      process.exit(1);
    }

    if (state.phase !== "player") {
      logger.error({ phase: state.phase }, "非玩家行动阶段，请先运行 dungeon-advance");
      process.exit(1);
    }

    const result = applyReveal(state, x, y);
    if (!result.ok) {
      logger.error({ x, y }, result.error);
      process.exit(1);
    }

    if (result.message) {
      // 激活 agent（若有），进入地下城行动阶段
      if (result.agentName) {
        activateAgent(state, result.agentName);
        // 广播给被揭开的怪物自身
        const encounteredAgent = state.agents[result.agentName] as unknown as GameAgent | undefined;
        if (encounteredAgent) broadcastToAgents([encounteredAgent], BROADCAST_ENCOUNTERED);
        logger.info({ agent: result.agentName }, "Monster revealed — agent activated");
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
    }

    //  保存当前状态为新存档，形成时间线快照
    const savedPath = saveGameState(state, SAVES_DIR);
    logger.info({ x, y, tileType: result.tileType, phase: state.phase, savedPath }, "格子已揭开");
    logger.info(`\n下次操作请传入：--save ${savedPath}`);

    if (result.message) {
      logger.info(`✓ (${x},${y})：${result.tileType}  →  ${result.message}`);
    } else {
      logger.info(`  (${x},${y}) 已揭开，无变化`);
    }

    printMap(state);
    printPlayer(state);
    printUnrevealed(state);

    const total = state.stageSize * state.stageSize;
    const revealed = state.stage.tiles.flat().filter((t) => t.revealed).length;
    logger.info(`\n进度：${revealed}/${total} 格已揭开`);

    if (revealed === total) {
      logger.info("\n🎉 所有格子已揭开！游戏结束。");
    }
  });

// ─── dungeon-advance ──────────────────────────────────────────────────────────

program
  .command("dungeon-advance")
  .description("触发所有已激活 agent 的 AI 推理，phase 切回 player（对应 /game/dungeon-advance）")
  .action(async () => {
    const savePath: string | undefined = program.opts().save;
    if (!savePath) {
      logger.error("请通过 --save <path> 指定要加载的存档目录");
      process.exit(1);
    }
    let state: GameState;
    try {
      // 读取指定存档，触发 agent 推理，保存新状态
      state = loadGameState(savePath);
    } catch (err) {
      logger.error({ savePath }, "无法读取存档，请检查路径是否正确");
      process.exit(1);
    }

    if (state.phase !== "dungeon") {
      logger.error({ phase: state.phase }, "非地下城行动阶段，请先运行 reveal");
      process.exit(1);
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

    // 保存当前状态为新存档，形成时间线快照
    const savedPath = saveGameState(state, SAVES_DIR);
    logger.info({ turn: state.turn, savedPath }, `地下城推进完成 — phase → "player"`);
    logger.info(`\n下次操作请传入：--save ${savedPath}`);

    printLog(state);
    printMap(state);
    printPlayer(state);
  });

program.parse();
