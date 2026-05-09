import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import fse from "fs-extra";
import { TileType } from "@roguelike/shared";
import {
  GLYPHS,
  LOG_MESSAGES,
  createRandomMap,
  createInitialState,
  applyReveal,
  saveGameState,
  loadGameState,
  loadLatestGameState,
} from "./game.js";

// ─── GLYPHS ───────────────────────────────────────────────────────────────────

describe("GLYPHS", () => {
  it("每种 TileType 都有对应的 glyph", () => {
    for (const type of Object.values(TileType)) {
      expect(GLYPHS[type]).toBeDefined();
    }
  });
});

// ─── LOG_MESSAGES ─────────────────────────────────────────────────────────────

describe("LOG_MESSAGES", () => {
  it("每种 TileType 都有对应的中文消息", () => {
    for (const type of Object.values(TileType)) {
      expect(typeof LOG_MESSAGES[type]).toBe("string");
      expect(LOG_MESSAGES[type].length).toBeGreaterThan(0);
    }
  });
});

// ─── createMap ────────────────────────────────────────────────────────────────

describe("createMap", () => {
  it("3×3 地图有正确的行列数", () => {
    const map = createRandomMap(3);
    expect(map).toHaveLength(3);
    map.forEach((row) => expect(row).toHaveLength(3));
  });

  it("4×4 地图有正确的行列数", () => {
    const map = createRandomMap(4);
    expect(map).toHaveLength(4);
    map.forEach((row) => expect(row).toHaveLength(4));
  });

  it("3×3 地图包含恰好 1 个 Entrance", () => {
    const map = createRandomMap(3);
    const count = map.flat().filter((t) => t.type === TileType.Entrance).length;
    expect(count).toBe(1);
  });

  it("4×4 地图包含恰好 2 个 Entrance", () => {
    const map = createRandomMap(4);
    const count = map.flat().filter((t) => t.type === TileType.Entrance).length;
    expect(count).toBe(2);
  });

  it("所有格子初始为未揭开（revealed=false）", () => {
    const map = createRandomMap(4);
    map.flat().forEach((tile) => expect(tile.revealed).toBe(false));
  });

  it("每个格子的 glyph 与 type 一致", () => {
    const map = createRandomMap(4);
    map.flat().forEach((tile) => {
      expect(tile.glyph).toBe(GLYPHS[tile.type]);
    });
  });

  it("所有 type 值都是合法的 TileType", () => {
    const validTypes = new Set(Object.values(TileType));
    createRandomMap(4)
      .flat()
      .forEach((tile) => expect(validTypes.has(tile.type)).toBe(true));
  });

  it("Monster 格子具有 agentName，格式为 monster-x-y", () => {
    // 多次采样确保命中 Monster 格子
    let found = false;
    for (let attempt = 0; attempt < 30 && !found; attempt++) {
      const map = createRandomMap(4);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const tile = map[y]![x]!;
          if (tile.type === TileType.Monster) {
            expect(tile.agentName).toBe(`monster-${x}-${y}`);
            found = true;
          }
        }
      }
    }
  });

  it("非 Monster 格子的 agentName 为 undefined", () => {
    let hasNonMonster = false;
    for (let attempt = 0; attempt < 30 && !hasNonMonster; attempt++) {
      const map = createRandomMap(4);
      for (const tile of map.flat()) {
        if (tile.type !== TileType.Monster) {
          expect(tile.agentName).toBeUndefined();
          hasNonMonster = true;
        }
      }
    }
  });
});

// ─── createInitialState ───────────────────────────────────────────────────────

describe("createInitialState", () => {
  it("sessionId 被正确赋值", () => {
    const state = createInitialState("abc-123");
    expect(state.sessionId).toBe("abc-123");
  });

  it("初始 turn=0、depth=1", () => {
    const state = createInitialState("s1");
    expect(state.turn).toBe(0);
    expect(state.depth).toBe(1);
  });

  it("mapSize 为 4", () => {
    const state = createInitialState("s1");
    expect(state.mapSize).toBe(4);
  });

  it("玩家初始属性正确", () => {
    const { player } = createInitialState("s1");
    expect(player.hp).toBe(20);
    expect(player.maxHp).toBe(20);
    expect(player.attack).toBe(5);
    expect(player.defense).toBe(2);
    expect(player.level).toBe(1);
    expect(player.xp).toBe(0);
  });

  it("初始日志包含欢迎消息", () => {
    const { log } = createInitialState("s1");
    expect(log).toHaveLength(1);
    expect(log[0]).toBe("欢迎来到地牢！");
  });

  it("两次调用生成不同的地图（随机性验证）", () => {
    const s1 = createInitialState("a");
    const s2 = createInitialState("b");
    // 有极低概率两张地图完全相同，但 16 格分布几乎不可能
    const types1 = s1.map.flat().map((t) => t.type).join(",");
    const types2 = s2.map.flat().map((t) => t.type).join(",");
    expect(types1).not.toBe(types2);
  });
});

// ─── applyReveal ─────────────────────────────────────────────────────────────

