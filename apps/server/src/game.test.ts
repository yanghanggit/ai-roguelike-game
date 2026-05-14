import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import fse from "fs-extra";
import { TileType } from "@roguelike/shared";
import { GLYPHS, LOG_MESSAGES, createRandomStage, createDevStage } from "./game-stage.js";
import { Actor } from "./actor.js";
import { initializeGame } from "./game.js";
import { applyReveal, activateAgent, getActiveAgents } from "./game-actions.js";
import { AgentTask, AGENT_LOOP_MAX_ROUNDS } from "./agent-task.js";
import { buildTurnTaskPrompt } from "./prompts.js";
import { runAgentLoops } from "./agent-loop-runner.js";
import { queryStatusTool, strikeTool } from "./agent-tools.js";

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

// ─── createRandomStage ────────────────────────────────────────────────────────

describe("createRandomStage", () => {
  it("3×3 地图有正确的行列数", () => {
    const stage = createRandomStage(3);
    expect(stage.tiles).toHaveLength(3);
    stage.tiles.forEach((row) => expect(row).toHaveLength(3));
  });

  it("4×4 地图有正确的行列数", () => {
    const stage = createRandomStage(4);
    expect(stage.tiles).toHaveLength(4);
    stage.tiles.forEach((row) => expect(row).toHaveLength(4));
  });

  it("3×3 地图包含恰好 1 个 Entrance", () => {
    const stage = createRandomStage(3);
    const count = stage.tiles.flat().filter((t) => t.type === TileType.Entrance).length;
    expect(count).toBe(1);
  });

  it("4×4 地图包含恰好 2 个 Entrance", () => {
    const stage = createRandomStage(4);
    const count = stage.tiles.flat().filter((t) => t.type === TileType.Entrance).length;
    expect(count).toBe(2);
  });

  it("所有格子初始为未揭开（revealed=false）", () => {
    const stage = createRandomStage(4);
    stage.tiles.flat().forEach((tile) => expect(tile.revealed).toBe(false));
  });

  it("每个格子的 glyph 与 type 一致", () => {
    const stage = createRandomStage(4);
    stage.tiles.flat().forEach((tile) => {
      expect(tile.glyph).toBe(GLYPHS[tile.type]);
    });
  });

  it("所有 type 值都是合法的 TileType", () => {
    const validTypes = new Set(Object.values(TileType));
    createRandomStage(4)
      .tiles.flat()
      .forEach((tile) => expect(validTypes.has(tile.type)).toBe(true));
  });

  it("Monster 格子具有 actor，其 name 格式为 monster-x-y", () => {
    // 多次采样确保命中 Monster 格子
    let found = false;
    for (let attempt = 0; attempt < 30 && !found; attempt++) {
      const stage = createRandomStage(4);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const tile = stage.tiles[y]![x]!;
          if (tile.type === TileType.Monster) {
            expect(tile.actor?.name).toBe(`monster-${x}-${y}`);
            found = true;
          }
        }
      }
    }
  });

  it("非 Monster 格子的 actor 为 undefined", () => {
    let hasNonMonster = false;
    for (let attempt = 0; attempt < 30 && !hasNonMonster; attempt++) {
      const stage = createRandomStage(4);
      for (const tile of stage.tiles.flat()) {
        if (tile.type !== TileType.Monster) {
          expect(tile.actor).toBeUndefined();
          hasNonMonster = true;
        }
      }
    }
  });
});

// ─── createInitialState ───────────────────────────────────────────────────────

