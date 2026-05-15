/**
 * 全局 pino logger 单例与 factory。
 *
 * `createLogger(options)` — 创建一个 logger 实例：
 *   - stdout：TTY 时启用 pino-pretty（颜色 + 可读时间戳），否则输出 raw JSON。
 *   - file（可选）：同时将 raw JSON 追加写入指定路径，目录不存在时自动创建。
 *
 * `logger` — 进程级单例，读取环境变量：
 *   - `LOG_LEVEL`：日志级别，默认 `"info"`。
 *   - `LOG_FILE`：输出文件路径（相对或绝对），未设置时仅输出到 stdout。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import pino from "pino";
import pinoPretty from "pino-pretty";

const PRETTY_OPTIONS = {
  colorize: true,
  translateTime: "HH:MM:ss.l",
  ignore: "pid,hostname",
  messageKey: "msg",
} as const;

export interface LoggerOptions {
  /** 日志级别，默认 `"info"`。 */
  level?: string;
  /** 同时写入的文件路径；目录不存在时自动创建。 */
  file?: string;
}

export function createLogger(options: LoggerOptions = {}): pino.Logger {
  const level = options.level ?? "info";

  if (!options.file) {
    // 无文件输出：沿用原有单流方式
    return pino({
      level,
      transport: process.stdout.isTTY
        ? { target: "pino-pretty", options: PRETTY_OPTIONS }
        : undefined,
    });
  }

  // 确保目录存在
  fs.mkdirSync(path.dirname(options.file), { recursive: true });

  const streams: pino.StreamEntry[] = [
    {
      stream: process.stdout.isTTY ? pinoPretty(PRETTY_OPTIONS) : process.stdout,
    },
    {
      stream: fs.createWriteStream(options.file, { flags: "a" }),
    },
  ];

  return pino({ level }, pino.multistream(streams));
}

export const logger = createLogger({
  level: process.env["LOG_LEVEL"],
  file: process.env["LOG_FILE"],
});
