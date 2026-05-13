/**
 * GameState JSON 持久化层。
 *
 * 提供带时间戳的存档写入、按路径读取与读取最新存档。
 * 与游戏逻辑解耦，可被 Express 路由、CLI 脚本独立引用。
 */

import * as path from "node:path";
import fse from "fs-extra";
import type { GameState, AgentMessage } from "@roguelike/shared";
import { GameAgent } from "./ai/game-agent.js";
import type { ContextMessage } from "./ai/messages.js";

/** 生成带时间戳的存档文件名，格式：`game-state-20260509T143857-123.json`。 */
function makeTimestampedFilename(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
  return `game-state-${ts}.json`;
}

/**
 * 将 `GameState` 保存为带时间戳的 JSON 文件（`savesDir` 不存在时自动创建）。
 *
 * @param state - 要持久化的游戏状态。
 * @param savesDir - 存档目录路径；不存在时会自动创建。
 * @returns 实际写入的文件绝对路径。
 */
export function saveGameState(state: GameState, savesDir: string): string {
  const filePath = path.join(savesDir, makeTimestampedFilename());
  fse.outputJsonSync(filePath, state, { spaces: 2 });
  return filePath;
}

/**
 * 将 JSON 中的 agents 纯对象重建为 `GameAgent` class 实例，使其携带方法（`addHumanMessage` 等）。
 * 存档中的 agents 经 `toJSON()` 序列化为 `{name, context}`，加载后须执行此重建。
 */
function reconstructAgents(state: GameState): GameState {
  for (const [key, raw] of Object.entries(state.agents)) {
    const context = (raw as { context: readonly AgentMessage[] })
      .context as unknown as ContextMessage[];
    state.agents[key] = GameAgent.fromRaw((raw as { name: string }).name, context);
  }
  return state;
}

/**
 * 从指定路径加载存档，适合已知文件名时的精确读取。
 *
 * @param filePath - 存档文件的绝对或相对路径。
 * @returns 反序列化后的 `GameState` 对象（agents 已重建为 class 实例）。
 */
export function loadGameState(filePath: string): GameState {
  return reconstructAgents(fse.readJsonSync(filePath) as GameState);
}

/**
 * 从 `savesDir` 中读取最新的存档文件。
 *
 * 按字典序排序文件名，ISO 时间戳天然可按时间排序。
 * 目录为空时抛出错误。
 *
 * @param savesDir - 存档目录路径。
 * @returns 最新存档反序列化后的 `GameState` 对象（agents 已重建为 class 实例）。
 * @throws 若目录中不存在符合命名规则的存档文件。
 */
export function loadLatestGameState(savesDir: string): GameState {
  const files = fse
    .readdirSync(savesDir)
    .filter((f) => f.startsWith("game-state-") && f.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new Error(`saves 目录中没有找到存档文件：${savesDir}`);
  }
  const latest = files[files.length - 1]!;
  return reconstructAgents(fse.readJsonSync(path.join(savesDir, latest)) as GameState);
}
