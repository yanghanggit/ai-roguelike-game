/**
 * DeepSeek 直连客户端（无 langchain/langgraph 依赖）
 *
 * 直接调用 DeepSeek 平台 REST API（原生 fetch），不引入任何 AI 中间层。
 * 接口设计与 Python DeepSeekClient 保持功能对等。
 *
 * temperature 建议值（按场景）：
 *   代码生成/数学解题 → 0.0
 *   数据抽取/分析    → 1.0
 *   通用对话         → 1.3
 *   翻译             → 1.3
 *   创意写作/诗歌    → 1.5
 */

import { MODEL_FLASH } from "./config.js";
import { type AIMessage, type BaseMessage, type ToolMessage, aiMessage } from "./messages.js";
import { logger } from "../logger.js";

const log = logger.child({ module: "DeepSeekClient" });

// ─── API Endpoints ───────────────────────────────────────────────────────────
export const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions" as const;
export const DEEPSEEK_MODELS_URL = "https://api.deepseek.com/models" as const;
export const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance" as const;

// ─── Role mapping ─────────────────────────────────────────────────────────────

const ROLE_MAP: Record<string, string> = {
  system: "system",
  human: "user",
  ai: "assistant",
  tool: "tool",
};

// ─── Tool calling types ───────────────────────────────────────────────────────

/** 工具函数参数的 JSON Schema 描述。 */
export interface ToolFunction {
  /** 工具名称，应与业务逻辑函数名一致 */
  name: string;
  /** 面向 LLM 的工具功能说明 */
  description: string;
  /** 参数的 JSON Schema（object 类型） */
  parameters: Record<string, unknown>;
}

/** 单个工具定义，对应 DeepSeek/OpenAI `tools` 数组的一个元素。 */
export interface ToolDefinition {
  /** 固定为 "function" */
  type: "function";
  /** 函数描述内容 */
  function: ToolFunction;
}

/** LLM 返回的单次工具调用指令。 */
export interface ToolCall {
  /** 本次调用的唯一 ID，需在 ToolMessage 中回传 */
  id: string;
  /** 固定为 "function" */
  type: "function";
  /** 函数调用信息 */
  function: {
    /** 被调用的工具名称 */
    name: string;
    /** JSON 序列化的参数字符串 */
    arguments: string;
  };
}

// ─── Payload & response shapes ────────────────────────────────────────────────

/** 发送给 DeepSeek API 的单条消息。 */
interface DeepSeekMessage {
  /** 消息角色："system" | "user" | "assistant" */
  role: string;
  /** 消息文本内容 */
  content: string;
}

/** 调用 DeepSeek Chat Completions API 的完整请求体结构。 */
interface DeepSeekPayload {
  /** 对话消息列表（含历史上下文与当前提示词） */
  messages: DeepSeekMessage[];
  /** 使用的模型 ID */
  model: string;
  /** 思考模式开关；仅 deepseek-reasoner 支持 enabled */
  thinking: { type: "enabled" | "disabled" };
  /** 频率惩罚系数，降低重复 token 的出现概率 */
  frequency_penalty: number;
  /** 响应最大 token 数 */
  max_tokens: number;
  /** 存在惩罚系数，鼓励模型引入新话题 */
  presence_penalty: number;
  /** 响应格式，固定为纯文本 */
  response_format: { type: "text" };
  /** 停止词，null 表示不使用 */
  stop: null;
  /** 是否启用流式响应，固定为 false */
  stream: false;
  /** 流式选项，非流式时固定为 null */
  stream_options: null;
  /** 采样温度 */
  temperature: number;
  /** nucleus sampling 参数 */
  top_p: number;
  /** 工具列表；null 表示不使用 tool calling */
  tools: ToolDefinition[] | null;
  /** 工具选择策略 */
  tool_choice: "auto" | "none";
  /** 是否返回 log 概率，固定为 false */
  logprobs: false;
  /** top logprobs 数量，固定为 null */
  top_logprobs: null;
}

