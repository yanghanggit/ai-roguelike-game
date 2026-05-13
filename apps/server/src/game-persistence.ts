/**
 * GameState JSON 持久化层。
 *
 * 提供带时间戳的存档目录写入、按路径读取与读取最新存档。
 * 与游戏逻辑解耦，可被 Express 路由、CLI 脚本独立引用。
 *
 * 每条存档为一个目录，内含：
 *   - `state.json`          — 完整 GameState，加载时的唯一来源。
 *   - `{agentKey}.json`     — 每个 agent 的序列化快照（仅供调试/查看）。
 *   - `{agentKey}_buffer.md`— 每个 agent 上下文的可读文本（仅供调试/查看）。
 */

import * as path from "node:path";
import fse from "fs-extra";
import type { GameState, AgentMessage } from "@roguelike/shared";
import { GameAgent } from "./ai/game-agent.js";
import { getBufferString, type ContextMessage } from "./ai/messages.js";

/** 生成带时间戳的存档目录名，格式：`game-state-20260509T143857-123`。 */
function makeTimestampedDirname(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
  return `game-state-${ts}`;
}

/**
 * 将 `GameState` 保存为带时间戳的目录（`savesDir` 不存在时自动创建）。
 *
 * 目录内写入：
 * - `state.json` — 完整 GameState，用于加载恢复。
 * - `{agentKey}.json` — 每个 agent 的序列化快照。
 * - `{agentKey}_buffer.md` — 每个 agent 上下文的可读文本，AI 前缀为 `agent.name`。
 *
 * @param state - 要持久化的游戏状态。
 * @param savesDir - 存档根目录路径；不存在时会自动创建。
 * @returns 实际写入的存档目录绝对路径。
 */
export function saveGameState(state: GameState, savesDir: string): string {
  const saveDir = path.join(savesDir, makeTimestampedDirname());
  fse.ensureDirSync(saveDir);

  fse.outputJsonSync(path.join(saveDir, "state.json"), state, { spaces: 2 });

  for (const [key, agent] of Object.entries(state.agents)) {
    fse.outputJsonSync(path.join(saveDir, `${key}.json`), agent, { spaces: 2 });
    const buffer = getBufferString(agent.context, "Human", agent.name);
    fse.outputFileSync(path.join(saveDir, `${key}_buffer.md`), buffer, "utf8");
  }

  return saveDir;
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
 * 从指定存档目录加载存档，适合已知目录名时的精确读取。
 *
 * @param folderPath - 存档目录的绝对或相对路径。
 * @returns 反序列化后的 `GameState` 对象（agents 已重建为 class 实例）。
 */
export function loadGameState(folderPath: string): GameState {
  return reconstructAgents(fse.readJsonSync(path.join(folderPath, "state.json")) as GameState);
}

/**
 * 从 `savesDir` 中读取最新的存档目录。
 *
 * 按字典序排序目录名，ISO 时间戳天然可按时间排序。
 * 目录为空时抛出错误。
 *
 * @param savesDir - 存档根目录路径。
 * @returns 最新存档反序列化后的 `GameState` 对象（agents 已重建为 class 实例）。
 * @throws 若目录中不存在符合命名规则的存档目录。
 */
export function loadLatestGameState(savesDir: string): GameState {
  const dirs = fse
    .readdirSync(savesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("game-state-"))
    .map((d) => d.name)
    .sort();
  if (dirs.length === 0) {
    throw new Error(`saves 目录中没有找到存档目录：${savesDir}`);
  }
  const latest = dirs[dirs.length - 1]!;
  return loadGameState(path.join(savesDir, latest));
}
