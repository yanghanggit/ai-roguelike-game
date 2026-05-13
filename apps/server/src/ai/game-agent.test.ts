import { describe, it, expect } from "vitest";
import { GameAgent } from "./game-agent.js";

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
    a.addHumanMessage("hi");
    expect(b.context).toHaveLength(1);
  });
});
