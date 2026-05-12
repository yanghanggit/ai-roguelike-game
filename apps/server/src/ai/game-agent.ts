import { type ContextMessage, type SystemMessage, systemMessage } from "./messages.js";

// ─── GameAgent（纯数据体）────────────────────────────────────────────────────
//
// 持有实体名称与对话上下文，不含任何业务逻辑或 AI 调用。
// context 第一条必为 SystemMessage，后续为 HumanMessage/AIMessage 交替追加。

export class GameAgent {
  readonly name: string;
  readonly context: ContextMessage[];

  constructor(name: string, systemPrompt: string) {
    this.name = name;
    this.context = [systemMessage(systemPrompt) as SystemMessage];
  }
}
