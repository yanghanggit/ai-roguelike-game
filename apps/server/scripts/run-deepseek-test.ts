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

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
import {
  DeepSeekClient,
  MODEL_FLASH,
  MODEL_PRO,
  systemMessage,
  humanMessage,
  aiMessage,
  getBufferString,
} from "../src/ai/index.js";

const _SYSTEM = systemMessage("你是一个有帮助的助手，请用中文回答。");

// ─── Test: single chat ────────────────────────────────────────────────────────

async function testChat(): Promise<void> {
  console.log("\n=== 测试 chat() ===");

  const client = new DeepSeekClient({
    name: "test_chat",
    prompt: "请简单介绍一下你自己。",
    context: [_SYSTEM],
    model: MODEL_FLASH,
  });

  await client.chat();
  console.log("📝 回复:");
  console.log(client.responseContent);
}

// ─── Test: batch chat ─────────────────────────────────────────────────────────

async function testBatchChat(): Promise<void> {
  console.log("\n=== 测试 batchChat() ===");

  const questions = [
    "1+1等于几？",
    "天空为什么是蓝色的？",
    "请用一句话描述 TypeScript 语言。",
  ];

  const clients = questions.map(
    (q, i) =>
      new DeepSeekClient({
        name: `batch_${i}`,
        prompt: q,
        context: [_SYSTEM],
        model: MODEL_FLASH,
      })
  );

  await DeepSeekClient.batchChat(clients);

  for (const client of clients) {
    console.log(`\n❓ ${client.prompt}`);
    console.log(`💬 ${client.responseContent}`);
  }
}

// ─── Test: getBufferString ────────────────────────────────────────────────────

function testGetBufferString(): void {
  console.log("\n=== 测试 getBufferString() ===");

  const messages = [
    systemMessage("你是一个有帮助的助手。"),
    humanMessage("你好，请介绍一下自己。"),
    aiMessage("你好！我是 DeepSeek，一个 AI 助手。"),
    humanMessage("你能做什么？"),
  ];

  console.log(getBufferString(messages));
}

// ─── Test: listModels ─────────────────────────────────────────────────────────

async function testListModels(): Promise<void> {
  console.log("\n=== 测试 listModels() ===");

  const models = await DeepSeekClient.listModels();
  if (models.length > 0) {
    console.log("可用模型:");
    models.forEach((m) => console.log(`  - ${m}`));
  } else {
    console.warn("未获取到模型列表");
  }
}

// ─── Test: getBalance ─────────────────────────────────────────────────────────

async function testGetBalance(): Promise<void> {
  console.log("\n=== 测试 getBalance() ===");

  const balance = await DeepSeekClient.getBalance();
  if (Object.keys(balance).length > 0) {
    console.log("账户余额:");
    console.log(JSON.stringify(balance, null, 2));
  } else {
    console.warn("未获取到余额信息");
  }
}

// ─── Test: thinking mode (MODEL_PRO) ─────────────────────────────────────────

async function testThinkingMode(): Promise<void> {
  console.log("\n=== 测试 thinking 模式（MODEL_PRO）===");

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
    console.log("💭 思考过程:");
    console.log(client.responseReasoningContent);
    console.log("=".repeat(60));
  }
  console.log("📝 最终回答:");
  console.log(client.responseContent);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 快速失败：检测 API key 是否配置
  try {
    DeepSeekClient.setup();
  } catch (e) {
    console.error(String(e));
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

  console.log("\n✅ 所有测试完成");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
