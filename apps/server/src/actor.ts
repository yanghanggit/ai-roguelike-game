import type { Actor as IActor } from "@roguelike/shared";

/** 占据格子的实体（当前为怪物）的运行时表示。 */
export class Actor implements IActor {
  constructor(readonly name: string) {}
}
