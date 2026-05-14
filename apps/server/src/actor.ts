import type { Actor as IActor, ActorType } from "@roguelike/shared";

/** 占据格子的实体（怪物、宝箱、物品、特殊）的运行时表示。 */
export class Actor implements IActor {
  constructor(
    readonly name: string,
    public type: ActorType,
  ) {}
}
