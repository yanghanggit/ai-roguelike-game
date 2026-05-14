/**
 * 游戏 Agent 数据层。
 *
 * 持有实体名称与对话上下文，不含任何业务逻辑或 AI 调用。
 * `context` 首条必为 `SystemMessage`，后续为 `HumanMessage`/`AIMessage` 交替追加。
 *
 * 外部只能通过 `addSystemMessage` / `addHumanMessage` / `addAIMessage` 写入上下文，
 * `context` getter 仅返回只读视图。
 */
import {
  type ContextMessage,
  type SystemMessage,
  type HumanMessage,
  type AIMessage,
  type ToolMessage,
  systemMessage,
  humanMessage,
  aiMessage,
  toolMessage,
} from "./ai/messages.js";

/**
 * 游戏实体的 AI 代理。
 *
 * 纯数据结构，仅存储名称和对话上下文；AI 推理逻辑由 `game-actions.ts` 驱动。
 */
export class GameAgent {
  private readonly _name: string;
  private readonly _context: ContextMessage[];

  /**
   * @param name - 实体名称，与 `GameState.agents` 的键一致。
   * @param systemPrompt - 注入为首条 `SystemMessage` 的角色设定提示词。
   */
  constructor(name: string, systemPrompt: string) {
    this._name = name;
    this._context = [];
    this.addSystemMessage(systemPrompt);
  }

  /** 实体名称。 */
  get name(): string {
    return this._name;
  }

  /** 只读上下文视图，外部可遍历但不可直接 push。 */
  get context(): readonly ContextMessage[] {
    return this._context;
  }

  /**
   * 向上下文追加一条系统消息。
   * @param content - 消息正文。
   * @param additionalKwargs - 附加元数据，默认为空对象。
   */
  addSystemMessage(content: string, additionalKwargs: Record<string, unknown> = {}): void {
    this._context.push(systemMessage(content, additionalKwargs) as SystemMessage);
  }

  /**
   * 向上下文追加一条人类消息。
   * @param content - 消息正文。
   * @param additionalKwargs - 附加元数据，默认为空对象。
   */
  addHumanMessage(content: string, additionalKwargs: Record<string, unknown> = {}): void {
    this._context.push(humanMessage(content, additionalKwargs) as HumanMessage);
  }

  /**
   * 向上下文追加一条 AI 消息。
   * @param content - 消息正文。
   * @param additionalKwargs - 附加元数据，默认为空对象。
   */
  addAIMessage(content: string, additionalKwargs: Record<string, unknown> = {}): void {
    this._context.push(aiMessage(content, additionalKwargs) as AIMessage);
  }

  /**
   * 向上下文追加一条工具调用结果消息。
   * @param toolCallId - 对应 LLM 发起的 tool call id。
   * @param content - 工具执行结果文本。
   */
  addToolMessage(toolCallId: string, content: string): void {
    this._context.push(toolMessage(toolCallId, content) as ToolMessage);
  }

  /** 控制 JSON 序列化输出，确保存档字段为 `context` 而非 `_context`。 */
  toJSON(): { name: string; context: readonly ContextMessage[] } {
    return { name: this.name, context: this._context };
  }

  /**
   * 从 JSON 反序列化后的纯对象重建 `GameAgent` 实例，恢复已有上下文，不追加任何消息。
   *
   * @param name - agent 名称。
   * @param context - 已有的消息序列（来自 JSON 存档）。
   */
  static fromRaw(name: string, context: ContextMessage[]): GameAgent {
    const agent = Object.create(GameAgent.prototype) as GameAgent;
    // readonly/private 在运行时均为编译期约束；通过 Object.create 绕过构造函数直接赋值。
    (agent as unknown as Record<string, unknown>)["_name"] = name;
    (agent as unknown as Record<string, unknown>)["_context"] = [...context];
    return agent;
  }
}
