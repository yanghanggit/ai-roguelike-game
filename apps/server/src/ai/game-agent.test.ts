import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GameAgent } from "./game-agent.js";
import { think, thinkBatch } from "../game-actions.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** 构造一个符合 DeepSeek 响应格式的 fetch mock */
function mockFetchOk(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { role: "assistant", content } }],
      usage: { prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10 },
    }),
  });
}

function mockFetchFail() {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
    text: async () => "Internal Server Error",
  });
}

// ─── GameAgent 数据结构 ───────────────────────────────────────────────────────

describe("GameAgent 构造", () => {
  it("name 被正确赋值", () => {
    const agent = new GameAgent("slime-01", "你是一只史莱姆。");
    expect(agent.name).toBe("slime-01");
  });

  it("初始 context 包含且仅包含一条 SystemMessage", () => {
    const agent = new GameAgent("slime-01", "你是一只史莱姆。");
    expect(agent.context).toHaveLength(1);
    expect(agent.context[0]!.type).toBe("system");
    expect(agent.context[0]!.content).toBe("你是一只史莱姆。");
  });

  it("两个 agent 的 context 彼此独立", () => {
    const a = new GameAgent("a", "提示 A");
    const b = new GameAgent("b", "提示 B");
    a.context.push({ type: "human", content: "hi", additionalKwargs: {} });
    expect(b.context).toHaveLength(1);
  });
});

// ─── think() 正常流程 ─────────────────────────────────────────────────────────

describe("think() — 正常响应", () => {
  beforeEach(() => {
    process.env["DEEPSEEK_API_KEY"] = "test-key";
    vi.stubGlobal("fetch", mockFetchOk("我决定向左移动。"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["DEEPSEEK_API_KEY"];
  });

  it("返回 AI 的行动描述字符串", async () => {
    const agent = new GameAgent("slime", "你是一只史莱姆。");
    const result = await think(agent, "玩家揭开了你右边的格子。");
    expect(result).toBe("我决定向左移动。");
  });

  it("think() 后 context 追加了 HumanMessage + AIMessage", async () => {
    const agent = new GameAgent("slime", "你是一只史莱姆。");
    await think(agent, "玩家靠近了。");
    // [SystemMessage, HumanMessage, AIMessage]
    expect(agent.context).toHaveLength(3);
    expect(agent.context[1]!.type).toBe("human");
    expect(agent.context[1]!.content).toBe("玩家靠近了。");
    expect(agent.context[2]!.type).toBe("ai");
    expect(agent.context[2]!.content).toBe("我决定向左移动。");
  });

  it("连续两次 think() 后 context 有 5 条消息（1 system + 2×human+ai）", async () => {
    const agent = new GameAgent("slime", "你是一只史莱姆。");
    await think(agent, "回合 1 感知");
    vi.stubGlobal("fetch", mockFetchOk("第二次行动。"));
    await think(agent, "回合 2 感知");
    expect(agent.context).toHaveLength(5);
    expect(agent.context[0]!.type).toBe("system");
    expect(agent.context[1]!.type).toBe("human");
    expect(agent.context[2]!.type).toBe("ai");
    expect(agent.context[3]!.type).toBe("human");
    expect(agent.context[4]!.type).toBe("ai");
  });

  it("连续两次 think() 时历史内容按顺序正确", async () => {
    const agent = new GameAgent("slime", "你是一只史莱姆。");
    await think(agent, "第一轮");
    vi.stubGlobal("fetch", mockFetchOk("第二轮回复。"));
    await think(agent, "第二轮");
    expect(agent.context[1]!.content).toBe("第一轮");
    expect(agent.context[2]!.content).toBe("我决定向左移动。");
    expect(agent.context[3]!.content).toBe("第二轮");
    expect(agent.context[4]!.content).toBe("第二轮回复。");
  });
});

// ─── think() 失败容错 ─────────────────────────────────────────────────────────

describe("think() — API 失败", () => {
  beforeEach(() => {
    process.env["DEEPSEEK_API_KEY"] = "test-key";
    vi.stubGlobal("fetch", mockFetchFail());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["DEEPSEEK_API_KEY"];
  });

  it("API 返回错误时，think() 返回空字符串而不是 throw", async () => {
    const agent = new GameAgent("slime", "你是一只史莱姆。");
    const result = await think(agent, "感知输入");
    expect(result).toBe("");
  });

  it("API 失败后 context 仍追加了 HumanMessage + AIMessage（content 为空）", async () => {
    const agent = new GameAgent("slime", "你是一只史莱姆。");
    await think(agent, "感知输入");
    expect(agent.context).toHaveLength(3);
    expect(agent.context[1]!.type).toBe("human");
    expect(agent.context[2]!.type).toBe("ai");
    expect(agent.context[2]!.content).toBe("");
  });
});

// ─── thinkBatch() ─────────────────────────────────────────────────────────────

describe("thinkBatch() — 正常响应", () => {
  beforeEach(() => {
    process.env["DEEPSEEK_API_KEY"] = "test-key";
    // 每次调用 fetch 依次返回不同内容（按调用顺序）
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { role: "assistant", content: "史莱姆行动。" } }],
            usage: { prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 5 },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { role: "assistant", content: "骷髅行动。" } }],
            usage: { prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 5 },
          }),
        }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["DEEPSEEK_API_KEY"];
  });

  it("返回与 agents 顺序一致的行动字符串数组", async () => {
    const slime = new GameAgent("slime", "你是史莱姆。");
    const skeleton = new GameAgent("skeleton", "你是骷髅。");
    const results = await thinkBatch([slime, skeleton], ["感知A", "感知B"]);
    expect(results).toHaveLength(2);
    expect(results[0]).toBe("史莱姆行动。");
    expect(results[1]).toBe("骷髅行动。");
  });

  it("每个 agent 的 context 都追加了本轮 HumanMessage + AIMessage", async () => {
    const slime = new GameAgent("slime", "你是史莱姆。");
    const skeleton = new GameAgent("skeleton", "你是骷髅。");
    await thinkBatch([slime, skeleton], ["感知A", "感知B"]);
    expect(slime.context).toHaveLength(3);
    expect(slime.context[1]!.content).toBe("感知A");
    expect(slime.context[2]!.content).toBe("史莱姆行动。");
    expect(skeleton.context).toHaveLength(3);
    expect(skeleton.context[1]!.content).toBe("感知B");
    expect(skeleton.context[2]!.content).toBe("骷髅行动。");
  });

  it("空数组输入立即返回空数组", async () => {
    const results = await thinkBatch([], []);
    expect(results).toEqual([]);
  });

  it("agents 与 perceptions 长度不一致时抛出错误", async () => {
    const slime = new GameAgent("slime", "你是史莱姆。");
    await expect(thinkBatch([slime], ["A", "B"])).rejects.toThrow(/长度不一致/);
  });
});

describe("thinkBatch() — 部分失败", () => {
  beforeEach(() => {
    process.env["DEEPSEEK_API_KEY"] = "test-key";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { role: "assistant", content: "史莱姆成功。" } }],
            usage: {},
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "error",
        }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["DEEPSEEK_API_KEY"];
  });

  it("部分失败时成功的返回内容，失败的返回空字符串，不 throw", async () => {
    const slime = new GameAgent("slime", "你是史莱姆。");
    const skeleton = new GameAgent("skeleton", "你是骷髅。");
    const results = await thinkBatch([slime, skeleton], ["感知A", "感知B"]);
    expect(results[0]).toBe("史莱姆成功。");
    expect(results[1]).toBe("");
  });
});
