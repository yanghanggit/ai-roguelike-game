/**
 * 游戏提示词构建器。
 *
 * 收录各类场景下注入给 LLM 的提示词生成函数，统一管理与复用。
 */

/**
 * 生成标准化的系统提示词。
 *
 * @param characterName - 角色全名，如 `怪物.骷髅战士`（不含"角色."前缀）
 * @param gameSetting   - 游戏世界观与核心机制说明（多行文本）
 * @param globalRules   - 全局角色扮演规则（多行文本）
 * @param characterSetting - 角色个体设定（多行文本）
 */
export function buildSystemPrompt(
  characterName: string,
  gameSetting: string,
  globalRules: string,
  characterSetting: string,
): string {
  const fullName = `角色.${characterName}`;
  return `# ${fullName}

你扮演角色: ${fullName}

## 游戏设定

${gameSetting}

## 全局规则

${globalRules}

## 角色设定

${characterSetting}`.trim();
}

/**
 * 构建完整的回合任务提示词，供 `AgentTask` 使用。
 *
 * @param turn - 当前回合数。
 * @returns 完整的任务提示词字符串。
 */
export function buildTurnTaskPrompt(turn: number): string {
  return `第 ${turn} 回合，到你行动了！

**回合行动（工具驱动）**

每回合通过以下工具决策，禁止在消息正文中描述行动结果：
- **query_status**：查询 "player"（玩家属性）、"dungeon"（地下城概览）或指定怪物名字，用于收集信息后再决策。
- **strike**：对目标发动攻击，同时附上一句简短的攻击描述（供日志展示），调用后本回合立即结束；**禁止在消息正文中描述攻击，只有 strike 调用才被系统识别为真实攻击**。
- **已知晓玩家存在时（"本回合事件"中提及玩家，或 query_status 已返回玩家信息），本回合必须调用 strike**——叙事描述攻击姿态后停止输出不会被系统记录为真实攻击。只有在完全未获得任何玩家信息的情况下，方可不调用任何工具直接结束回合。
- **调用 query_status 获得玩家信息后，下一步必须立即调用 strike**，不允许再次停止输出。`;
}
