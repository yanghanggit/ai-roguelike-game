import { describe, it, expect } from "vitest";
import { PORTS, MAP_SIZES } from "./index.js";

describe("Config — PORTS", () => {
  it("server port is 3001", () => {
    expect(PORTS.server).toBe(3001);
  });

  it("client port is 5173", () => {
    expect(PORTS.client).toBe(5173);
  });
});

describe("Config — MAP_SIZES", () => {
  it("contains 3 and 4", () => {
    expect(MAP_SIZES).toContain(3);
    expect(MAP_SIZES).toContain(4);
  });

  it("has exactly two sizes", () => {
    expect(MAP_SIZES).toHaveLength(2);
  });
});
