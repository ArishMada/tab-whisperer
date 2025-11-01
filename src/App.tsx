import { useEffect, useMemo, useState } from "react";

type TabInfo = { id: number; title: string; url: string; favIconUrl?: string };
type SavedTab = {
  id: string;
  title: string;
  url: string;
  favIconUrl?: string;
  savedAt: number;
  group?: string;
};

export default function App() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [saved, setSaved] = useState<SavedTab[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"all" | "saved">("all");

  const inExt = useMemo(
    () => typeof chrome !== "undefined" && !!chrome.runtime?.id,
    []
  );

  async function loadTabs() {
    if (!inExt) return;
    setLoading(true);
    const res = await chrome.runtime.sendMessage({ type: "GET_TABS_SNAPSHOT" });
    setTabs(res?.tabs ?? []);
    setLoading(false);
  }
  async function loadSaved() {
    if (!inExt) return;
    const res = await chrome.runtime.sendMessage({ type: "GET_SAVED_TABS" });
    setSaved(res?.tabs ?? []);
  }

  useEffect(() => {
    loadTabs();
    loadSaved();
  }, [inExt]);

  async function saveTab(t: TabInfo) {
    const payload: SavedTab = {
      id: `${t.id}-${Date.now()}`, // simple unique id
      title: t.title || "(No title)",
      url: t.url,
      favIconUrl: t.favIconUrl,
      savedAt: Date.now(),
    };
    await chrome.runtime.sendMessage({ type: "SAVE_TAB", payload });
    await loadSaved();
    setView("saved");
  }

  async function removeSaved(id: string) {
    await chrome.runtime.sendMessage({ type: "REMOVE_SAVED_TAB", id });
    await loadSaved();
  }

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b">
        <div className="px-4 py-3 flex items-center gap-2">
          <span className="text-xl font-semibold">Tab Whisperer</span>

          <div className="ml-6 flex items-center gap-1 text-sm border rounded-md p-1">
            <button
              className={`px-3 py-1 rounded ${
                view === "all" ? "bg-secondary" : ""
              }`}
              onClick={() => setView("all")}
            >
              All Tabs
            </button>
            <button
              className={`px-3 py-1 rounded ${
                view === "saved" ? "bg-secondary" : ""
              }`}
              onClick={() => setView("saved")}
            >
              Saved Tabs
            </button>
          </div>

          <button
            className="ml-auto px-3 py-1 rounded-md border text-sm"
            onClick={loadTabs}
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="p-4 space-y-4">
        {!inExt && (
          <div className="text-sm opacity-70">
            This is the Vite preview (no Chrome APIs). Build and load the
            extension to see your tabs.
          </div>
        )}

        {inExt && view === "all" && (
          <>
            {loading && <div className="text-sm opacity-70">Loading…</div>}
            {!loading && tabs.length === 0 && (
              <div className="text-sm opacity-70">No tabs.</div>
            )}
            <ul className="space-y-2">
              {tabs.map((t) => (
                <li
                  key={t.id}
                  className="p-3 rounded-lg border flex items-center gap-3"
                >
                  <img
                    src={
                      t.favIconUrl || chrome.runtime.getURL("icons/Logo.png")
                    }
                    className="w-5 h-5 rounded-sm"
                    onError={(e) =>
                      ((e.currentTarget as HTMLImageElement).style.display =
                        "none")
                    }
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {t.title || "(No title)"}
                    </div>
                    <div className="text-xs opacity-60 truncate">{t.url}</div>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <button
                      className="text-xs px-2 py-1 rounded border"
                      onClick={() => chrome.tabs.update(t.id, { active: true })}
                    >
                      Open
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded border"
                      onClick={() => saveTab(t)}
                    >
                      Save
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {inExt && view === "saved" && (
          <>
            {saved.length === 0 && (
              <div className="text-sm opacity-70">Nothing saved yet.</div>
            )}
            <ul className="space-y-2">
              {saved.map((s) => (
                <li
                  key={s.id}
                  className="p-3 rounded-lg border flex items-center gap-3"
                >
                  <img
                    src={
                      s.favIconUrl || chrome.runtime.getURL("icons/Logo.png")
                    }
                    className="w-5 h-5 rounded-sm"
                    onError={(e) =>
                      ((e.currentTarget as HTMLImageElement).style.display =
                        "none")
                    }
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {s.title}
                    </div>
                    <div className="text-xs opacity-60 truncate">{s.url}</div>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <button
                      className="text-xs px-2 py-1 rounded border"
                      onClick={() => chrome.tabs.create({ url: s.url })}
                    >
                      Open
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded border"
                      onClick={() => removeSaved(s.id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
