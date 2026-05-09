import { describe, it, expect } from "vitest";
import type { GameMap, Tile } from "./index.js";

// ─── Helpers (mirrors server logic, tests pure map rules) ────────────────────

function buildMap(rows: number, cols: number): GameMap {
  const map: GameMap = [];
  for (let y = 0; y < rows; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < cols; x++) {
      const isWall = x === 0 || x === cols - 1 || y === 0 || y === rows - 1;
      row.push(
        isWall
          ? { type: "wall", glyph: "#", passable: false }
          : { type: "floor", glyph: ".", passable: true },
      );
    }
    map.push(row);
  }
  return map;
}

// ─── Map shape ────────────────────────────────────────────────────────────────

describe("GameMap structure", () => {
  it("has correct dimensions", () => {
    const map = buildMap(10, 10);
    expect(map).toHaveLength(10);
    expect(map[0]).toHaveLength(10);
  });

  it("border tiles are walls", () => {
    const map = buildMap(10, 10);
    // top & bottom rows
    for (let x = 0; x < 10; x++) {
      expect(map[0][x].type).toBe("wall");
      expect(map[9][x].type).toBe("wall");
    }
    // left & right columns
    for (let y = 0; y < 10; y++) {
      expect(map[y][0].type).toBe("wall");
      expect(map[y][9].type).toBe("wall");
    }
  });

  it("interior tiles are floor and passable", () => {
    const map = buildMap(10, 10);
    for (let y = 1; y <= 8; y++) {
      for (let x = 1; x <= 8; x++) {
        expect(map[y][x].type).toBe("floor");
        expect(map[y][x].passable).toBe(true);
      }
    }
  });

  it("wall tiles are not passable", () => {
    const map = buildMap(10, 10);
    expect(map[0][0].passable).toBe(false);
  });
});

// ─── Tile glyphs ──────────────────────────────────────────────────────────────

describe("Tile glyphs", () => {
  it("wall glyph is #", () => {
    const map = buildMap(5, 5);
    expect(map[0][0].glyph).toBe("#");
  });

  it("floor glyph is .", () => {
    const map = buildMap(5, 5);
    expect(map[2][2].glyph).toBe(".");
  });
});
