import { describe, it, expect } from "vitest";
import { PORTS, STAGE_SIZES } from "./index.js";

describe("Config — PORTS", () => {
  it("server port is 3001", () => {
    expect(PORTS.server).toBe(3001);
  });

  it("client port is 5173", () => {
    expect(PORTS.client).toBe(5173);
  });
});

describe("Config — STAGE_SIZES", () => {
  it("contains 3 and 4", () => {
    expect(STAGE_SIZES).toContain(3);
    expect(STAGE_SIZES).toContain(4);
  });

  it("has exactly two sizes", () => {
    expect(STAGE_SIZES).toHaveLength(2);
  });
});