describe("createInitialState", () => {
  it("sessionId 被正确赋值", () => {
    const state = initializeGame("abc-123", createRandomStage(4), DEFAULT_PLAYER);
    expect(state.sessionId).toBe("abc-123");
  });

  it("初始 turn=0、phase=player", () => {
    const state = initializeGame("s1", createRandomStage(4), DEFAULT_PLAYER);
    expect(state.turn).toBe(0);
    expect(state.phase).toBe("player");
  });

  it("stageSize 为 4", () => {
    const state = initializeGame("s1", createRandomStage(4), DEFAULT_PLAYER);
    expect(state.stageSize).toBe(4);
  });

  it("玩家初始属性与传入一致", () => {
    const { player } = initializeGame("s1", createRandomStage(4), DEFAULT_PLAYER);
    expect(player).toEqual(DEFAULT_PLAYER);
  });

  it("初始日志为空", () => {
    const { log } = initializeGame("s1", createRandomStage(4), DEFAULT_PLAYER);
    expect(log).toHaveLength(0);
  });

  it("两次调用生成不同的地图（随机性验证）", () => {
    const s1 = initializeGame("a", createRandomStage(4), DEFAULT_PLAYER);
    const s2 = initializeGame("b", createRandomStage(4), DEFAULT_PLAYER);
    // 有极低概率两张地图完全相同，但 16 格分布几乎不可能
    const types1 = s1.stage.tiles
      .flat()
      .map((t) => t.type)
      .join(",");
    const types2 = s2.stage.tiles
      .flat()
      .map((t) => t.type)
      .join(",");
    expect(types1).not.toBe(types2);
  });
});

// ─── applyReveal ─────────────────────────────────────────────────────────────

describe("applyReveal", () => {
  let state: ReturnType<typeof initializeGame>;

  beforeEach(() => {
    state = initializeGame("test-session", createRandomStage(4), DEFAULT_PLAYER);
  });

  it("揭开未揭格子：ok=true，tileType 有值，message 有值", () => {
    const result = applyReveal(state, 0, 0);
    expect(result.ok).toBe(true);
    expect(result.tileType).toBeDefined();
    expect(result.message).toBeDefined();
  });

  it("揭开后 tile.revealed 变为 true", () => {
    applyReveal(state, 1, 2);
    expect(state.stage.tiles[2]![1]!.revealed).toBe(true);
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
    for (let y = 0; y < state.stageSize; y++) {
      for (let x = 0; x < state.stageSize; x++) {
        applyReveal(state, x, y);
      }
    }
    expect(state.log.length).toBe(16);
  });

  it("揭开的 message 以该格子类型的 LOG_MESSAGES 开头", () => {
    const result = applyReveal(state, 0, 0);
    const tileType = state.stage.tiles[0]![0]!.type;
    expect(result.message).toContain(LOG_MESSAGES[tileType]);
  });

  it("揭开 Monster 格子时，返回値包含 agentName", () => {
    // 强制将 (0,0) 设为 Monster 格子后揭开
    state.stage.tiles[0]![0]!.type = TileType.Monster;
    state.stage.tiles[0]![0]!.actor = new Actor("monster-0-0");
    state.stage.tiles[0]![0]!.glyph = GLYPHS[TileType.Monster];
    const result = applyReveal(state, 0, 0);
    expect(result.agentName).toBe("monster-0-0");
  });

  it("揭开非 Monster 格子时，返回値的 agentName 为 undefined", () => {
    // 强制将 (0,0) 设为 Floor 并清除 actor
    state.stage.tiles[0]![0]!.type = TileType.Floor;
    state.stage.tiles[0]![0]!.glyph = GLYPHS[TileType.Floor];
    delete state.stage.tiles[0]![0]!.actor;
    const result = applyReveal(state, 0, 0);
    expect(result.agentName).toBeUndefined();
  });
});

// ─── activateMonsterAgent ────────────────────────────────────────────────────────────────

