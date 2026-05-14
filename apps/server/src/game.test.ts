import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import fse from "fs-extra";
import {
  TerrainType,
  ActorType,
  getTileGlyph,
  TERRAIN_GLYPHS,
  ACTOR_GLYPH,
  SPECIAL_GLYPH,
  ITEM_GLYPH,
} from "@roguelike/shared";
import {
  TERRAIN_LOG_MESSAGES,
  ACTOR_LOG_MESSAGE,
  SPECIAL_LOG_MESSAGE,
  ITEM_LOG_MESSAGE,
  createStage,
  DEV_STAGE_LAYOUT,
} from "./game-stage.js";
import { initializeGame } from "./game.js";
import { applyReveal, activateAgent, getActiveAgents } from "./game-actions.js";
import { AgentTask, AGENT_LOOP_MAX_ROUNDS } from "./agent-task.js";
import { buildTurnTaskPrompt } from "./prompts.js";
import { runAgentLoops } from "./agent-loop-runner.js";
import { queryStatusTool, strikeTool } from "./agent-tools.js";

const DEFAULT_PLAYER = { hp: 20, maxHp: 20, attack: 5, defense: 2, level: 1, xp: 0 };

// ─── TERRAIN_GLYPHS ─────────────────────────────────────────────────────

describe("TERRAIN_GLYPHS", () => {
  it("每种 TerrainType 都有对应的 glyph", () => {
    for (const type of Object.values(TerrainType)) {
      expect(TERRAIN_GLYPHS[type]).toBeDefined();
    }
  });
});

// ─── LOG_MESSAGES ─────────────────────────────────────────────────────

