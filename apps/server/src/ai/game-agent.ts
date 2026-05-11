import {
  type ContextMessage,
  type SystemMessage,
  humanMessage,
  aiMessage,
  systemMessage,
} from "./messages.js";
import { DeepSeekClient } from "./deepseek-client.js";

// ─── GameAgent（纯数据体）────────────────────────────────────────────────────
//
// 持有实体名称与对话上下文，不含任何业务逻辑或 AI 调用。
// context 第一条必为 SystemMessage，后续为 HumanMessage/AIMessage 交替追加。

export class GameAgent {
  readonly name: string;
  readonly context: ContextMessage[];
  activated: boolean;

  constructor(name: string, systemPrompt: string) {
    this.name = name;
    this.context = [systemMessage(systemPrompt) as SystemMessage];
    this.activated = false;
  }
}

// ─── think（外部函数）────────────────────────────────────────────────────────
//
// 将 agent 的当前上下文连同本轮感知输入发往 DeepSeek，
// 把这一轮的 HumanMessage + AIMessage 追加进 agent.context，
// 返回 AI 的行动描述字符串。
//
// 失败时返回空字符串（游戏容错优先，本回合该实体跳过行动）。

export async function think(agent: GameAgent, perception: string): Promise<string> {
  const client = new DeepSeekClient({
    name: agent.name,
    prompt: perception,
    context: agent.context,
  });

  await client.chat();

  const response = client.responseContent;

  // 将本轮对话追加进上下文，供下轮使用
  agent.context.push(humanMessage(perception));
  agent.context.push(aiMessage(response));

  return response;
}

// ─── thinkBatch（并发批量）───────────────────────────────────────────────────
//
// 同一回合内让多个 agent 并发思考，复用 DeepSeekClient.batchChat() 的并发逻辑。
// agents[i] 对应 perceptions[i]，返回的字符串数组顺序与输入一致。
// 若 agents 与 perceptions 长度不一致则抛出错误（调用方问题，快速失败）。

export async function thinkBatch(agents: GameAgent[], perceptions: string[]): Promise<string[]> {
  if (agents.length !== perceptions.length) {
    throw new Error(
      `thinkBatch: agents(${agents.length}) 与 perceptions(${perceptions.length}) 长度不一致`,
    );
  }
  if (agents.length === 0) return [];

  const clients = agents.map(
    (agent, i) =>
      new DeepSeekClient({
        name: agent.name,
        prompt: perceptions[i]!,
        context: agent.context,
      }),
  );

  await DeepSeekClient.batchChat(clients);

  // 将每个 agent 本轮的对话追加进各自上下文
  return clients.map((client, i) => {
    const response = client.responseContent;
    agents[i]!.context.push(humanMessage(perceptions[i]!));
    agents[i]!.context.push(aiMessage(response));
    return response;
  });
}
