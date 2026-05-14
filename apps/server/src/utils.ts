/**
 * 从层级全名（如 `怪物.骷髅战士`）中提取最后一段作为显示标签。
 */
export function extractLabel(fullName: string): string {
  const parts = fullName.split(".");
  return parts[parts.length - 1] ?? fullName;
}
