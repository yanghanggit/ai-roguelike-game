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

import {
  DEEPSEEK_API_URL,
  DEEPSEEK_BALANCE_URL,
  DEEPSEEK_MODELS_URL,
  MODEL_FLASH,
} from "./config.js";
import { type AIMessage, type BaseMessage, aiMessage } from "./messages.js";
import { logger } from "../logger.js";

const log = logger.child({ module: "DeepSeekClient" });

// ─── Role mapping ─────────────────────────────────────────────────────────────

const ROLE_MAP: Record<string, string> = {
  system: "system",
  human: "user",
  ai: "assistant",
};

// ─── Payload & response shapes ────────────────────────────────────────────────

interface DeepSeekMessage {
  role: string;
  content: string;
}

interface DeepSeekPayload {
  messages: DeepSeekMessage[];
  model: string;
  thinking: { type: "enabled" | "disabled" };
  frequency_penalty: number;
  max_tokens: number;
  presence_penalty: number;
  response_format: { type: "text" };
  stop: null;
  stream: false;
  stream_options: null;
  temperature: number;
  top_p: number;
  tools: null;
  tool_choice: "none";
  logprobs: false;
  top_logprobs: null;
}

interface DeepSeekResponseMessage {
  role: string;
  content: string | null;
  reasoning_content?: string | null;
}

interface DeepSeekResponseChoice {
  message: DeepSeekResponseMessage;
}

interface DeepSeekResponseUsage {
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

interface DeepSeekResponse {
  choices: DeepSeekResponseChoice[];
  usage?: DeepSeekResponseUsage;
}

interface DeepSeekModelsResponse {
  data: Array<{ id: string }>;
}

// ─── Client options ───────────────────────────────────────────────────────────

export interface DeepSeekClientOptions {
  /** 客户端标识名称 */
  name: string;
  /** 发送给 AI 的完整提示词 */
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

  private _responseAiMessage: AIMessage | null = null;
  private _promptCacheHitTokens = 0;
  private _promptCacheMissTokens = 0;

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
    } = options;

    if (!name) throw new Error("name should not be empty");
    if (!prompt) throw new Error("prompt should not be empty");
    if (timeout <= 0) throw new Error("timeout should be positive");

    this._name = name;
    this._prompt = prompt;
    this._compressedPrompt = compressedPrompt ?? prompt;
    this._context = context;
    this._model = model;
    this._thinking = thinking;
    this._timeout = timeout;
    this._temperature = temperature;

    if (context.length === 0) {
      log.warn({ name }, "context is empty");
    }
  }

  // ─── Properties ─────────────────────────────────────────────────────────────

  get name(): string {
    return this._name;
  }
  get prompt(): string {
    return this._prompt;
  }
  get compressedPrompt(): string {
    return this._compressedPrompt;
  }
  get responseAiMessage(): AIMessage | null {
    return this._responseAiMessage;
  }
  get responseContent(): string {
    return this._responseAiMessage?.content ?? "";
  }
  get responseReasoningContent(): string {
    const val = this._responseAiMessage?.additionalKwargs["reasoning_content"];
    return typeof val === "string" ? val : "";
  }
  get promptCacheHitTokens(): number {
    return this._promptCacheHitTokens;
  }
  get promptCacheMissTokens(): number {
    return this._promptCacheMissTokens;
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
      const res = await fetch(DEEPSEEK_MODELS_URL, {
        headers: DeepSeekClient.buildStaticHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = (await res.json()) as DeepSeekModelsResponse;
        const ids = data.data.map((m) => m.id);
        log.info({ models: ids }, "listModels");
        return ids;
      }
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
      const res = await fetch(DEEPSEEK_BALANCE_URL, {
        headers: DeepSeekClient.buildStaticHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        log.info({ balance: data }, "getBalance");
        return data;
      }
      log.error({ status: res.status, body: await res.text() }, "getBalance failed");
      return {};
    } catch (e) {
      log.error({ err: e }, "getBalance error");
      return {};
    }
  }

  /**
   * 批量并发发送聊天请求（对应 Python `batch_chat`）。
   * @param clients - 待并发执行的客户端实例列表；为空时立即返回。
   */
  static async batchChat(clients: DeepSeekClient[]): Promise<void> {
    if (clients.length === 0) return;

    const start = Date.now();
    const results = await Promise.allSettled(clients.map((c) => c.chat()));
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);

    const failed = results.filter((r) => r.status === "rejected");
    failed.forEach((r, i) => {
      const name = clients[i]?.name ?? "unknown";
      const reason = r.status === "rejected" ? String(r.reason) : "";
      log.error({ name, reason }, "batchChat: individual request failed");
    });

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
      const res = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildPayload()),
        signal: AbortSignal.timeout(this._timeout),
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      log.debug({ name: this._name, elapsed }, "request time");

      if (res.ok) {
        const data = (await res.json()) as DeepSeekResponse;
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
        if (this.responseReasoningContent) {
          log.info({ name: this._name, reasoning: this.responseReasoningContent }, "reasoning");
        }
      } else {
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

  private buildPayload(): DeepSeekPayload {
    const messages: DeepSeekMessage[] = this._context.map((msg) => ({
      role: ROLE_MAP[msg.type] ?? "user",
      content: msg.content,
    }));
    messages.push({ role: "user", content: this._prompt });

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
      tools: null,
      tool_choice: "none",
      logprobs: false,
      top_logprobs: null,
    };
  }

  private parseResponse(data: DeepSeekResponse): void {
    const choices = data.choices;
    if (!choices || choices.length === 0) {
      log.warn({ name: this._name }, "empty choices in response");
      return;
    }

    const message = choices[0]!.message;
    const content = message.content ?? "";
    const additionalKwargs: Record<string, unknown> = {};

    if (message.reasoning_content) {
      additionalKwargs["reasoning_content"] = message.reasoning_content;
    }

    this._responseAiMessage = aiMessage(content, additionalKwargs);

    const usage = data.usage ?? {};
    this._promptCacheHitTokens = usage.prompt_cache_hit_tokens ?? 0;
    this._promptCacheMissTokens = usage.prompt_cache_miss_tokens ?? 0;
  }

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

  private buildHeaders(): Record<string, string> {
    return DeepSeekClient.buildStaticHeaders();
  }

  private static buildStaticHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${DeepSeekClient.getApiKey()}`,
    };
  }
}