/** API 返回的单条消息内容。 */
interface DeepSeekResponseMessage {
  /** 消息角色 */
  role: string;
  /** 回复正文；推理模式下可能为 null；tool_calls 响应时也可能为 null */
  content: string | null;
  /** 推理过程文本（仅 deepseek-reasoner 返回） */
  reasoning_content?: string | null;
  /** LLM 本轮发起的工具调用列表（finish_reason === "tool_calls" 时存在） */
  tool_calls?: ToolCall[];
}

/** API 返回的单个候选回答。 */
interface DeepSeekResponseChoice {
  /** 候选消息内容 */
  message: DeepSeekResponseMessage;
  /** 本轮结束原因："stop" | "tool_calls" | "length" | "content_filter" */
  finish_reason: string;
}

/** API 返回的 prompt 缓存 token 统计信息。 */
interface DeepSeekResponseUsage {
  /** 命中 KV 缓存的 prompt token 数 */
  prompt_cache_hit_tokens?: number;
  /** 未命中 KV 缓存的 prompt token 数 */
  prompt_cache_miss_tokens?: number;
}

/** DeepSeek Chat Completions API 的完整响应体。 */
interface DeepSeekResponse {
  /** 候选回答列表（非流式时通常只有一条） */
  choices: DeepSeekResponseChoice[];
  /** token 使用统计（含缓存信息） */
  usage?: DeepSeekResponseUsage;
}

/** DeepSeek 模型列表 API 的响应体。 */
interface DeepSeekModelsResponse {
  /** 可用模型描述对象数组 */
  data: Array<{ id: string }>;
}

// ─── Client options ───────────────────────────────────────────────────────────

export interface DeepSeekClientOptions {
  /** 客户端标识名称 */
  name: string;
  /** 发送给 AI 的完整提示词；传空字符串表示 continuation 模式（不追加 user 消息） */
  prompt: string;
  /** 历史对话上下文 */
  context: readonly BaseMessage[];
  /** 使用的模型，默认 MODEL_FLASH */
  model?: string;
  /** 开启思考模式（deepseek-reasoner），默认 false */
  thinking?: boolean;
  /** 请求超时（毫秒），默认 30_000 */
  timeout?: number;
  /** 写入对话历史的压缩版提示词；若为空则使用 prompt */
  compressedPrompt?: string;
  /** 温度参数，默认 1.0 */
  temperature?: number;
  /** 工具列表；传入后自动启用 tool calling */
  tools?: ToolDefinition[];
  /** 工具选择策略，默认：有 tools 时为 "auto"，否则为 "none" */
  toolChoice?: "auto" | "none";
}

// ─── DeepSeekClient ───────────────────────────────────────────────────────────

export class DeepSeekClient {
  private readonly _name: string;
  private readonly _prompt: string;
  private readonly _compressedPrompt: string;
  private readonly _context: readonly BaseMessage[];
  private readonly _model: string;
  private readonly _thinking: boolean;
  private readonly _timeout: number;
  private readonly _temperature: number;
  private readonly _tools: ToolDefinition[];
  private readonly _toolChoice: "auto" | "none";

  /** 最近一次 `chat()` 调用后的 AI 响应消息；调用前为 null */
  private _responseAiMessage: AIMessage | null = null;
  /** 最近一次请求命中 KV 缓存的 token 数 */
  private _promptCacheHitTokens = 0;
  /** 最近一次请求未命中 KV 缓存的 token 数 */
  private _promptCacheMissTokens = 0;
  /** 最近一次响应的 finish_reason；调用前为空字符串 */
  private _finishReason = "";
  /** 最近一次响应中 LLM 发起的 tool 调用列表；无 tool call 时为空数组 */
  private _toolCalls: ToolCall[] = [];

  constructor(options: DeepSeekClientOptions) {
    const {
      name,
      prompt,
      context,
      model = MODEL_FLASH,
      thinking = false,
      timeout = 30_000,
      compressedPrompt,
      temperature = 1.0,
      tools = [],
      toolChoice,
    } = options;

    if (!name) throw new Error("name should not be empty");
    if (!prompt && tools.length === 0) throw new Error("prompt should not be empty");
    if (timeout <= 0) throw new Error("timeout should be positive");

    this._name = name;
    this._prompt = prompt;
    this._compressedPrompt = compressedPrompt ?? prompt;
    this._context = context;
    this._model = model;
    this._thinking = thinking;
    this._timeout = timeout;
    this._temperature = temperature;
    this._tools = tools;
    this._toolChoice = toolChoice ?? (tools.length > 0 ? "auto" : "none");

    if (context.length === 0) {
      log.warn({ name }, "context is empty");
    }
  }

