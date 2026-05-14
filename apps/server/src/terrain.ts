import type { Terrain as ITerrain, TerrainType } from "@roguelike/shared";

/** 格子地形的运行时表示。 */
export class Terrain implements ITerrain {
  constructor(
    readonly name: string,
    readonly type: TerrainType,
  ) {}
}
