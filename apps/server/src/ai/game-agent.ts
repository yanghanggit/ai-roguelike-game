/**
 * 游戏 Agent 数据层。
 *
 * 持有实体名称与对话上下文，不含任何业务逻辑或 AI 调用。
 * `context` 首条必为 `SystemMessage`，后续为 `HumanMessage`/`AIMessage` 交替追加。
 */
import { type ContextMessage, type SystemMessage, systemMessage } from "./messages.js";

/**
 * 游戏实体的 AI 代理。
 *
 * 纯数据结构，仅存储名称和对话上下文；AI 推理逻辑由 `game-actions.ts` 驱动。
 */
export class GameAgent {
  readonly name: string;
  readonly context: ContextMessage[];

  /**
   * @param name - 实体名称，与 `GameState.agents` 的键一致。
   * @param systemPrompt - 注入为首条 `SystemMessage` 的角色设定提示词。
   */
  constructor(name: string, systemPrompt: string) {
    this.name = name;
    this.context = [systemMessage(systemPrompt) as SystemMessage];
  }
}
