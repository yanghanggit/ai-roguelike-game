import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import fse from "fs-extra";
import { TileType } from "@roguelike/shared";
import { GLYPHS, LOG_MESSAGES, createRandomMap, createDevMap } from "./game-map.js";
import { createInitialState } from "./game.js";
import { applyReveal, activateAgent, runAgentLoops } from "./game-actions.js";
import { saveGameState, loadGameState, loadLatestGameState } from "./game-persistence.js";

const DEFAULT_PLAYER = { hp: 20, maxHp: 20, attack: 5, defense: 2, level: 1, xp: 0 };

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
    const state = createInitialState("abc-123", createRandomMap(4), DEFAULT_PLAYER);
    expect(state.sessionId).toBe("abc-123");
  });

  it("初始 turn=0、phase=player", () => {
    const state = createInitialState("s1", createRandomMap(4), DEFAULT_PLAYER);
    expect(state.turn).toBe(0);
    expect(state.phase).toBe("player");
  });

  it("mapSize 为 4", () => {
    const state = createInitialState("s1", createRandomMap(4), DEFAULT_PLAYER);
    expect(state.mapSize).toBe(4);
  });

  it("玩家初始属性与传入一致", () => {
    const { player } = createInitialState("s1", createRandomMap(4), DEFAULT_PLAYER);
    expect(player).toEqual(DEFAULT_PLAYER);
  });

  it("初始日志为空", () => {
    const { log } = createInitialState("s1", createRandomMap(4), DEFAULT_PLAYER);
    expect(log).toHaveLength(0);
  });

  it("两次调用生成不同的地图（随机性验证）", () => {
    const s1 = createInitialState("a", createRandomMap(4), DEFAULT_PLAYER);
    const s2 = createInitialState("b", createRandomMap(4), DEFAULT_PLAYER);
    // 有极低概率两张地图完全相同，但 16 格分布几乎不可能
    const types1 = s1.map
      .flat()
      .map((t) => t.type)
      .join(",");
    const types2 = s2.map
      .flat()
      .map((t) => t.type)
      .join(",");
    expect(types1).not.toBe(types2);
  });
});

// ─── applyReveal ─────────────────────────────────────────────────────────────