  // ─── Properties ─────────────────────────────────────────────────────────────

  /** 客户端标识名称 */
  get name(): string {
    return this._name;
  }
  /** 发送给 AI 的完整提示词 */
  get prompt(): string {
    return this._prompt;
  }
  /** 写入对话历史的压缩版提示词 */
  get compressedPrompt(): string {
    return this._compressedPrompt;
  }
  /** 最近一次请求的 AI 响应消息对象；`chat()` 调用前为 null */
  get responseAiMessage(): AIMessage | null {
    return this._responseAiMessage;
  }
  /** 最近一次请求的 AI 响应正文；未调用或请求失败时为空字符串 */
  get responseContent(): string {
    return this._responseAiMessage?.content ?? "";
  }
  /** 最近一次请求的推理过程文本（仅 deepseek-reasoner 返回）；否则为空字符串 */
  get responseReasoningContent(): string {
    const val = this._responseAiMessage?.additionalKwargs["reasoning_content"];
    return typeof val === "string" ? val : "";
  }
  /** 最近一次请求命中 KV 缓存的 token 数 */
  get promptCacheHitTokens(): number {
    return this._promptCacheHitTokens;
  }
  /** 最近一次请求未命中 KV 缓存的 token 数 */
  get promptCacheMissTokens(): number {
    return this._promptCacheMissTokens;
  }
  /** 最近一次响应的 finish_reason；调用 `chat()` 前为空字符串 */
  get finishReason(): string {
    return this._finishReason;
  }
  /** 最近一次响应中 LLM 发起的 tool 调用列表；无 tool call 时为空数组 */
  get toolCalls(): ToolCall[] {
    return this._toolCalls;
  }

  // ─── Static helpers ──────────────────────────────────────────────────────────

  /** 每次从环境变量读取 API Key（不缓存） */
  private static getApiKey(): string {
    const key = process.env["DEEPSEEK_API_KEY"];
    if (!key) throw new Error("DEEPSEEK_API_KEY environment variable is not set");
    return key;
  }

  /**
   * 启动时快速失败校验，仅检查 API Key 是否存在，不存储。
   * @throws 若 `DEEPSEEK_API_KEY` 环境变量未设置。
   */
  static setup(): void {
    DeepSeekClient.getApiKey();
    log.info({ endpoint: DEEPSEEK_API_URL }, "DeepSeekClient initialized");
  }

  /**
   * 列出 DeepSeek 平台当前可用的模型 ID。
   * @returns 模型 ID 数组；请求失败时返回空数组。
   */
  static async listModels(): Promise<string[]> {
    try {
      // 请求模型列表接口，10 秒超时
      const res = await fetch(DEEPSEEK_MODELS_URL, {
        headers: DeepSeekClient.buildStaticHeaders(),
        signal: AbortSignal.timeout(10_000),
      });

      // 成功响应时解析模型 ID 列表并返回；失败时记录错误日志并返回空数组
      if (res.ok) {
        const data = (await res.json()) as DeepSeekModelsResponse;
        const ids = data.data.map((m) => m.id);
        log.info({ models: ids }, "listModels");
        return ids;
      }

      // 响应非 2xx 时记录错误日志（含状态码和响应体）并返回空数组
      log.error({ status: res.status, body: await res.text() }, "listModels failed");
      return [];
    } catch (e) {
      log.error({ err: e }, "listModels error");
      return [];
    }
  }

