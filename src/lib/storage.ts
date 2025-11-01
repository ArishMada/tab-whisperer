export type SavedTab = {
  id: string;
  title: string;
  url: string;
  favIconUrl?: string;
  savedAt: number;
  group?: string; // future
};

const KEY = "savedTabs";

export async function getSaved(): Promise<SavedTab[]> {
  const res = await chrome.storage.local.get(KEY);
  return (res[KEY] as SavedTab[]) ?? [];
}

export async function setSaved(tabs: SavedTab[]) {
  await chrome.storage.local.set({ [KEY]: tabs });
}

export async function addSaved(t: SavedTab) {
  const all = await getSaved();
  all.unshift(t);
  await setSaved(all);
}

export async function removeSaved(id: string) {
  const all = await getSaved();
  await setSaved(all.filter((x) => x.id !== id));
}

export async function renameGroup(oldName: string, newName: string) {
  const tabs = await getSaved();
  const next = tabs.map((t) =>
    t.group === oldName ? { ...t, group: newName } : t
  );
  await setSaved(next);
}

export async function deleteGroup(
  name: string,
  mode: "ungroup" | "remove" = "ungroup"
) {
  const tabs = await getSaved();
  const next =
    mode === "remove"
      ? tabs.filter((t) => t.group !== name)
      : tabs.map((t) => (t.group === name ? { ...t, group: undefined } : t));
  await setSaved(next);
}
