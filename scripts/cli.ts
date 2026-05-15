#!/usr/bin/env tsx
import { Command } from "commander";
import { execSync, spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PORTS } from "../packages/shared/src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const program = new Command();

program.name("roguelike").description("Dev CLI for ai-roguelike-game monorepo").version("0.0.1");

// ─── dev ─────────────────────────────────────────────────────────────────────

program
  .command("dev")
  .description("Start client + server in development mode")
  .option("--client-only", `Start only the client (port ${PORTS.client})`)
  .option("--server-only", `Start only the server (port ${PORTS.server})`)
  .action((opts) => {
    if (opts.clientOnly) {
      run("pnpm", ["--filter", "@roguelike/client", "dev"], ROOT);
    } else if (opts.serverOnly) {
      run("pnpm", ["--filter", "@roguelike/server", "dev"], ROOT);
    } else {
      run("pnpm", ["turbo", "run", "dev"], ROOT);
    }
  });

// ─── build ────────────────────────────────────────────────────────────────────

program
  .command("build")
  .description("Build all packages")
  .option("--client-only", "Build only the client")
  .option("--server-only", "Build only the server")
  .action((opts) => {
    if (opts.clientOnly) {
      exec("pnpm --filter @roguelike/client build");
    } else if (opts.serverOnly) {
      exec("pnpm --filter @roguelike/server build");
    } else {
      exec("pnpm turbo run build");
    }
  });

// ─── health ───────────────────────────────────────────────────────────────────

program
  .command("health")
  .description("Check if the dev server is responding")
  .option("-p, --port <port>", "Server port", String(PORTS.server))
  .action(async (opts) => {
    const url = `http://localhost:${opts.port}/health`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      console.log(`✓ Server at ${url} responded:`, data);
    } catch {
      console.error(`✗ Could not reach ${url} — is the server running?`);
      process.exit(1);
    }
  });

// ─── check ────────────────────────────────────────────────────────────────────

program
  .command("check")
  .description("Format & lint staged files (Prettier + ESLint via lint-staged)")
  .action(() => {
    exec("pnpm exec lint-staged");
  });

// ─── format ──────────────────────────────────────────────────────────────────

program
  .command("format")
  .description("Format ALL files with Prettier (use before first commit or after big merges)")
  .action(() => {
    exec("pnpm exec prettier --write .");
  });

// ─── lint ─────────────────────────────────────────────────────────────────────

program
  .command("lint")
  .description("Type-check all packages")
  .action(() => {
    exec("pnpm exec tsc --noEmit");
    exec("pnpm turbo run lint");
  });

// ─── test ─────────────────────────────────────────────────────────────────────

program
  .command("test")
  .description("Run all tests (Vitest) across packages")
  .option("--watch", "Run in watch mode")
  .option("--filter <package>", "Run tests for a specific package (e.g. @roguelike/server)")
  .action((opts) => {
    if (opts.filter) {
      const vitestCmd = opts.watch ? "test:watch" : "test";
      exec(`pnpm --filter ${opts.filter} ${vitestCmd}`);
    } else if (opts.watch) {
      run("pnpm", ["turbo", "run", "test:watch"], ROOT);
    } else {
      exec("pnpm turbo run test");
    }
  });

// ─── kill ─────────────────────────────────────────────────────────────────────

program
  .command("kill")
  .description("Kill any process holding the dev ports (EADDRINUSE fix)")
  .action(() => {
    const ports = [PORTS.server, PORTS.client];
    for (const port of ports) {
      try {
        execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: "ignore" });
        console.log(`✓ Freed port ${port}`);
      } catch {
        console.log(`  Port ${port} was not in use`);
      }
    }
  });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function exec(cmd: string) {
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

function run(bin: string, args: string[], cwd: string) {
  const child = spawn(bin, args, { cwd, stdio: "inherit", shell: true });
  child.on("exit", (code) => process.exit(code ?? 0));
}

program.parse();
