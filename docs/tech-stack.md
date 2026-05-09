# Tech Stack

## Monorepo

| Tool            | Role                                 |
| --------------- | ------------------------------------ |
| pnpm workspaces | Package management                   |
| Turborepo       | Build orchestration & task caching   |
| TypeScript      | Unified language across all packages |

## Client (`apps/client`)

| Tool      | Role                                      |
| --------- | ----------------------------------------- |
| Vite      | Dev server & bundler                      |
| React 18  | UI framework                              |
| CSS Grid  | 2D map rendering (no game engine)         |
| fetch API | HTTP communication (native, no extra lib) |

## Server (`apps/server`)

| Tool                                  | Role                             |
| ------------------------------------- | -------------------------------- |
| Express                               | REST API framework               |
| tsx                                   | TypeScript hot-reload in dev     |
| In-memory `Map<sessionId, GameState>` | Game state store (no DB for now) |

## Shared (`packages/shared`)

- TypeScript type definitions: `GameState`, `Player`, `Monster`, `Tile`, `GameAction`, etc.
- Pure-function game logic callable by server

## Communication

- **Protocol:** HTTP REST (short-connection, suits turn-based gameplay)
- **Key endpoints:**
  - `POST /game/start` → create session, return initial state
  - `POST /game/action` → process one player action, return new state

## Deferred

| Item           | Decision                       |
| -------------- | ------------------------------ |
| Database       | PostgreSQL via Prisma (future) |
| Auth           | Not designed yet               |
| AI integration | Not designed yet               |
