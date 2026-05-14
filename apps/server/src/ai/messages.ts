/**
 * 自定义消息类型（仿 langchain 风格，无 langchain 依赖）
 *
 * 提供与 Python messages.py 接口对等的消息类型：
 *   BaseMessage, SystemMessage, HumanMessage, AIMessage, ToolMessage
 */

// ─── Base ─────────────────────────────────────────────────────────────────────

export interface BaseMessage {
  readonly type: string;
  readonly content: string;
  readonly additionalKwargs: Record<string, unknown>;
}

// ─── Concrete types ───────────────────────────────────────────────────────────

export interface SystemMessage extends BaseMessage {
  readonly type: "system";
}

export interface HumanMessage extends BaseMessage {
  readonly type: "human";
}

export interface AIMessage extends BaseMessage {
  readonly type: "ai";
}

/** tool 调用结果消息，对应 DeepSeek/OpenAI API 的 `role: "tool"` 消息。 */
export interface ToolMessage extends BaseMessage {
  readonly type: "tool";
  /** 对应的 tool_call id，与 AIMessage 中 tool_calls[n].id 一一对应 */
  readonly toolCallId: string;
}

/** 判别联合类型 — 通过 `type` 字段唯一区分各消息类型。 */
export type ContextMessage = SystemMessage | HumanMessage | AIMessage | ToolMessage;

// ─── Factories ────────────────────────────────────────────────────────────────

/**
 * 创建系统消息。
 * @param content - 消息正文。
 * @param additionalKwargs - 附加元数据，默认为空对象。
 * @returns 类型为 `"system"` 的消息对象。
 */
export function systemMessage(
  content: string,
  additionalKwargs: Record<string, unknown> = {},
): SystemMessage {
  return { type: "system", content, additionalKwargs };
}

/**
 * 创建人类消息。
 * @param content - 消息正文。
 * @param additionalKwargs - 附加元数据，默认为空对象。
 * @returns 类型为 `"human"` 的消息对象。
 */
export function humanMessage(
  content: string,
  additionalKwargs: Record<string, unknown> = {},
): HumanMessage {
  return { type: "human", content, additionalKwargs };
}

/**
 * 创建 AI 消息。
 * @param content - 消息正文。
 * @param additionalKwargs - 附加元数据（如 `reasoning_content`、`tool_calls`），默认为空对象。
 * @returns 类型为 `"ai"` 的消息对象。
 */
export function aiMessage(
  content: string,
  additionalKwargs: Record<string, unknown> = {},
): AIMessage {
  return { type: "ai", content, additionalKwargs };
}

/**
 * 创建 tool 调用结果消息。
 * @param toolCallId - 对应 LLM 发出的 tool_calls[n].id。
 * @param content - 工具执行结果（字符串）。
 * @returns 类型为 `"tool"` 的消息对象。
 */
export function toolMessage(toolCallId: string, content: string): ToolMessage {
  return { type: "tool", content, additionalKwargs: { toolCallId }, toolCallId };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * 将消息序列转换为单一字符串（用于调试、日志或 prompt 拼接）。
 *
 * @param messages - 待转换的消息序列。
 * @param humanPrefix - 人类消息的前缀标签，默认 `"Human"`。
 * @param aiPrefix - AI 消息的前缀标签，默认 `"AI"`。
 * @returns 各消息以换行符连接的格式化字符串。
 * @example
 * getBufferString([systemMessage("你是助手"), humanMessage("你好"), aiMessage("你好！")])
 * // "System: 你是助手\nHuman: 你好\nAI: 你好！"
 */
export function getBufferString(
  messages: readonly BaseMessage[],
  humanPrefix = "Human",
  aiPrefix = "AI",
): string {
  return messages
    .map((msg) => {
      switch (msg.type) {
        case "system":
          return `System: ${msg.content}`;
        case "human":
          return `${humanPrefix}: ${msg.content}`;
        case "ai":
          return `${aiPrefix}: ${msg.content}`;
        case "tool": {
          const id = (msg as ToolMessage).toolCallId;
          return `Tool(${id}): ${msg.content}`;
        }
        default:
          return `Unknown: ${msg.content}`;
      }
    })
    .join("\n");
}