describe("applyReveal", () => {
  let state: ReturnType<typeof createInitialState>;

  beforeEach(() => {
    state = createInitialState("test-session");
  });

  it("揭开未揭格子：ok=true，tileType 有值，message 有值", () => {
    const result = applyReveal(state, 0, 0);
    expect(result.ok).toBe(true);
    expect(result.tileType).toBeDefined();
    expect(result.message).toBeDefined();
  });

  it("揭开后 tile.revealed 变为 true", () => {
    applyReveal(state, 1, 2);
    expect(state.map[2]![1]!.revealed).toBe(true);
  });

  it("揭开后 turn 加 1", () => {
    applyReveal(state, 0, 0);
    expect(state.turn).toBe(1);
  });

  it("连续揭开两格，turn 累加到 2", () => {
    applyReveal(state, 0, 0);
    applyReveal(state, 1, 0);
    expect(state.turn).toBe(2);
  });

  it("重复揭开同一格：ok=true 但 turn 不变，message 为 undefined", () => {
    applyReveal(state, 0, 0);
    const result = applyReveal(state, 0, 0);
    expect(result.ok).toBe(true);
    expect(result.message).toBeUndefined();
    expect(state.turn).toBe(1);
  });

  it("坐标越界：ok=false，error 有值", () => {
    const result = applyReveal(state, 99, 99);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/超出地图范围/);
  });

  it("负坐标越界：ok=false", () => {
    const result = applyReveal(state, -1, 0);
    expect(result.ok).toBe(false);
  });

  it("揭开后日志长度增加 1", () => {
    const before = state.log.length;
    applyReveal(state, 0, 0);
    expect(state.log.length).toBe(before + 1);
  });

  it("日志最多保留 20 条", () => {
    // 强制揭开所有 16 格，日志不应超过 20 条
    for (let y = 0; y < state.mapSize; y++) {
      for (let x = 0; x < state.mapSize; x++) {
        applyReveal(state, x, y);
      }
    }
    expect(state.log.length).toBeLessThanOrEqual(20);
  });

  it("揭开的 message 与该格子类型的 LOG_MESSAGES 一致", () => {
    const result = applyReveal(state, 0, 0);
    const tileType = state.map[0]![0]!.type;
    expect(result.message).toBe(LOG_MESSAGES[tileType]);
  });

  it("揭开 Monster 格子时，返回値包含 agentName", () => {
    // 强制将 (0,0) 设为 Monster 格子后揭开
    state.map[0]![0]!.type = TileType.Monster;
    (state.map[0]![0]! as import("@roguelike/shared").Tile).agentName = "monster-0-0";
    state.map[0]![0]!.glyph = GLYPHS[TileType.Monster];
    const result = applyReveal(state, 0, 0);
    expect(result.agentName).toBe("monster-0-0");
  });

  it("揭开非 Monster 格子时，返回値的 agentName 为 undefined", () => {
    // 强制将 (0,0) 设为 Floor 并清除 agentName
    state.map[0]![0]!.type = TileType.Floor;
    state.map[0]![0]!.glyph = GLYPHS[TileType.Floor];
    delete (state.map[0]![0]! as { agentName?: string }).agentName;
    const result = applyReveal(state, 0, 0);
    expect(result.agentName).toBeUndefined();
  });
});

// ─── saveGameState / loadGameState / loadLatestGameState ─────────────────────

describe("JSON persistence", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fse.mkdtempSync(path.join(os.tmpdir(), "roguelike-test-"));
  });

  it("saveGameState 写入文件并返回路径，路径包含时间戳前缀", () => {
    const state = createInitialState("persist-1");
    const filePath = saveGameState(state, tmpDir);
    expect(fse.existsSync(filePath)).toBe(true);
    expect(path.basename(filePath)).toMatch(/^game-state-.*\.json$/);
  });

  it("loadGameState 能从路径还原 GameState", () => {
    const state = createInitialState("persist-2");
    const filePath = saveGameState(state, tmpDir);
    const loaded = loadGameState(filePath);
    expect(loaded.sessionId).toBe("persist-2");
    expect(loaded.mapSize).toBe(4);
    expect(loaded.player.hp).toBe(20);
  });

  it("保存后再修改状态，loadGameState 读出的仍是保存时的快照", () => {
    const state = createInitialState("snapshot-test");
    const filePath = saveGameState(state, tmpDir);
    applyReveal(state, 0, 0); // 修改内存中的 state
    const loaded = loadGameState(filePath);
    expect(loaded.turn).toBe(0); // 快照中 turn 还是 0
  });

  it("loadLatestGameState 读取最新文件", async () => {
    const s1 = createInitialState("first");
    const s2 = createInitialState("second");
    saveGameState(s1, tmpDir);
    // 保证时间戳不同（文件名毫秒级）
    await new Promise((r) => setTimeout(r, 5));
    saveGameState(s2, tmpDir);
    const latest = loadLatestGameState(tmpDir);
    expect(latest.sessionId).toBe("second");
  });

  it("loadLatestGameState 在目录为空时抛出错误", () => {
    expect(() => loadLatestGameState(tmpDir)).toThrow();
  });

  it("saveGameState 若目录不存在则自动创建", () => {
    const nestedDir = path.join(tmpDir, "deep", "nested");
    const state = createInitialState("nested");
    saveGameState(state, nestedDir);
    expect(fse.readdirSync(nestedDir).length).toBeGreaterThan(0);
  });

  it("多次 save 产生多个文件", async () => {
    const state = createInitialState("multi");
    saveGameState(state, tmpDir);
    await new Promise((r) => setTimeout(r, 5));
    applyReveal(state, 0, 0);
    saveGameState(state, tmpDir);
    const files = fse.readdirSync(tmpDir);
    expect(files.length).toBe(2);
  });
});
