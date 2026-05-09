# Tech Stack

> 相关索引：[[README]]

## Monorepo

包管理使用 `pnpm workspaces`，所有子包通过 workspace 协议互相引用，节省磁盘空间并保证版本一致性。构建编排使用 `Turborepo`，负责任务依赖排序、增量缓存与并行执行。全栈统一使用 `TypeScript`，使客户端、服务端、共享包之间能够共享类型定义。

## Client（`apps/client`）

构建工具选用 `Vite`，提供极快的开发热更新。UI 框架选用 `React 18`，负责管理游戏 HUD、菜单、日志等界面状态。2D 地图渲染采用 CSS Grid 方式，以 HTML 元素和 CSS 类名表达地图 tile，不引入任何游戏引擎或 Canvas 渲染库。HTTP 通信直接使用浏览器原生的 `fetch` API，无需额外请求库。

## Server（`apps/server`）

服务端框架选用 `Express`，其生态成熟、资料丰富，适合入门阶段。开发时通过 `tsx watch` 实现 TypeScript 热重载，无需手动编译。游戏状态以 `Map<sessionId, GameState>` 的形式存储在进程内存中，当前阶段不引入数据库。

## Shared（`packages/shared`）

`packages/shared` 存放客户端与服务端共同依赖的内容：`GameState`、`Player`、`Monster`、`Tile`、`GameAction` 等核心类型定义，以及可被服务端调用的纯函数游戏逻辑。此包不包含任何运行时副作用，仅作为类型与逻辑的单一来源。

## 通信协议

采用 HTTP REST 短连接模式。回合制游戏每次玩家操作对应一次请求，服务端返回完整的新游戏状态。`POST /game/start` 负责创建会话并返回初始状态；`POST /game/action` 接收玩家动作，计算下一回合状态后返回。客户端始终以服务端返回的状态为权威来源，本地不做预测性更新。

## 代码质量工具

格式化使用 `Prettier`，风格约束无争议，等价于 Python 生态中的 `black`。静态分析使用 `ESLint` 配合 `typescript-eslint` 的 strict 规则集。提交前通过 `lint-staged` 仅对暂存文件执行格式化与修复。日常通过 CLI 命令 `pnpm cli check` 触发暂存文件检查，`pnpm cli format` 触发全量格式化，`pnpm cli lint` 触发全量类型检查。

## 延期决策

数据库长期目标为 `PostgreSQL`，通过 `Prisma` ORM 接入，当前阶段以内存状态替代。身份认证尚未设计。AI 功能（NPC、地图生成等）尚未设计。