describe("LOG_MESSAGES", () => {
  it("每种 TerrainType 都有对应的中文消息", () => {
    for (const type of Object.values(TerrainType)) {
      expect(typeof TERRAIN_LOG_MESSAGES[type]).toBe("string");
      expect(TERRAIN_LOG_MESSAGES[type].length).toBeGreaterThan(0);
    }
  });

  it("每种占有者类型都有对应的中文消息", () => {
    for (const msg of [ACTOR_LOG_MESSAGE, ITEM_LOG_MESSAGE, SPECIAL_LOG_MESSAGE]) {
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});

// ─── createStage ────────────────────────────────────────────────────────────

describe("createStage", () => {
  it("3×3 地图有正确的行列数", () => {
    const stage = createStage(DEV_STAGE_LAYOUT);
    expect(stage.tiles).toHaveLength(3);
    stage.tiles.forEach((row) => expect(row).toHaveLength(3));
  });

  it("所有格子初始为未揭开（revealed=false）", () => {
    const stage = createStage(DEV_STAGE_LAYOUT);
    stage.tiles.flat().forEach((tile) => expect(tile.revealed).toBe(false));
  });

  it("所有格子的 terrain 是合法的 TerrainType", () => {
    const validTerrains = new Set(Object.values(TerrainType));
    createStage(DEV_STAGE_LAYOUT)
      .tiles.flat()
      .forEach((tile) => expect(validTerrains.has(tile.terrain.type)).toBe(true));
  });

  it("Monster Actor 的 name 来自 MOCK_MONSTERS", () => {
    const stage = createStage(DEV_STAGE_LAYOUT);
    // dev 地图中 monster 在 (0,1)
    const monsterTile = stage.tiles[1]![0]!;
    expect(monsterTile.occupant?.type).toBe(ActorType.Monster);
    expect(monsterTile.occupant?.name).toBe("怪物.骷髅战士");
  });

  it("有 Actor 的格子地形由 CellSpec 决定（均为 Floor）", () => {
    const stage = createStage(DEV_STAGE_LAYOUT);
    for (const tile of stage.tiles.flat()) {
      if (tile.occupant) {
        expect(tile.terrain.type).toBe(TerrainType.Floor);
      }
    }
  });
});

// ─── createInitialState ───────────────────────────────────────────────────────

describe("createInitialState", () => {
  it("sessionId 被正确赋值", () => {
    const state = initializeGame("abc-123", createStage(DEV_STAGE_LAYOUT), DEFAULT_PLAYER);
    expect(state.sessionId).toBe("abc-123");
  });

  it("初始 turn=0、phase=player", () => {
    const state = initializeGame("s1", createStage(DEV_STAGE_LAYOUT), DEFAULT_PLAYER);
    expect(state.turn).toBe(0);
    expect(state.phase).toBe("player");
  });

  it("stageSize 为 3", () => {
    const state = initializeGame("s1", createStage(DEV_STAGE_LAYOUT), DEFAULT_PLAYER);
    expect(state.stageSize).toBe(3);
  });

  it("玩家初始属性与传入一致", () => {
    const { player } = initializeGame("s1", createStage(DEV_STAGE_LAYOUT), DEFAULT_PLAYER);
    expect(player).toEqual(DEFAULT_PLAYER);
  });

  it("初始日志为空", () => {
    const { log } = initializeGame("s1", createStage(DEV_STAGE_LAYOUT), DEFAULT_PLAYER);
    expect(log).toHaveLength(0);
  });
});

// ─── applyReveal ─────────────────────────────────────────────────────────────

describe("applyReveal", () => {
  let state: ReturnType<typeof initializeGame>;

  beforeEach(() => {
    state = initializeGame("test-session", createStage(DEV_STAGE_LAYOUT), DEFAULT_PLAYER);
  });

  it("揭开未揭格子：ok=true，terrain 有值，message 有值", () => {
    const result = applyReveal(state, 0, 0);
    expect(result.ok).toBe(true);
    expect(result.terrain).toBeDefined();
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
    // 初始 0 条 + 9 格各 1 条 = 9 条，全部保留不截断
    for (let y = 0; y < state.stageSize; y++) {
      for (let x = 0; x < state.stageSize; x++) {
        applyReveal(state, x, y);
      }
    }
    expect(state.log.length).toBe(9);
  });

  it("揭开的 message 以该格子类型的 LOG_MESSAGES 开头", () => {
    const result = applyReveal(state, 0, 0);
    const tile = state.stage.tiles[0]![0]!;
    const expectedMsg = tile.occupant
      ? tile.occupant.type === "item"
        ? ITEM_LOG_MESSAGE
        : tile.occupant.type === "special"
          ? SPECIAL_LOG_MESSAGE
          : ACTOR_LOG_MESSAGE
      : TERRAIN_LOG_MESSAGES[tile.terrain.type];
    expect(result.message).toContain(expectedMsg);
  });

  it("揭开 Monster 格子时，返回値包含 agentName", () => {
    // 强制将 (0,0) 设为 Monster 格子后揭开
    state.stage.tiles[0]![0]!.terrain = { name: "地板", type: TerrainType.Floor };
    state.stage.tiles[0]![0]!.occupant = { name: "monster-0-0", type: ActorType.Monster };
    const result = applyReveal(state, 0, 0);
    expect(result.agentName).toBe("monster-0-0");
  });

  it("揭开非 Monster 格子时，返回値的 agentName 为 undefined", () => {
    // 强制将 (0,0) 设为 Floor 并清除 actor
    state.stage.tiles[0]![0]!.terrain = { name: "地板", type: TerrainType.Floor };
    delete state.stage.tiles[0]![0]!.occupant;
    const result = applyReveal(state, 0, 0);
    expect(result.agentName).toBeUndefined();
  });
});

// ─── activateMonsterAgent ────────────────────────────────────────────────────────────────

describe("activateMonsterAgent", () => {
  it("将指定名称的 GameAgent 设为 激活", () => {
    const state = initializeGame("s", createStage(DEV_STAGE_LAYOUT), DEFAULT_PLAYER);
    // dev 地图中 monster 在 (0,1)，actor.name = "怪物.骷髅战士"
    expect(state.activatedTurns["怪物.骷髅战士"]).toBeUndefined();
    activateAgent(state, "怪物.骷髅战士");
    expect(state.activatedTurns["怪物.骷髅战士"]).toBeDefined();
  });

  it("重复激活同一 agent 不会增加数量", () => {
    const state = initializeGame("s", createStage(DEV_STAGE_LAYOUT), DEFAULT_PLAYER);
    const countBefore = Object.keys(state.agents).length;
    activateAgent(state, "怪物.骷髅战士");
    activateAgent(state, "怪物.骷髅战士");
    expect(Object.keys(state.agents).length).toBe(countBefore);
    expect(state.activatedTurns["怪物.骷髅战士"]).toBeDefined();
  });

  it("初始 state 的 agents 包含地图中所有怪物（均未激活）", () => {
    const state = initializeGame("s", createStage(DEV_STAGE_LAYOUT), DEFAULT_PLAYER);
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
    const state = initializeGame("s", createStage(DEV_STAGE_LAYOUT), DEFAULT_PLAYER);
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

    const state = initializeGame("s", createStage(DEV_STAGE_LAYOUT), DEFAULT_PLAYER);
    // dev 地图 monster 在 (0,1)，先揭开让 turn > 0
    applyReveal(state, 0, 1);
    activateAgent(state, "怪物.骷髅战士");
    // turn=1 时被激活，需 turn=2 才能行动
    state.turn = 2;

    const task = new AgentTask({
      prompt: buildTurnTaskPrompt(state.turn),
      tools: [queryStatusTool, strikeTool],
      maxRounds: AGENT_LOOP_MAX_ROUNDS,
    });
    await runAgentLoops(getActiveAgents(state), task, state);
    expect(state.log[state.log.length - 1]!.message).toBe("怪物.骷髅战士：怪物发动攻击！");
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

    const state = initializeGame("s", createStage(DEV_STAGE_LAYOUT), DEFAULT_PLAYER);
    activateAgent(state, "怪物.骷髅战士");
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
    expect(state.log.map((e) => e.message)).toContain("怪物.骷髅战士：怪物A攻击！");
    expect(state.log.map((e) => e.message)).toContain("怪物.测试怪物：怪物B防御！");
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

    const state = initializeGame("s", createStage(DEV_STAGE_LAYOUT), DEFAULT_PLAYER);
    activateAgent(state, "怪物.骷髅战士");
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
