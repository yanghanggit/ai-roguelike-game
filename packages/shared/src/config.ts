/** Centralised port configuration. Edit here to change ports project-wide. */
export const PORTS = {
  /** Express dev server */
  server: 3001,
  /** Vite client dev server */
  client: 5173,
} as const;

/** The two valid stage sizes. All dungeon rooms are one of these. */
export const STAGE_SIZES = [3, 4] as const;
export type StageSize = 3 | 4;
