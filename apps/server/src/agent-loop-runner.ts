/**
 * Agent 多步循环执行层。
 *
 * 负责单体循环、批量并发循环与 runAgentLoops 对 state.log 的落盘。
 * 使用 DeepSeekClient tool calling 驱动推理：query_status / strike 两个工具。
 * done 语义改由 finish_reason === "stop" 隐式表达。
 */

import type { GameState, LogEntry } from "@roguelike/shared";
import type { ToolDefinition } from "./ai/deepseek-client.js";
import { GameAgent } from "./ai/game-agent.js";
import { DeepSeekClient } from "./ai/deepseek-client.js";
import { extractLabel } from "./mock-monsters.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "AgentLoopRunner" });

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOL_NAME_QUERY = "query_status";
const TOOL_NAME_STRIKE = "strike";

/**
 * 查询目标信息。
 * target 取值：
 * - "player"      — 玩家当前 HP、攻击、防御
 * - "dungeon"     — 地下城概览（已揭开格子数 + 激活怪物名单）
 * - "<怪物名>"    — 指定怪物的基础信息
 */
const TOOL_QUERY_STATUS: ToolDefinition = {
  type: "function",
  function: {
    name: TOOL_NAME_QUERY,
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
};

/**
 * 对指定目标发动攻击，结果写入游戏日志。
 */
const TOOL_STRIKE: ToolDefinition = {
  type: "function",
  function: {
    name: TOOL_NAME_STRIKE,
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
};

const AGENT_TOOLS: ToolDefinition[] = [TOOL_QUERY_STATUS, TOOL_STRIKE];

/** 单回合允许的最大推理轮次（安全上限，防止无限循环）。 */
const AGENT_LOOP_MAX_ROUNDS = 6;

// ─── Prompt builders ──────────────────────────────────────────────────────────

/**
 * 构建完整的回合任务提示词，供 `agentLoop` 作为第一步 prompt 使用。
 *
 * @param eventSummary - 描述本回合触发事件的一句话文本（如「玩家揭开了新格子」）。
 * @returns 完整的任务提示词字符串。
 */
export function buildTurnTaskPrompt(eventSummary: string): string {
  return `本回合事件：${eventSummary}

**回合行动（工具驱动）**

每回合通过以下工具决策，禁止在消息正文中描述行动结果：
- **query_status**：查询 "player"（玩家属性）、"dungeon"（地下城概览）或指定怪物名字，用于收集信息后再决策。
- **strike**：对目标发动攻击，同时附上一句简短的攻击描述（供日志展示），调用后本回合立即结束；**禁止在消息正文中描述攻击，只有 strike 调用才被系统识别为真实攻击**。
- 若本回合确实无需行动（例如等待信息不足），可直接停止输出（不调用任何工具）；但**已感知到玩家存在时，优先选择行动而非等待**。`;
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

/**
 * 处理 query_status 工具调用，返回可直接作为工具结果的文本。
 *
 * @param target - 查询目标："player" / "dungeon" / 怪物名字
 * @param agentName - 发起查询的 agent 名称（用于 dungeon 查询排除自身）
 * @param state - 当前游戏状态
 */
function handleQueryTool(target: string, agentName: string, state: GameState): string {
  if (target === "player") {
    return `玩家状态：HP ${state.player.hp}/${state.player.maxHp}，攻击 ${state.player.attack}，防御 ${state.player.defense}。`;
  }

  if (target === "dungeon") {
    const revealedCount = state.map.flat().filter((t) => t.revealed).length;
    const totalCount = state.mapSize * state.mapSize;
    const activeMonsters = Object.keys(state.activatedTurns)
      .filter((name) => name !== agentName)
      .map((name) => state.agents[name])
      .filter((a): a is GameAgent => a !== undefined)
      .map((a) => extractLabel(a.name));
    const monsterText =
      activeMonsters.length > 0
        ? `已激活怪物：${activeMonsters.join("、")}。`
        : "当前无其他激活怪物。";
    return `地下城概览：已揭开 ${revealedCount}/${totalCount} 格。${monsterText}`;
  }

  // 指定怪物名字
  const found = Object.values(state.agents).find(
    (a) => a !== undefined && extractLabel((a as GameAgent).name) === target,
  ) as GameAgent | undefined;
  if (found) {
    return `怪物「${target}」已激活，正在地下城中行动。`;
  }
  return `未找到名为「${target}」的目标。`;
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

/**
 * 对单个 agent 执行受控多步推理循环（tool calling 版本）。
 *
 * 循环规则：
 * - finish_reason === "tool_calls"：分发工具调用，结果写入 context，继续推理。
 * - finish_reason === "stop"：本回合按兵不动（隐式 done），结束循环。
 * - 调用 strike 工具：记录行动摘要，立即结束本回合。
 * - 超过 {@link AGENT_LOOP_MAX_ROUNDS} 轮次：安全退出，视为 done。
 *
 * @param agent - 参与本轮推理的 agent，context 会在循环内持续追加。
 * @param taskPrompt - 本回合触发推理的任务文本（第一步 prompt）。
 * @param state - 当前游戏状态，供工具查询使用。
 * @returns strike 时返回可写入日志的行动摘要；done 或兜底时返回空字符串。
 */
async function agentLoop(agent: GameAgent, taskPrompt: string, state: GameState): Promise<string> {
  let round = 0;

  while (round < AGENT_LOOP_MAX_ROUNDS) {
    round++;

    // 第一轮注入任务 prompt，后续轮次用 continuation 模式（context 里已有 tool 结果）
    const prompt = round === 1 ? taskPrompt : "";

    const client = new DeepSeekClient({
      name: agent.name,
      prompt,
      context: agent.context,
      tools: AGENT_TOOLS,
    });

    await client.chat();

    const responseContent = client.responseContent;
    const toolCalls = client.toolCalls;
    const finishReason = client.finishReason;

    // 将 AI 回复存入 context（有 tool_calls 时一并携带，供后续轮次 context 完整）
    if (toolCalls.length > 0) {
      agent.addAIMessage(responseContent, { tool_calls: toolCalls });
    } else {
      agent.addAIMessage(responseContent);
    }

    // finish_reason === "stop"：LLM 自然结束，视为 done
    if (finishReason === "stop") {
      return "";
    }

    if (finishReason !== "tool_calls") {
      log.warn({ name: agent.name, finishReason }, "agentLoop: unexpected finish_reason");
      return "";
    }

    // 分发工具调用
    let strikeResult = "";
    for (const call of toolCalls) {
      let args: Record<string, string> = {};
      try {
        args = JSON.parse(call.function.arguments) as Record<string, string>;
      } catch {
        log.warn({ name: agent.name, call }, "agentLoop: failed to parse tool arguments");
        agent.addToolMessage(call.id, "参数解析失败，请检查工具调用格式。");
        continue;
      }

      if (call.function.name === TOOL_NAME_QUERY) {
        const target = typeof args["target"] === "string" ? args["target"] : "player";
        const result = handleQueryTool(target, agent.name, state);
        agent.addToolMessage(call.id, result);
      } else if (call.function.name === TOOL_NAME_STRIKE) {
        const summary =
          typeof args["summary"] === "string" && args["summary"].trim().length > 0
            ? args["summary"].trim()
            : "发动了攻击。";
        agent.addToolMessage(call.id, "【行动结果/strike】你的出手已被系统记录，等待下一回合。");
        strikeResult = summary;
      } else {
        agent.addToolMessage(call.id, `未知工具：${call.function.name}`);
      }
    }

    // strike 调用后立即结束本回合
    if (strikeResult.length > 0) {
      return strikeResult;
    }
  }

  log.warn({ name: agent.name, rounds: AGENT_LOOP_MAX_ROUNDS }, "agentLoop: max rounds reached");
  return "";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * 对 `state` 中所有已激活的 agent 执行一轮并发推理，结果追加至 `state.log`。
 *
 * @param state - 当前游戏状态，`activatedTurns` 决定哪些 agent 参与本轮推理。
 * @param task - 本回合已构建完成的任务提示词（包含事件事实）。
 */
export async function runAgentLoops(state: GameState, task: string): Promise<void> {
  // 选择所有已激活且非本回合首次被激活的 agent 参与推理，确保新激活的 agent 从下一回合开始参与。
  const agentList = Object.keys(state.activatedTurns)
    .filter((name) => state.activatedTurns[name]! < state.turn)
    .map((name) => state.agents[name])
    .filter((a) => a !== undefined)
    .map((a) => a as unknown as GameAgent);

  if (agentList.length === 0) {
    log.debug({ turn: state.turn }, "runAgentLoops: no agents to run");
    return;
  }

  const actions = await Promise.all(agentList.map((agent) => agentLoop(agent, task, state)));

  const entries = actions
    .map((content, i) =>
      content.length > 0 ? `${extractLabel(agentList[i]!.name)}：${content}` : "",
    )
    .filter((a) => a.length > 0);

  if (entries.length > 0) {
    const newEntries: LogEntry[] = entries.map((message) => ({ turn: state.turn, message }));
    state.log = [...state.log, ...newEntries];
  }
}
