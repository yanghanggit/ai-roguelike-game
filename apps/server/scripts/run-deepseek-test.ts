/**
 * DeepSeek API 测试脚本（对应 Python run_deepseek_test.py）
 *
 * 使用方式：
 *   cd apps/server
 *   pnpm tsx scripts/run-deepseek-test.ts
 *
 * .env 文件在项目根目录，dotenv 会自动向上查找并加载。
 */

import * as path from "node:path";
import * as url from "node:url";
import dotenv from "dotenv";
import pino from "pino";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const logger = pino({
  level: "info",
  transport: {
    target: "pino-pretty",
    options: { colorize: true, ignore: "pid,hostname", translateTime: "HH:MM:ss.l" },
  },
});
import {
  DeepSeekClient,
  MODEL_FLASH,
  MODEL_PRO,
  type ContextMessage,
  type ToolDefinition,
  type ToolCall,
  systemMessage,
  humanMessage,
  aiMessage,
  toolMessage,
  getBufferString,
} from "../src/ai/index.js";

const _SYSTEM = systemMessage("你是一个有帮助的助手，请用中文回答。");

// ─── Test: single chat ────────────────────────────────────────────────────────

async function testChat(): Promise<void> {
  logger.info("=== 测试 chat() ===");

  const client = new DeepSeekClient({
    name: "test_chat",
    prompt: "请简单介绍一下你自己。",
    context: [_SYSTEM],
    model: MODEL_FLASH,
  });

  await client.chat();
  logger.info({ response: client.responseContent }, "📝 回复");
}

// ─── Test: batch chat ─────────────────────────────────────────────────────────

async function testBatchChat(): Promise<void> {
  logger.info("=== 测试 batchChat() ===");

  const questions = ["1+1等于几？", "天空为什么是蓝色的？", "请用一句话描述 TypeScript 语言。"];

  const clients = questions.map(
    (q, i) =>
      new DeepSeekClient({
        name: `batch_${i}`,
        prompt: q,
        context: [_SYSTEM],
        model: MODEL_FLASH,
      }),
  );

  await DeepSeekClient.batchChat(clients);

  for (const client of clients) {
    logger.info({ question: client.prompt, answer: client.responseContent }, "批量回复");
  }
}

// ─── Test: getBufferString ────────────────────────────────────────────────────

function testGetBufferString(): void {
  logger.info("=== 测试 getBufferString() ===");

  const messages = [
    systemMessage("你是一个有帮助的助手。"),
    humanMessage("你好，请介绍一下自己。"),
    aiMessage("你好！我是 DeepSeek，一个 AI 助手。"),
    humanMessage("你能做什么？"),
  ];

  logger.info({ bufferString: getBufferString(messages) }, "getBufferString 结果");
}

// ─── Test: listModels ─────────────────────────────────────────────────────────

async function testListModels(): Promise<void> {
  logger.info("=== 测试 listModels() ===");

  const models = await DeepSeekClient.listModels();
  if (models.length > 0) {
    logger.info({ models }, "可用模型");
  } else {
    logger.warn("未获取到模型列表");
  }
}

// ─── Test: getBalance ─────────────────────────────────────────────────────────

async function testGetBalance(): Promise<void> {
  logger.info("=== 测试 getBalance() ===");

  const balance = await DeepSeekClient.getBalance();
  if (Object.keys(balance).length > 0) {
    logger.info({ balance }, "账户余额");
  } else {
    logger.warn("未获取到余额信息");
  }
}

// ─── Test: thinking mode (MODEL_PRO) ─────────────────────────────────────────

