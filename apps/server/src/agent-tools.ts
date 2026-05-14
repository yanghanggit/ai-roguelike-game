/**
 * Agent 工具层。
 *
 * 每个工具以 `AgentTool` 的形式封装，LLM 工具定义与本地处理器共同定义在同一个对象中。
 * 调用方将所需工具显式传入 `AgentTask` 构造器，无全局注册表。
 */

import type { GameState } from "@roguelike/shared";
import { GameAgent } from "./game-agent.js";
import { extractLabel } from "./mock-monsters.js";
import type { AgentTool, ToolHandlerResult } from "./agent-task.js";

// ─── query_status ─────────────────────────────────────────────────────────────

/**
 * 查询目标信息。
 * target 取值：
 * - "player"      — 玩家当前 HP、攻击、防御
 * - "dungeon"     — 地下城概览（已揭开格子数 + 激活怪物名单）
 * - "<怪物名>"    — 指定怪物的基础信息
 */
export const queryStatusTool: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "query_status",
      description:
        '查询目标的当前信息。target 可以是 "player"（玩家）、"dungeon"（整个地下城概览），或具体怪物的名字。',
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: '查询目标："player" / "dungeon" / 怪物名字',
          },
        },
        required: ["target"],
      },
    },
  },
  handler(args: Record<string, string>, agent: GameAgent, state: GameState): ToolHandlerResult {
    const target = typeof args["target"] === "string" ? args["target"] : "player";

    if (target === "player") {
      return {
        message: `玩家状态：HP ${state.player.hp}/${state.player.maxHp}，攻击 ${state.player.attack}，防御 ${state.player.defense}。`,
      };
    }

    if (target === "dungeon") {
      const revealedCount = state.map.flat().filter((t) => t.revealed).length;
      const totalCount = state.mapSize * state.mapSize;
      const activeMonsters = Object.keys(state.activatedTurns)
        .filter((name) => name !== agent.name)
        .map((name) => state.agents[name])
        .filter((a): a is GameAgent => a !== undefined)
        .map((a) => extractLabel(a.name));
      const monsterText =
        activeMonsters.length > 0
          ? `已激活怪物：${activeMonsters.join("、")}。`
          : "当前无其他激活怪物。";
      return { message: `地下城概览：已揭开 ${revealedCount}/${totalCount} 格。${monsterText}` };
    }

    // 指定怪物名字
    const found = Object.values(state.agents).find(
      (a) => a !== undefined && extractLabel((a as GameAgent).name) === target,
    ) as GameAgent | undefined;
    return {
      message: found
        ? `怪物「${target}」已激活，正在地下城中行动。`
        : `未找到名为「${target}」的目标。`,
    };
  },
};

// ─── strike ───────────────────────────────────────────────────────────────────

/**
 * 对指定目标发动攻击，结果写入游戏日志。
 * 调用此工具后本回合行动立即结束（endTurn: true）。
 */
export const strikeTool: AgentTool = {
  definition: {
    type: "function",
    function: {
      name: "strike",
      description: "对指定目标发动攻击。调用此工具后本回合行动结束。",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: '攻击目标："player" 或具体怪物名字',
          },
          summary: {
            type: "string",
            description: "一句简短的攻击描述，将写入游戏日志供玩家查看",
          },
        },
        required: ["target", "summary"],
      },
    },
  },
  handler(args: Record<string, string>, agent: GameAgent, state: GameState): ToolHandlerResult {
    const summary =
      typeof args["summary"] === "string" && args["summary"].trim().length > 0
        ? args["summary"].trim()
        : "发动了攻击。";
    const message = `${extractLabel(agent.name)}：${summary}`;
    state.log = [...state.log, { turn: state.turn, message }];
    return { message: "【行动结果/strike】你的出手已被系统记录，等待下一回合。", endTurn: true };
  },
};
