/**
 * 全局 pino logger 单例。
 *
 * - TTY 环境（本地开发）：启用 pino-pretty，带颜色 + 可读时间戳。
 * - 非 TTY 环境（CI / 生产）：输出标准 JSON，适合日志采集。
 * - 日志级别由环境变量 `LOG_LEVEL` 控制，默认 `"info"`。
 *   可用值：`"fatal"` | `"error"` | `"warn"` | `"info"` | `"debug"` | `"trace"`
 */
import pino from "pino";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  transport: process.stdout.isTTY
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
          messageKey: "msg",
        },
      }
    : undefined,
});
