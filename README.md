# AI Roguelike Game

A turn-based roguelike web game. Client + server, TypeScript monorepo.

## Quick Start

```bash
pnpm install
pnpm dev
```

- Client: <http://localhost:5173>
- Server: <http://localhost:3001>

## Structure

```text
apps/client    React + Vite frontend
apps/server    Express REST API
packages/shared  Shared TypeScript types & logic
```

## Controls

Move with arrow keys or `WASD`.

## CLI

```shell
pnpm cli dev                  # 同时启动 client + server
pnpm cli dev --client-only    # 仅启动 client
pnpm cli dev --server-only    # 仅启动 server
pnpm cli build                # 构建所有包
pnpm cli build --client-only  # 仅构建 client
pnpm cli health               # 检查 server 是否响应
pnpm cli health -p 3001       # 指定端口检查
pnpm cli lint                 # 全包 TypeScript 类型检查
pnpm cli format               # 格式化所有文件（首次整理 or 大合并后）
pnpm cli check                # 仅处理 git staged 文件（提交前运行）
pnpm cli test                            # 运行全部测试
pnpm cli test --filter @roguelike/server # 只跑 server 测试
pnpm cli test --watch                    # watch 模式（写代码时保持运行）
```

## 日常工作流

git add .
pnpm cli check   # Prettier 格式化 + ESLint 修复 → 只改暂存文件
pnpm cli lint    # tsc 全量类型检查
git commit
