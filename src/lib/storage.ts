export type SavedTab = {
  id: string; // our own id
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
