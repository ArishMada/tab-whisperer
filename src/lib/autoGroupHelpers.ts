export function stripCodeFences(s: string): string {
  let t = String(s).trim();
  if (t.startsWith("```")) {
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      t = t.slice(first, last + 1);
    }
  }
  return t;
}

export function toRenderableGroups(
  jsonText: string,
  skinnyTabs: { id: string; title: string }[]
): Record<string, { id: string; title: string }[]> {
  const mapping = JSON.parse(jsonText) as Record<string, string[]>;
  const idToTitle = new Map(skinnyTabs.map((t) => [t.id, t.title]));
  const result: Record<string, { id: string; title: string }[]> = {};
  for (const [group, ids] of Object.entries(mapping)) {
    result[group] = (ids || []).map((id) => ({
      id,
      title: idToTitle.get(id) || "(No title)",
    }));
  }
  return result;
}