async function testThinkingMode(): Promise<void> {
  logger.info("=== 测试 thinking 模式（MODEL_PRO）===");

  const client = new DeepSeekClient({
    name: "test_thinking",
    prompt: "9.11 和 9.9 哪个更大？请一步一步思考。",
    context: [_SYSTEM],
    model: MODEL_PRO,
    thinking: true,
    temperature: 0.0,
  });

  await client.chat();
  if (client.responseReasoningContent) {
    logger.info({ reasoning: client.responseReasoningContent }, "💭 思考过程");
  }
  logger.info({ response: client.responseContent }, "📝 最终回答");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// ─── Mock tool implementations ────────────────────────────────────────────────

/**
 * GET-like: 查询城市天气（纯本地假数据，无网络请求）。
 */
function mockGetWeather(city: string): string {
  const data: Record<string, object> = {
    北京: {
      city: "北京",
      condition: "晴",
      temperature: "28°C",
      humidity: "40%",
      wind: "北风 3 级",
    },
    上海: {
      city: "上海",
      condition: "多云",
      temperature: "25°C",
      humidity: "65%",
      wind: "东风 2 级",
    },
  };
  const result = data[city] ?? { city, condition: "未知", temperature: "N/A" };
  return JSON.stringify(result);
}

/**
 * POST-like: 创建一条笔记（纯本地假数据，返回创建成功的 ID）。
 */
function mockCreateNote(title: string, content: string): string {
  const id = `note_${Date.now()}`;
  logger.info({ title, content, id }, "[mock] createNote called");
  return JSON.stringify({ ok: true, id, title });
}

// ─── Tool definitions (JSON Schema) ──────────────────────────────────────────

const TOOL_GET_WEATHER: ToolDefinition = {
  type: "function",
  function: {
    name: "get_weather",
    description: "查询指定城市的实时天气，包括天气状况、温度、湿度和风力。",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "城市名称，例如：北京、上海" },
      },
      required: ["city"],
    },
  },
};

const TOOL_CREATE_NOTE: ToolDefinition = {
  type: "function",
  function: {
    name: "create_note",
    description: "创建一条笔记，将内容持久化保存。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "笔记标题" },
        content: { type: "string", description: "笔记正文内容" },
      },
      required: ["title", "content"],
    },
  },
};

// ─── Test: tool calling (multi-turn) ─────────────────────────────────────────

async function testToolCalling(): Promise<void> {
  logger.info("=== 测试 tool calling（多轮推理）===");

  const tools = [TOOL_GET_WEATHER, TOOL_CREATE_NOTE];
  // 多轮对话消息历史（含 tool 调用结果）
  const messages: ContextMessage[] = [
    systemMessage("你是一个有帮助的助手，请用中文回答。"),
    humanMessage("请帮我查询北京和上海的天气，然后创建一条笔记来总结两地天气的对比。"),
  ];

  let round = 0;
  while (true) {
    round++;
    logger.info({ round }, "--- tool loop round ---");

    const client = new DeepSeekClient({
      name: `tool_loop_r${round}`,
      prompt: "", // continuation 模式：context 已含所有消息，不再追加 user
      context: messages,
      model: MODEL_FLASH,
      tools,
    });

    await client.chat();

    const finishReason = client.finishReason;
    const toolCalls = client.toolCalls;
    const responseContent = client.responseContent;

    logger.info({ round, finishReason, toolCallCount: toolCalls.length }, "round result");

    // 将本轮 assistant 消息（可能含 tool_calls）推入历史
    messages.push(
      aiMessage(responseContent, toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    );

    if (finishReason === "stop") {
      logger.info({ response: responseContent }, "📝 最终回答");
      break;
    }

    if (finishReason !== "tool_calls") {
      logger.warn({ finishReason }, "unexpected finish_reason, exiting loop");
      break;
    }

    // 执行每个 tool call 并将结果推入历史
    for (const call of toolCalls) {
      const fnName = call.function.name;
      let args: Record<string, string>;
      try {
        args = JSON.parse(call.function.arguments) as Record<string, string>;
      } catch {
        logger.error({ call }, "failed to parse tool call arguments");
        args = {};
      }

      let result: string;
      if (fnName === "get_weather") {
        result = mockGetWeather(args["city"] ?? "");
        logger.info({ city: args["city"], result }, "[mock] get_weather");
      } else if (fnName === "create_note") {
        result = mockCreateNote(args["title"] ?? "", args["content"] ?? "");
      } else {
        result = JSON.stringify({ error: `unknown tool: ${fnName}` });
        logger.warn({ fnName }, "[mock] unknown tool called");
      }

      messages.push(toolMessage(call.id, result));
    }
  }

  logger.info("=== tool calling 测试完成 ===");
}

async function main(): Promise<void> {
  // 快速失败：检测 API key 是否配置
  try {
    DeepSeekClient.setup();
  } catch (e) {
    logger.error({ err: String(e) }, "API key 未配置");
    process.exit(1);
  }

  // 同步测试（无网络请求）
  testGetBufferString();

  // 异步测试（依次执行，避免并发时日志交错影响阅读）
  await testListModels();
  await testGetBalance();
  await testChat();
  await testBatchChat();
  await testThinkingMode();
  await testToolCalling();

  logger.info("✅ 所有测试完成");
}

main().catch((e) => {
  logger.error({ err: e }, "Fatal");
  process.exit(1);
});
