/**
 * GameState JSON 持久化层
 *
 * 负责：带时间戳的存档写入、按路径读取、读取最新存档。
 * 与游戏逻辑解耦，可被 Express 路由、CLI 脚本独立引用。
 */

import * as path from "node:path";
import fse from "fs-extra";
import type { GameState } from "@roguelike/shared";

/** 生成带时间戳的存档文件名，格式：game-state-20260509T143857-123.json */
function makeTimestampedFilename(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
  return `game-state-${ts}.json`;
}

/**
 * 将 GameState 保存为带时间戳的 JSON 文件（自动创建 savesDir）。
 * 返回实际写入的文件路径。
 */
export function saveGameState(state: GameState, savesDir: string): string {
  const filePath = path.join(savesDir, makeTimestampedFilename());
  fse.outputJsonSync(filePath, state, { spaces: 2 });
  return filePath;
}

/** 从指定路径直接读取存档（供单次精确加载使用） */
export function loadGameState(filePath: string): GameState {
  return fse.readJsonSync(filePath) as GameState;
}

/**
 * 从 savesDir 中读取最新的存档文件。
 * 文件名按字典序排序，ISO 时间戳天然可排序。
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
  return fse.readJsonSync(path.join(savesDir, latest)) as GameState;
}