  /**
   * 查询账户余额。
   * @returns 余额信息对象；请求失败时返回空对象。
   */
  static async getBalance(): Promise<Record<string, unknown>> {
    try {
      // 请求余额接口，10 秒超时
      const res = await fetch(DEEPSEEK_BALANCE_URL, {
        headers: DeepSeekClient.buildStaticHeaders(),
        signal: AbortSignal.timeout(10_000),
      });

      // 成功响应时解析余额信息并返回；失败时记录错误日志并返回空对象
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        log.info({ balance: data }, "getBalance");
        return data;
      }

      // 响应非 2xx 时记录错误日志（含状态码和响应体）并返回空对象
      log.error({ status: res.status, body: await res.text() }, "getBalance failed");
      return {};
    } catch (e) {
      // 捕获网络错误、超时等异常，记录错误日志并返回空对象
      log.error({ err: e }, "getBalance error");
      return {};
    }
  }

  /**
   * 批量并发发送聊天请求（对应 Python `batch_chat`）。
   * @param clients - 待并发执行的客户端实例列表；为空时立即返回。
   */
  static async batchChat(clients: DeepSeekClient[]): Promise<void> {
    if (clients.length === 0) {
      log.warn("batchChat called with empty clients array");
      return;
    }

    // 记录批量请求开始，包含客户端数量
    const start = Date.now();
    const results = await Promise.allSettled(clients.map((c) => c.chat()));
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);

    const failed = results.filter((r) => r.status === "rejected");
    failed.forEach((r, i) => {
      // 记录每个失败请求的客户端名称和错误原因
      const name = clients[i]?.name ?? "unknown";
      const reason = r.status === "rejected" ? String(r.reason) : "";
      log.error({ name, reason }, "batchChat: individual request failed");
    });

    // 记录批量请求结果，包含成功/失败数量和总耗时
    if (failed.length > 0) {
      log.warn(
        { failed: failed.length, total: clients.length, elapsed },
        "batchChat: some requests failed",
      );
    } else {
      log.info({ total: clients.length, elapsed }, "batchChat: all succeeded");
    }
  }

  // ─── Instance methods ────────────────────────────────────────────────────────

  /**
   * 发送聊天请求（原生 fetch），结果写入 `responseAiMessage`。
   * 内部捕获所有异常并以 `console.error` 记录，不向外抛出。
   */
  async chat(): Promise<void> {
    log.debug({ name: this._name, prompt: this._prompt }, "request prompt");
    const start = Date.now();

    try {
      // 构建请求体并发送 POST 请求，使用实例配置的超时设置
      const res = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildPayload()),
        signal: AbortSignal.timeout(this._timeout),
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      log.debug({ name: this._name, elapsed }, "request time");

      if (res.ok) {
        // 成功响应时解析结果，更新实例字段，并记录响应内容和缓存统计信息
        const data = (await res.json()) as DeepSeekResponse;
        log.debug({ name: this._name, rawResponse: data }, "raw response");
        this.parseResponse(data);
        log.info({ name: this._name, response: this.responseContent }, "responseContent");
        log.debug(
          {
            name: this._name,
            cacheHit: this._promptCacheHitTokens,
            cacheMiss: this._promptCacheMissTokens,
          },
          "cache stats",
        );

        // 若响应包含推理过程文本，则记录一条 info 级别日志输出该内容
        if (this.responseReasoningContent) {
          log.info({ name: this._name, reasoning: this.responseReasoningContent }, "reasoning");
        }
      } else {
        // 响应非 2xx 时记录错误日志（含状态码和响应体）
        const text = await res.text();
        this.handleErrorResponse(res.status, text);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") {
        log.error({ name: this._name }, "request timeout");
      } else if (e instanceof TypeError) {
        log.error({ name: this._name, err: String(e) }, "connection error");
      } else {
        log.error({ name: this._name, err: String(e) }, "unexpected error");
      }
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  /**
   * 根据当前实例配置构造 DeepSeek API 请求体。
   * 将历史上下文消息与当前提示词合并为 `messages` 数组。
   */
  private buildPayload(): DeepSeekPayload {
    const messages: DeepSeekMessage[] = this._context.map((msg) => {
      // ToolMessage 需要额外带 tool_call_id 字段
      if (msg.type === "tool") {
        const tm = msg as ToolMessage;
        return {
          role: "tool",
          tool_call_id: tm.toolCallId,
          content: tm.content,
        } as unknown as DeepSeekMessage;
      }
      // AIMessage 含 tool_calls 时需带上 tool_calls 字段
      if (msg.type === "ai") {
        const toolCalls = (msg as AIMessage).additionalKwargs["tool_calls"];
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          return {
            role: "assistant",
            content: msg.content || null,
            tool_calls: toolCalls,
          } as unknown as DeepSeekMessage;
        }
      }
      return { role: ROLE_MAP[msg.type] ?? "user", content: msg.content };
    });

    // prompt 为空字符串时表示 continuation 模式，不追加 user 消息
    if (this._prompt !== "") {
      messages.push({ role: "user", content: this._prompt });
    }

    return {
      messages,
      model: this._model,
      thinking: { type: this._thinking ? "enabled" : "disabled" },
      frequency_penalty: 0,
      max_tokens: 4096,
      presence_penalty: 0,
      response_format: { type: "text" },
      stop: null,
      stream: false,
      stream_options: null,
      temperature: this._temperature,
      top_p: 1,
      tools: this._tools.length > 0 ? this._tools : null,
      tool_choice: this._toolChoice,
      logprobs: false,
      top_logprobs: null,
    };
  }

  /**
   * 解析 API 响应并将结果写入实例字段。
   * @param data - API 返回的原始响应对象
   */
  private parseResponse(data: DeepSeekResponse): void {
    const choices = data.choices;
    if (!choices || choices.length === 0) {
      log.warn({ name: this._name }, "empty choices in response");
      return;
    }

    const choice = choices[0]!;
    this._finishReason = choice.finish_reason ?? "";

    const message = choice.message;
    const content = message.content ?? "";
    const additionalKwargs: Record<string, unknown> = {};

    // 若响应包含推理过程文本，则将其加入 additionalKwargs 以便后续访问
    if (message.reasoning_content) {
      additionalKwargs["reasoning_content"] = message.reasoning_content;
    }

    // 若响应包含工具调用指令，则将其加入 additionalKwargs 以便后续处理，并更新实例字段
    if (message.tool_calls && message.tool_calls.length > 0) {
      additionalKwargs["tool_calls"] = message.tool_calls;
      this._toolCalls = message.tool_calls;
    } else {
      this._toolCalls = [];
    }

    // 更新 responseAiMessage 字段，供外部访问完整响应内容和附加信息
    this._responseAiMessage = aiMessage(content, additionalKwargs);

    // 记录响应内容和缓存统计信息
    const usage = data.usage ?? {};
    this._promptCacheHitTokens = usage.prompt_cache_hit_tokens ?? 0;
    this._promptCacheMissTokens = usage.prompt_cache_miss_tokens ?? 0;
  }

  /**
   * 按 HTTP 状态码记录对应的错误日志。
   * @param status - HTTP 响应状态码
   * @param text   - 响应体原始文本（用于调试）
   */
  private handleErrorResponse(status: number, text: string): void {
    switch (status) {
      case 400:
        log.error({ name: this._name, status, body: text }, "请求格式错误 — 请检查请求体");
        break;
      case 401:
        log.error({ name: this._name, status }, "认证失败 — API key 错误，请检查 DEEPSEEK_API_KEY");
        break;
      case 402:
        log.error({ name: this._name, status }, "余额不足 — 请前往 DeepSeek 平台充值");
        break;
      case 422:
        log.error({ name: this._name, status, body: text }, "参数错误 — 请检查请求参数");
        break;
      case 429:
        log.warn({ name: this._name, status }, "请求速率达到上限 — 请稍后重试");
        break;
      case 500:
        log.error({ name: this._name, status }, "服务器内部故障 — 请稍后重试");
        break;
      case 503:
        log.warn({ name: this._name, status }, "服务器繁忙 — 请稍后重试");
        break;
      default:
        log.error({ name: this._name, status, body: text }, "请求失败");
    }
  }

  /**
   * 构建实例请求头（代理 {@link DeepSeekClient.buildStaticHeaders}）。
   */
  private buildHeaders(): Record<string, string> {
    return DeepSeekClient.buildStaticHeaders();
  }

  /**
   * 构建包含 `Authorization` Bearer Token 的 HTTP 请求头。
   * 每次调用都从环境变量实时读取 API Key。
   */
  private static buildStaticHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${DeepSeekClient.getApiKey()}`,
    };
  }
}