describe("activateMonsterAgent", () => {
  it("将指定名称的 GameAgent 设为 激活", () => {
    const state = initializeGame("s", createDevStage(), DEFAULT_PLAYER);
    // dev 地图中 monster 在 (0,1)，actor.name = "monster-0-1"
    expect(state.activatedTurns["monster-0-1"]).toBeUndefined();
    activateAgent(state, "monster-0-1");
    expect(state.activatedTurns["monster-0-1"]).toBeDefined();
  });

  it("重复激活同一 agent 不会增加数量", () => {
    const state = initializeGame("s", createDevStage(), DEFAULT_PLAYER);
    const countBefore = Object.keys(state.agents).length;
    activateAgent(state, "monster-0-1");
    activateAgent(state, "monster-0-1");
    expect(Object.keys(state.agents).length).toBe(countBefore);
    expect(state.activatedTurns["monster-0-1"]).toBeDefined();
  });

  it("初始 state 的 agents 包含地图中所有怪物（均未激活）", () => {
    const state = initializeGame("s", createDevStage(), DEFAULT_PLAYER);
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

  it("agents 均未激活时什么都不做，log 不变", () => {
    const state = initializeGame("s", createDevStage(), DEFAULT_PLAYER);
    // 地图已有 agent 但均未激活
    const logBefore = [...state.log];
    // getActiveAgents 返回空列表，调用方不应调用 runAgentLoops（合约：非空才调用）
    expect(getActiveAgents(state)).toHaveLength(0);
    expect(state.log).toEqual(logBefore);
  });

  it("AI 行动内容被追加到 state.log", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_001",
                    type: "function",
                    function: {
                      name: "strike",
                      arguments: JSON.stringify({ target: "player", summary: "怪物发动攻击！" }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 0,
          },
        }),
      }),
    );

    const state = initializeGame("s", createDevStage(), DEFAULT_PLAYER);
    // dev 地图 monster 在 (0,1)，先揭开让 turn > 0
    applyReveal(state, 0, 1);
    activateAgent(state, "monster-0-1");
    // turn=1 时被激活，需 turn=2 才能行动
    state.turn = 2;

    const task = new AgentTask({
      prompt: buildTurnTaskPrompt(state.turn),
      tools: [queryStatusTool, strikeTool],
      maxRounds: AGENT_LOOP_MAX_ROUNDS,
    });
    await runAgentLoops(getActiveAgents(state), task, state);
    expect(state.log[state.log.length - 1]!.message).toBe("骷髅战士：怪物发动攻击！");
  });

  it("多个 agent 的 AI 行动全部追加到 log", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount++;
        const summary = callCount === 1 ? "怪物A攻击！" : "怪物B防御！";
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: `call_00${callCount}`,
                      type: "function",
                      function: {
                        name: "strike",
                        arguments: JSON.stringify({ target: "player", summary }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
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

    const state = initializeGame("s", createDevStage(), DEFAULT_PLAYER);
    activateAgent(state, "monster-0-1");
    // monster-1-1 不在 dev 地图中，手动向 agents 预插入一个测试用 agent
    const { GameAgent: GA } = await import("./ai/index.js");
    state.agents["monster-1-1"] = new GA("怪物.测试怪物", "测试系统提示");
    state.activatedTurns["monster-1-1"] = 0;
    // 两者均在 turn=0 时被激活，需 turn 消进到 1 才能行动
    state.turn = 1;
    const task = new AgentTask({
      prompt: buildTurnTaskPrompt(state.turn),
      tools: [queryStatusTool, strikeTool],
      maxRounds: AGENT_LOOP_MAX_ROUNDS,
    });
    await runAgentLoops(getActiveAgents(state), task, state);
    expect(state.log.map((e) => e.message)).toContain("骷髅战士：怪物A攻击！");
    expect(state.log.map((e) => e.message)).toContain("测试怪物：怪物B防御！");
  });

  it("AI 行动内容追加到 log 后总长度增加", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_001",
                    type: "function",
                    function: {
                      name: "strike",
                      arguments: JSON.stringify({ target: "player", summary: "AI 行动" }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 0,
          },
        }),
      }),
    );

    const state = initializeGame("s", createDevStage(), DEFAULT_PLAYER);
    activateAgent(state, "monster-0-1");
    // turn=0 被激活，需 turn=1 才能行动
    state.turn = 1;
    const logBefore = state.log.length;
    const task = new AgentTask({
      prompt: buildTurnTaskPrompt(state.turn),
      tools: [queryStatusTool, strikeTool],
      maxRounds: AGENT_LOOP_MAX_ROUNDS,
    });
    await runAgentLoops(getActiveAgents(state), task, state);
    expect(state.log.length).toBeGreaterThan(logBefore);
  });
});
