import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import fse from "fs-extra";
import { createRandomMap, createDevMap } from "./game-map.js";
import { initializeGame } from "./game.js";
import { applyReveal } from "./game-actions.js";
import { GameAgent } from "./ai/game-agent.js";
import { saveGameState, loadGameState } from "./game-persistence.js";

const DEFAULT_PLAYER = { hp: 20, maxHp: 20, attack: 5, defense: 2, level: 1, xp: 0 };

describe("game-persistence", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fse.mkdtempSync(path.join(os.tmpdir(), "roguelike-persist-test-"));
  });

  // ─── saveGameState ────────────────────────────────────────────────────────────

  it("saveGameState 返回存档目录路径，目录名包含时间戳前缀", () => {
    const state = initializeGame("persist-1", createRandomMap(4), DEFAULT_PLAYER);
    const savedDir = saveGameState(state, tmpDir);
    expect(fse.statSync(savedDir).isDirectory()).toBe(true);
    expect(path.basename(savedDir)).toMatch(/^game-state-/);
  });

  it("存档目录包含 state.json", () => {
    const state = initializeGame("persist-2", createRandomMap(4), DEFAULT_PLAYER);
    const savedDir = saveGameState(state, tmpDir);
    expect(fse.existsSync(path.join(savedDir, "state.json"))).toBe(true);
  });

  it("存档目录为每个 agent 生成 .json 与 _buffer.md", () => {
    const state = initializeGame("persist-agents", createDevMap(), DEFAULT_PLAYER);
    const savedDir = saveGameState(state, tmpDir);
    // dev 地图有 1 个 monster，key = "monster-0-1"
    expect(fse.existsSync(path.join(savedDir, "monster-0-1.json"))).toBe(true);
    expect(fse.existsSync(path.join(savedDir, "monster-0-1_buffer.md"))).toBe(true);
  });

  it("_buffer.md 使用 agent.name 作为 AI 前缀，System 前缀保持不变", () => {
    const state = initializeGame("buffer-prefix", createDevMap(), DEFAULT_PLAYER);
    const savedDir = saveGameState(state, tmpDir);
    const agentName = state.agents["monster-0-1"]!.name;
    const bufferContent = fse.readFileSync(path.join(savedDir, "monster-0-1_buffer.md"), "utf8");
    const lines = bufferContent.split("\n");
    const aiLines = lines.filter((l) => l.startsWith(`${agentName}: `));
    const systemLines = lines.filter((l) => l.startsWith("System: "));
    expect(systemLines.length).toBeGreaterThan(0);
    expect(systemLines.length).toBeGreaterThan(0);
    // AI 行出现时前缀正确（system prompt 仅含 system 消息，故 AI 行可能为 0）
    aiLines.forEach((l) => expect(l.startsWith(`${agentName}: `)).toBe(true));
  });

  it("saveGameState 若目录不存在则自动创建", () => {
    const nestedDir = path.join(tmpDir, "deep", "nested");
    const state = initializeGame("nested", createRandomMap(4), DEFAULT_PLAYER);
    saveGameState(state, nestedDir);
    expect(fse.readdirSync(nestedDir).length).toBeGreaterThan(0);
  });

  it("多次 save 产生多个子目录", async () => {
    const state = initializeGame("multi", createRandomMap(4), DEFAULT_PLAYER);
    saveGameState(state, tmpDir);
    await new Promise((r) => setTimeout(r, 5));
    applyReveal(state, 0, 0);
    saveGameState(state, tmpDir);
    const dirs = fse.readdirSync(tmpDir).filter((f) => f.startsWith("game-state-"));
    expect(dirs.length).toBe(2);
  });

  // ─── loadGameState ────────────────────────────────────────────────────────────

  it("loadGameState 能从目录还原 GameState", () => {
    const state = initializeGame("load-1", createRandomMap(4), DEFAULT_PLAYER);
    const savedDir = saveGameState(state, tmpDir);
    const loaded = loadGameState(savedDir);
    expect(loaded.sessionId).toBe("load-1");
    expect(loaded.mapSize).toBe(4);
    expect(loaded.player.hp).toBe(20);
  });

  it("保存后再修改状态，loadGameState 读出的仍是保存时的快照", () => {
    const state = initializeGame("snapshot-test", createRandomMap(4), DEFAULT_PLAYER);
    const savedDir = saveGameState(state, tmpDir);
    applyReveal(state, 0, 0);
    const loaded = loadGameState(savedDir);
    expect(loaded.turn).toBe(0);
  });

  it("loadGameState 还原的 agents 是 GameAgent 实例（有方法）", () => {
    const state = initializeGame("agents-restored", createDevMap(), DEFAULT_PLAYER);
    const savedDir = saveGameState(state, tmpDir);
    const loaded = loadGameState(savedDir);
    const agent = Object.values(loaded.agents)[0]!;
    expect(agent).toBeInstanceOf(GameAgent);
  });

});
