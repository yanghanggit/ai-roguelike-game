# AI Roguelike Game

早期开发阶段。目标是一个可在局域网内用手机访问的回合制 Roguelike Web 游戏。

## 技术栈

pnpm workspaces + Turborepo 管理 monorepo；TypeScript strict 模式贯穿全栈；前端 React 18 + Vite，后端 Express 4，共享类型放在 `packages/shared`；原生 fetch + REST，无 WebSocket；测试用 Vitest + Supertest。

详见 [docs/](docs/README.md)。

## 快速开始

```bash
pnpm install
pnpm cli dev
```

- Client: <http://localhost:5173>（局域网：`http://<本机IP>:5173`）
- Server: <http://localhost:3001>

## 项目结构

```text
apps/client       React + Vite 前端
apps/server       Express REST API
packages/shared   共享类型、常量与项目配置（ports 等）
docs/             架构决策与技术文档
scripts/cli.ts    开发工具 CLI
```

## CLI

```shell
pnpm cli dev                             # 同时启动 client + server
pnpm cli dev --log                       # 同时启动，server 日志写入 logs/server-<timestamp>.log
pnpm cli dev --client-only               # 仅启动 client
pnpm cli dev --server-only               # 仅启动 server
pnpm cli dev --server-only --log         # 仅启动 server，并写入日志文件
pnpm cli build                           # 构建所有包
pnpm cli build --client-only             # 仅构建 client
pnpm cli health                          # 检查 server 是否响应
pnpm cli health -p 3001                  # 指定端口检查
pnpm cli lint                            # 全包 TypeScript 类型检查
pnpm cli format                          # 格式化所有文件
pnpm cli check                           # 仅处理 git staged 文件（提交前）
pnpm cli test                            # 运行全部测试
pnpm cli test --filter @roguelike/server # 只跑 server 测试
pnpm cli test --watch                    # watch 模式
pnpm cli kill                            # 释放被占用的开发端口
```

## 日常工作流

```bash
git add .
pnpm cli check   # Prettier 格式化 + ESLint 修复 → 只改暂存文件
pnpm cli lint    # tsc 全量类型检查
git commit
```

## 故障排查

### 端口被占用（EADDRINUSE）

`pnpm cli dev` 正常退出（Ctrl+C）会同时杀掉子进程。但若上次是**直接关终端窗口**或**异常崩溃**，子进程会留在后台，下次启动报错。

```bash
pnpm cli kill
```

端口号在 `packages/shared/src/config.ts` 统一配置。