describe("applyReveal", () => {
  let state: ReturnType<typeof createInitialState>;

  beforeEach(() => {
    state = createInitialState("test-session", createRandomMap(4), DEFAULT_PLAYER);
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

  it("揭开所有格子后日志完整保留所有条目", () => {
    // 初始 0 条 + 16 格各 1 条 = 16 条，全部保留不截断
    for (let y = 0; y < state.mapSize; y++) {
      for (let x = 0; x < state.mapSize; x++) {
        applyReveal(state, x, y);
      }
    }
    expect(state.log.length).toBe(16);
  });

  it("揭开的 message 以该格子类型的 LOG_MESSAGES 开头", () => {
    const result = applyReveal(state, 0, 0);
    const tileType = state.map[0]![0]!.type;
    expect(result.message).toContain(LOG_MESSAGES[tileType]);
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
    const state = createInitialState("persist-1", createRandomMap(4), DEFAULT_PLAYER);
    const filePath = saveGameState(state, tmpDir);
    expect(fse.existsSync(filePath)).toBe(true);
    expect(path.basename(filePath)).toMatch(/^game-state-.*\.json$/);
  });

  it("loadGameState 能从路径还原 GameState", () => {
    const state = createInitialState("persist-2", createRandomMap(4), DEFAULT_PLAYER);
    const filePath = saveGameState(state, tmpDir);
    const loaded = loadGameState(filePath);
    expect(loaded.sessionId).toBe("persist-2");
    expect(loaded.mapSize).toBe(4);
    expect(loaded.player.hp).toBe(20);
  });

  it("保存后再修改状态，loadGameState 读出的仍是保存时的快照", () => {
    const state = createInitialState("snapshot-test", createRandomMap(4), DEFAULT_PLAYER);
    const filePath = saveGameState(state, tmpDir);
    applyReveal(state, 0, 0); // 修改内存中的 state
    const loaded = loadGameState(filePath);
    expect(loaded.turn).toBe(0); // 快照中 turn 还是 0
  });

  it("loadLatestGameState 读取最新文件", async () => {
    const s1 = createInitialState("first", createRandomMap(4), DEFAULT_PLAYER);
    const s2 = createInitialState("second", createRandomMap(4), DEFAULT_PLAYER);
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
    const state = createInitialState("nested", createRandomMap(4), DEFAULT_PLAYER);
    saveGameState(state, nestedDir);
    expect(fse.readdirSync(nestedDir).length).toBeGreaterThan(0);
  });

  it("多次 save 产生多个文件", async () => {
    const state = createInitialState("multi", createRandomMap(4), DEFAULT_PLAYER);
    saveGameState(state, tmpDir);
    await new Promise((r) => setTimeout(r, 5));
    applyReveal(state, 0, 0);
    saveGameState(state, tmpDir);
    const files = fse.readdirSync(tmpDir);
    expect(files.length).toBe(2);
  });
});

// ─── activateMonsterAgent ────────────────────────────────────────────────────────────────

describe("activateMonsterAgent", () => {
  it("将指定 agentName 的 GameAgent 设为 激活", () => {
    const state = createInitialState("s", createDevMap(), DEFAULT_PLAYER);
    // dev 地图中 monster 在 (0,1)，agentName = "monster-0-1"
    expect(state.activatedTurns["monster-0-1"]).toBeUndefined();
    activateAgent(state, "monster-0-1");
    expect(state.activatedTurns["monster-0-1"]).toBeDefined();
  });

  it("重复激活同一 agent 不会增加数量", () => {
    const state = createInitialState("s", createDevMap(), DEFAULT_PLAYER);
    const countBefore = Object.keys(state.agents).length;
    activateAgent(state, "monster-0-1");
    activateAgent(state, "monster-0-1");
    expect(Object.keys(state.agents).length).toBe(countBefore);
    expect(state.activatedTurns["monster-0-1"]).toBeDefined();
  });

  it("初始 state 的 agents 包含地图中所有怪物（均未激活）", () => {
    const state = createInitialState("s", createDevMap(), DEFAULT_PLAYER);
    // dev 地图有 1 个 monster (0,1)
    expect(Object.keys(state.agents)).toHaveLength(1);
    expect(Object.keys(state.activatedTurns)).toHaveLength(0);
  });
});

// ─── triggerAgentThinking ───────────────────────────────────────────────────────────────

describe("triggerAgentThinking", () => {
  beforeEach(() => {
    process.env["DEEPSEEK_API_KEY"] = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["DEEPSEEK_API_KEY"];
  });

  it("agents 均未激活时什么都不做，log 不变", async () => {
    const state = createInitialState("s", createDevMap(), DEFAULT_PLAYER);
    // 地图已有 agent 但均未激活
    const logBefore = [...state.log];
    await runAgentLoops(state, "第 1 回合，玩家揭开了一个新格子。");
    expect(state.log).toEqual(logBefore);
  });

  it("AI 行动内容被追加到 state.log", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "怪物发动攻击！" } }],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 0,
          },
        }),
      }),
    );

    const state = createInitialState("s", createDevMap(), DEFAULT_PLAYER);
    // dev 地图 monster 在 (0,1)，先揭开让 turn > 0
    applyReveal(state, 0, 1);
    activateAgent(state, "monster-0-1");
    // turn=1 时被激活，需 turn=2 才能行动
    state.turn = 2;

    await runAgentLoops(state, `第 ${state.turn} 回合，玩家揭开了一个新格子。`);
    expect(state.log[state.log.length - 1]!.message).toBe("骷髅战士：怪物发动攻击！");
  });

  it("多个 agent 的 AI 行动全部追加到 log", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount++;
        const content = callCount === 1 ? "怪物A攻击！" : "怪物B防御！";
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content } }],
            usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              prompt_cache_hit_tokens: 0,
              prompt_cache_miss_tokens: 0,
            },
          }),
        };
      }),
    );

    const state = createInitialState("s", createDevMap(), DEFAULT_PLAYER);
    activateAgent(state, "monster-0-1");
    // monster-1-1 不在 dev 地图中，手动向 agents 预插入一个测试用 agent
    const { GameAgent: GA } = await import("./ai/index.js");
    state.agents["monster-1-1"] = new GA("怪物.测试怪物", "测试系统提示");
    state.activatedTurns["monster-1-1"] = 0;
    // 两者均在 turn=0 时被激活，需 turn 消进到 1 才能行动
    state.turn = 1;
    await runAgentLoops(state, `第 ${state.turn} 回合，玩家揭开了一个新格子。`);
    expect(state.log.map((e) => e.message)).toContain("骷髅战士：怪物A攻击！");
    expect(state.log.map((e) => e.message)).toContain("测试怪物：怪物B防御！");
  });

  it("AI 行动内容追加到 log 后总长度增加", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "AI 行动" } }],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 0,
          },
        }),
      }),
    );

    const state = createInitialState("s", createDevMap(), DEFAULT_PLAYER);
    activateAgent(state, "monster-0-1");
    // turn=0 被激活，需 turn=1 才能行动
    state.turn = 1;
    const logBefore = state.log.length;
    await runAgentLoops(state, `第 ${state.turn} 回合，玩家揭开了一个新格子。`);
    expect(state.log.length).toBeGreaterThan(logBefore);
  });
});
