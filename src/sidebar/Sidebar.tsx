import { useEffect, useMemo, useState } from "react";

type TabInfo = { id: number; title: string; url: string; favIconUrl?: string };

export default function Sidebar() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const inExtension = useMemo(
    () => typeof chrome !== "undefined" && !!chrome.runtime?.id,
    []
  );

  async function loadTabs() {
    if (!inExtension) return;
    setLoading(true);
    const res = await chrome.runtime.sendMessage({ type: "GET_TABS_SNAPSHOT" });
    setTabs(res?.tabs ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadTabs();
  }, [inExtension]);

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b">
        <div className="px-4 py-3 flex items-center gap-2">
          <span className="text-xl font-semibold">Tab Whisperer</span>
          <button
            className="ml-auto px-3 py-1 rounded-md border text-sm"
            onClick={loadTabs}
          >
            Refresh
          </button>
          <button
            className="ml-auto h-8 w-8 flex items-center justify-center rounded-md border"
            title="Close"
            onClick={() =>
              chrome.runtime.sendMessage({ type: "CLOSE_SIDEBAR" })
            }
          >
            ✕
          </button>
        </div>
      </header>

      <main className="p-4 space-y-4">
        {!inExtension && (
          <div className="text-sm opacity-70">
            This is a preview without Chrome APIs. Load as an extension to see
            your tabs.
          </div>
        )}

        {inExtension && (
          <>
            {loading && <div className="text-sm opacity-70">Loading…</div>}
            {!loading && tabs.length === 0 && (
              <div className="text-sm opacity-70">No tabs detected.</div>
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
                  <button
                    className="ml-auto text-xs px-2 py-1 rounded border"
                    onClick={() => chrome.tabs.update(t.id, { active: true })}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
