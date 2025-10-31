import { useEffect, useMemo, useState, useCallback } from "react";
import { SummaryModal } from "../components/SummaryModal";
import { stripCodeFences, toRenderableGroups } from "../lib/autoGroupHelpers";

/* ------------------ Small UI bits ------------------ */
function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4A4 4 0 008 12H4z"
      />
    </svg>
  );
}

/* ------------------ Types ------------------ */
type TabInfo = { id: number; title: string; url: string; favIconUrl?: string };
type SavedTab = {
  id: string;
  title: string;
  url: string;
  favIconUrl?: string;
  savedAt: number;
  group?: string;
};

type SuggestedItem = {
  id: string;
  title: string;
  favIconUrl?: string;
  url?: string;
};

/* ------------------ Helpers ------------------ */
// Prefer tab favicon, else site /favicon.ico, else extension logo.
function faviconFor(
  inExtension: boolean,
  url?: string,
  favIconUrl?: string
): string | undefined {
  if (favIconUrl) return favIconUrl;
  try {
    if (url) return new URL("/favicon.ico", new URL(url).origin).href;
  } catch {
    /* ignore */
  }
  return inExtension ? chrome.runtime.getURL("icons/Logo.png") : undefined;
}

// onError → swap once to extension logo (don’t hide).
function onIconError(
  e: React.SyntheticEvent<HTMLImageElement>,
  inExt: boolean
) {
  const img = e.currentTarget as HTMLImageElement;
  if (!inExt) return;
  if (img.dataset.fallback === "1") return; // avoid loop
  img.dataset.fallback = "1";
  img.src = chrome.runtime.getURL("icons/Logo.png");
}

/* =======================================================
   Sidebar
======================================================= */
export default function Sidebar() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [saved, setSaved] = useState<SavedTab[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"all" | "saved">("all");

  const [recapLoading, setRecapLoading] = useState(false);
  const [autoGroupLoading, setAutoGroupLoading] = useState(false);
  const [groupSummarizing, setGroupSummarizing] = useState<string | null>(null);

  const [showPicker, setShowPicker] = useState<null | {
    mode: "save" | "move" | "bulk";
    tab?: TabInfo | SavedTab;
  }>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const inExtension = useMemo(
    () => typeof chrome !== "undefined" && !!chrome.runtime?.id,
    []
  );

  /* -------- Saved groups list -------- */
  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const s of saved) if (s.group) set.add(s.group);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [saved]);

  /* -------- Saved sorting & grouping -------- */
  const visibleSaved = useMemo(() => {
    const list = [...saved];
    list.sort((a, b) => b.savedAt - a.savedAt);
    return list;
  }, [saved]);

  const groupedSaved = useMemo(() => {
    const m = new Map<string, SavedTab[]>();
    for (const s of visibleSaved) {
      const key = s.group ?? "Ungrouped";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(s);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visibleSaved]);

  /* ------------------ Loaders ------------------ */
  const loadTabs = useCallback(async () => {
    if (!inExtension) return;
    setLoading(true);
    const res = await chrome.runtime.sendMessage({ type: "GET_TABS_SNAPSHOT" });
    setTabs(res?.tabs ?? []);
    setLoading(false);
  }, [inExtension]);

  const loadSaved = useCallback(async () => {
    if (!inExtension) return;
    const res = await chrome.runtime.sendMessage({ type: "GET_SAVED_TABS" });
    setSaved(res?.tabs ?? []);
  }, [inExtension]);

  useEffect(() => {
    loadTabs();
    loadSaved();
  }, [loadTabs, loadSaved]);

  /* ------------------ Auto-Group preview (All) ------------------ */
  const [suggested, setSuggested] = useState<Record<string, SuggestedItem[]>>(
    {}
  );
  const [selectedSuggestedGroups, setSelectedSuggestedGroups] = useState<
    Set<string>
  >(new Set());
  const hasSuggestions = Object.keys(suggested).length > 0;

  // restore preview state
  useEffect(() => {
    if (!inExtension) return;
    chrome.storage.local
      .get(["tw_suggested", "tw_suggested_selected"])
      .then((obj) => {
        if (obj?.tw_suggested && typeof obj.tw_suggested === "object") {
          setSuggested(obj.tw_suggested as Record<string, SuggestedItem[]>);
        }
        if (Array.isArray(obj?.tw_suggested_selected)) {
          setSelectedSuggestedGroups(
            new Set(obj.tw_suggested_selected as string[])
          );
        }
      });
  }, [inExtension]);

  // persist preview state
  useEffect(() => {
    if (!inExtension) return;
    chrome.storage.local.set({
      tw_suggested: suggested,
      tw_suggested_selected: Array.from(selectedSuggestedGroups),
    });
  }, [inExtension, suggested, selectedSuggestedGroups]);

  /* ------------------ Live tab updates ------------------ */
  useEffect(() => {
    if (!inExtension) return;

    const onCreated = (tab: chrome.tabs.Tab) => {
      setTabs((prev) => {
        const next = [...prev];
        if (typeof tab?.id === "number" && !next.some((t) => t.id === tab.id)) {
          next.push({
            id: tab.id as number,
            title: tab.title || "(No title)",
            url: tab.url ?? "",
            favIconUrl: tab.favIconUrl,
          });
        }
        return next;
      });

      if (hasSuggestions && typeof tab?.id === "number") {
        setSuggested((prev) => {
          const next = { ...prev };
          const arr = next["Ungrouped"] ? [...next["Ungrouped"]] : [];
          arr.push({
            id: String(tab.id),
            title: tab.title || "(No title)",
            favIconUrl: tab.favIconUrl,
            url: tab.url ?? "",
          });
          next["Ungrouped"] = arr;
          return next;
        });
      }
    };

    const onRemoved = (tabId: number) => {
      setTabs((prev) => prev.filter((t) => t.id !== tabId));
      if (hasSuggestions) {
        setSuggested((prev) => {
          const next: Record<string, SuggestedItem[]> = {};
          for (const [g, items] of Object.entries(prev)) {
            const kept = items.filter((i) => i.id !== String(tabId));
            if (kept.length > 0) next[g] = kept;
          }
          return next;
        });
      }
    };

    const onUpdated = (
      tabId: number,
      changeInfo: Partial<{
        status: string;
        title: string;
        favIconUrl: string;
        url: string;
      }>,
      tab: chrome.tabs.Tab
    ) => {
      if (
        changeInfo?.status === "complete" ||
        changeInfo?.title ||
        changeInfo?.favIconUrl ||
        changeInfo?.url
      ) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  title: tab?.title ?? t.title,
                  url: tab.url ?? t.url,
                  favIconUrl: tab?.favIconUrl ?? t.favIconUrl,
                }
              : t
          )
        );
      }
    };

    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [inExtension, hasSuggestions]);

  /* ------------------ Actions ------------------ */
  async function removeSaved(id: string) {
    await chrome.runtime.sendMessage({ type: "REMOVE_SAVED_TAB", id });
    await loadSaved();
  }

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function doRenameGroup(from: string, to: string) {
    if (!to.trim() || from === to) {
      setRenaming(null);
      return;
    }
    await chrome.runtime.sendMessage({
      type: "RENAME_GROUP",
      from,
      to: to.trim(),
    });
    setRenaming(null);
    setMenuFor(null);
    await loadSaved();
  }

  async function doDeleteGroup(
    name: string,
    mode: "ungroup" | "remove" = "ungroup"
  ) {
    await chrome.runtime.sendMessage({ type: "DELETE_GROUP", name, mode });
    setConfirmDelete(null);
    setMenuFor(null);
    await loadSaved();
  }

  /* ------------------ Always-on selection (All) ------------------ */
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const allChecked = tabs.length > 0 && selectedIds.size === tabs.length;

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds((prev) =>
      prev.size === tabs.length ? new Set() : new Set(tabs.map((t) => t.id))
    );
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  /* ------------------ AI recap modal ------------------ */
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryText, setSummaryText] = useState("");

  /* ------------------ Auto-group (Saved) ------------------ */
  async function autoGroupSaved() {
    setAutoGroupLoading(true);
    try {
      const res = await chrome.runtime.sendMessage({
        type: "AUTO_GROUP_TABS",
        tabs: saved.map((s) => ({ id: s.id, title: s.title })),
      });

      if (!res?.ok || !res.groups) {
        setSummaryText("Auto-group failed: " + (res?.error ?? "Unknown error"));
        setSummaryOpen(true);
        return;
      }

      let jsonText = String(res.groups).trim();
      if (jsonText.startsWith("```")) {
        const first = jsonText.indexOf("{");
        const last = jsonText.lastIndexOf("}");
        if (first !== -1 && last !== -1 && last > first) {
          jsonText = jsonText.slice(first, last + 1);
        }
      }

      let mapping: Record<string, string[]>;
      try {
        mapping = JSON.parse(jsonText);
      } catch (e: unknown) {
        setSummaryText(
          "Auto-group: AI response wasn’t valid JSON.\n\n" +
            String(e) +
            "\n\n" +
            jsonText
        );

        setSummaryOpen(true);
        return;
      }

      const apply = await chrome.runtime.sendMessage({
        type: "APPLY_GROUPS",
        payload: mapping,
      });
      if (!apply?.ok) {
        setSummaryText(
          "Failed to apply groups: " + (apply?.error ?? "Unknown")
        );
        setSummaryOpen(true);
        return;
      }

      await loadSaved();
    } finally {
      setAutoGroupLoading(false);
    }
  }

  /* ------------------ Auto-group (All) → preview only ------------------ */
  const [isGrouping, setIsGrouping] = useState(false);

  async function runAutoGroupOnAll() {
    setIsGrouping(true);
    try {
      const res = await chrome.runtime.sendMessage({
        type: "AUTO_GROUP_OPEN_TABS",
      });
      if (!res?.ok) return;

      const jsonText = stripCodeFences(String(res.groups));
      const groups: Record<string, { id: string; title: string }[]> =
        toRenderableGroups(jsonText, res.tabs ?? []);

      type OpenTabLite = { id?: number; url?: string; favIconUrl?: string };

      // enrich with url + favIcon
      const byId = new Map<string, { url?: string; favIconUrl?: string }>();
      const rawTabs: OpenTabLite[] = (res.tabs ?? []) as OpenTabLite[];
      for (const t of rawTabs) {
        if (t?.id != null) {
          byId.set(String(t.id), { url: t.url, favIconUrl: t.favIconUrl });
        }
      }

      const enriched: Record<string, SuggestedItem[]> = {};
      for (const [g, items] of Object.entries(groups)) {
        enriched[g] = items.map((i) => {
          const extra = byId.get(i.id) ?? {};
          return {
            id: i.id,
            title: i.title,
            favIconUrl: extra.favIconUrl,
            url: extra.url,
          };
        });
      }

      // PREVIEW ONLY; nothing is persisted yet.
      setSuggested(enriched);
      setSelectedSuggestedGroups(new Set());
      setView("all");
    } finally {
      setIsGrouping(false);
    }
  }

  function toggleSuggestedPick(name: string) {
    setSelectedSuggestedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function saveSelectedGroups() {
    const payload: Record<string, string[]> = {};
    for (const [g, items] of Object.entries(suggested)) {
      if (!selectedSuggestedGroups.has(g)) continue;
      payload[g] = items.map((i) => i.id);
    }
    if (Object.keys(payload).length === 0) return;
    const res = await chrome.runtime.sendMessage({
      type: "SAVE_OPEN_GROUPS",
      payload,
    });
    if (!res?.ok) return;

    setSuggested({});
    setSelectedSuggestedGroups(new Set());
    setView("saved");
    await loadSaved();
  }

  function clearSuggestions() {
    setSuggested({});
    setSelectedSuggestedGroups(new Set());
  }

  /* ------------------ UI ------------------ */
  return (
    <div className="min-h-full text-foreground bg-white/40 dark:bg-neutral-900/50 backdrop-blur-lg border-l border-white/20 dark:border-white/10">
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur border-b px-3 py-2 flex flex-col gap-2">
        {/* Row 1: title + actions */}
        <div className="flex items-center justify-between">
          <div className="relative">
            <div className="flex items-center gap-2">
              <img
                src={
                  inExtension
                    ? chrome.runtime.getURL("icons/Logo.png")
                    : undefined
                }
                alt=""
                className="h-5 w-5 rounded-sm shadow-sm"
                onError={(e) => onIconError(e, inExtension)}
              />
              <span className="text-base font-semibold tracking-tight">
                Tab Whisperer
              </span>
            </div>
            <div className="absolute left-7 right-0 -bottom-1 h-[2px] rounded-full bg-gradient-to-r from-primary/70 via-primary to-primary/40" />
          </div>

          <div className="flex items-center gap-1">
            <button
              aria-label="Refresh"
              title="Refresh tabs"
              onClick={loadTabs}
              className="h-7 w-7 rounded-full border bg-background shadow-sm hover:bg-accent hover:shadow transition flex items-center justify-center"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0115.88-2M20 14a8 8 0 01-15.88 2"
                />
              </svg>
            </button>

            <button
              aria-label="Close"
              title="Close sidebar"
              onClick={() =>
                chrome.runtime.sendMessage({ type: "CLOSE_SIDEBAR" })
              }
              className="h-7 w-7 rounded-full border bg-background shadow-sm hover:bg-accent hover:shadow transition flex items-center justify-center"
            >
              <span className="text-[12px] leading-none">✕</span>
            </button>
          </div>
        </div>

        {/* Row 2: view switch */}
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`h-8 rounded-md border text-xs w-full ${
              view === "all" ? "bg-secondary" : "hover:bg-accent"
            }`}
            onClick={() => setView("all")}
          >
            All
          </button>
          <button
            className={`h-8 rounded-md border text-xs w-full ${
              view === "saved" ? "bg-secondary" : "hover:bg-accent"
            }`}
            onClick={() => setView("saved")}
          >
            Saved
          </button>
        </div>

        {/* Row 3: toolbar — compact like your ref */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="h-8 px-3 rounded-md border text-xs flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-accent"
            disabled={recapLoading}
            onClick={async () => {
              try {
                setRecapLoading(true);
                const allTabs = [...tabs, ...saved].map(({ title, url }) => ({
                  title,
                  url,
                }));
                const res = await chrome.runtime.sendMessage({
                  type: "SUMMARIZE_TABS",
                  tabs: allTabs,
                  prompt:
                    "Give a short recap of all browsing topics without detailed summaries.",
                });
                setSummaryText(
                  res?.ok
                    ? res.summary
                    : `Error: ${res?.error ?? "Unknown error"}`
                );
                setSummaryOpen(true);
              } finally {
                setRecapLoading(false);
              }
            }}
          >
            {recapLoading ? <Spinner className="h-3.5 w-3.5" /> : null}
            <span>Recap</span>
          </button>

          {view === "all" && (
            <>
              <button
                className="h-8 px-3 rounded-md border text-xs flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-accent"
                disabled={isGrouping}
                onClick={runAutoGroupOnAll}
                title="Let AI propose topic groups for your open tabs"
              >
                {isGrouping ? <Spinner className="h-3.5 w-3.5" /> : null}
                <span>Auto-Group</span>
              </button>

              {hasSuggestions && (
                <>
                  <button
                    className="h-8 px-3 rounded-md bg-black text-white text-xs hover:opacity-90 disabled:opacity-50"
                    onClick={saveSelectedGroups}
                    disabled={selectedSuggestedGroups.size === 0}
                  >
                    Save Selected
                  </button>
                  <button
                    className="h-8 px-3 rounded-md border text-xs hover:bg-accent"
                    onClick={clearSuggestions}
                  >
                    Clear
                  </button>
                </>
              )}

              <button
                className="h-8 px-3 rounded-md border text-xs bg-primary text-primary-foreground disabled:opacity-50"
                disabled={selectedIds.size === 0}
                onClick={() => setShowPicker({ mode: "bulk" })}
                title="Save the checked items"
              >
                Save ({selectedIds.size})
              </button>

              <button
                className="h-8 px-3 rounded-md border text-xs hover:bg-accent"
                onClick={toggleAll}
                title="Toggle all"
              >
                {allChecked ? "Unselect all" : "Select all"}
              </button>
            </>
          )}

          {view === "saved" && (
            <button
              className="h-8 px-3 rounded-md border text-xs flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-accent"
              disabled={autoGroupLoading}
              onClick={autoGroupSaved}
              title="Let AI group your saved tabs by topic"
            >
              {autoGroupLoading ? <Spinner className="h-3.5 w-3.5" /> : null}
              <span>Auto-Group</span>
            </button>
          )}
        </div>
      </header>

      {/* watermark */}
      {inExtension ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-0 inset-0 flex items-center justify-center opacity-10"
          style={{
            backgroundImage: `url(${chrome.runtime.getURL("icons/Logo.png")})`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
            backgroundSize: "220px",
          }}
        />
      ) : null}

      <main className="relative z-10 p-3 space-y-3">
        {/* Suggested groups preview (after Auto-Group on All) */}
        {hasSuggestions && view === "all" && (
          <div className="space-y-4">
            {Object.entries(suggested).map(([group, items]) => (
              <div
                key={group}
                className="rounded-xl border bg-white/60 dark:bg-neutral-900/40"
              >
                <div className="px-3 py-2 flex items-center gap-2">
                  <label className="flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={selectedSuggestedGroups.has(group)}
                      onChange={() => toggleSuggestedPick(group)}
                    />
                    <span>{group}</span>
                    <span className="text-sm opacity-60">({items.length})</span>
                  </label>
                </div>
                <ul className="px-3 pb-3 space-y-2">
                  {items.map((i) => (
                    <li
                      key={i.id}
                      className="p-2 rounded-lg border bg-card shadow-sm flex items-center gap-3"
                    >
                      <img
                        src={faviconFor(inExtension, i.url, i.favIconUrl)}
                        className="w-5 h-5 rounded-sm"
                        onError={(e) => onIconError(e, inExtension)}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {i.title}
                        </div>
                        {i.url ? (
                          <div className="text-[11px] opacity-60 truncate">
                            {i.url}
                          </div>
                        ) : null}
                      </div>
                      <div className="ml-auto flex gap-2">
                        <button
                          className="text-xs px-2 py-1 rounded border"
                          onClick={() =>
                            chrome.tabs.update(Number(i.id), { active: true })
                          }
                        >
                          Open
                        </button>
                        <button
                          className="text-xs px-2 py-1 rounded border"
                          onClick={() =>
                            setShowPicker({
                              mode: "save",
                              tab: {
                                id: -1,
                                title: i.title || "(No title)",
                                url: i.url || "",
                                favIconUrl: i.favIconUrl,
                              } as TabInfo,
                            })
                          }
                        >
                          Save
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* ALL view list */}
        {view === "all" && !hasSuggestions && (
          <>
            {loading && <div className="text-sm opacity-70">Loading…</div>}
            {!loading && tabs.length === 0 && (
              <div className="text-sm opacity-70">No tabs.</div>
            )}

            <ul className="space-y-2">
              {tabs.map((t) => (
                <li
                  key={t.id}
                  className="p-2 rounded-lg border bg-card shadow-sm flex items-center gap-3"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={selectedIds.has(t.id)}
                    onChange={() => toggleOne(t.id)}
                  />

                  <img
                    src={faviconFor(inExtension, t.url, t.favIconUrl)}
                    className="w-5 h-5 rounded-sm"
                    onError={(e) => onIconError(e, inExtension)}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {t.title || "(No title)"}
                    </div>
                    <div className="text-[11px] opacity-60 truncate">
                      {t.url}
                    </div>
                  </div>

                  <div className="ml-auto flex gap-2">
                    <button
                      className="text-xs px-2 py-1 rounded border"
                      onClick={() =>
                        chrome.tabs.update(Number(t.id), { active: true })
                      }
                    >
                      Open
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded border"
                      onClick={() => setShowPicker({ mode: "save", tab: t })}
                    >
                      Save
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* SAVED view */}
        {view === "saved" && (
          <>
            {groupedSaved.length === 0 && (
              <div className="text-sm opacity-70">Nothing saved yet.</div>
            )}

            <div className="space-y-4">
              {groupedSaved.map(([groupName, items]) => (
                <section key={groupName} className="border rounded-lg">
                  <div className="sticky top-12 bg-background/80 backdrop-blur z-10 px-1 py-1 flex items-center gap-2 border-b">
                    {renaming === groupName ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          className="border rounded px-2 py-1 text-sm bg-background text-foreground"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              doRenameGroup(groupName, renameValue);
                            if (e.key === "Escape") setRenaming(null);
                          }}
                        />
                        <button
                          className="text-xs px-2 py-1 rounded border"
                          onClick={() => doRenameGroup(groupName, renameValue)}
                        >
                          Save
                        </button>
                        <button
                          className="text-xs px-2 py-1 rounded border"
                          onClick={() => setRenaming(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="flex items-center gap-2 font-semibold hover:opacity-80"
                        onClick={() =>
                          setCollapsed((c) => ({
                            ...c,
                            [groupName]: !c[groupName],
                          }))
                        }
                        title={
                          collapsed[groupName]
                            ? "Expand group"
                            : "Collapse group"
                        }
                      >
                        <span className="text-xs opacity-70">
                          {collapsed[groupName] ? "▸" : "▾"}
                        </span>
                        <span>{groupName}</span>
                      </button>
                    )}

                    {/* summarize group */}
                    <button
                      className="text-xs px-2 py-1 rounded border ml-2 flex items-center gap-2 disabled:opacity-50"
                      disabled={groupSummarizing === groupName}
                      onClick={async () => {
                        setGroupSummarizing(groupName);
                        try {
                          const groupTabs = items.map(({ title, url }) => ({
                            title,
                            url,
                          }));
                          const userPrompt =
                            prompt("Optional: Add extra instruction for AI") ||
                            "";
                          const res = await chrome.runtime.sendMessage({
                            type: "SUMMARIZE_TABS",
                            tabs: groupTabs,
                            prompt: userPrompt,
                          });
                          setSummaryText(
                            res?.ok
                              ? res.summary
                              : `Error: ${res?.error ?? "Unknown error"}`
                          );
                          setSummaryOpen(true);
                        } finally {
                          setGroupSummarizing(null);
                        }
                      }}
                    >
                      {groupSummarizing === groupName ? (
                        <Spinner className="h-3.5 w-3.5" />
                      ) : null}
                      <span>Summarize</span>
                    </button>

                    {/* kebab */}
                    <div className="ml-auto relative">
                      <button
                        className="h-7 w-7 rounded border flex items-center justify-center"
                        onClick={() =>
                          setMenuFor(menuFor === groupName ? null : groupName)
                        }
                        title="Group options"
                      >
                        ⋯
                      </button>

                      {menuFor === groupName && (
                        <div className="absolute right-0 mt-1 w-44 rounded-md border bg-background shadow-lg z-20">
                          {groupName !== "Ungrouped" && (
                            <button
                              className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                              onClick={() => {
                                setRenaming(groupName);
                                setRenameValue(groupName);
                                setMenuFor(null);
                              }}
                            >
                              Rename
                            </button>
                          )}

                          <button
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                            onClick={() => setConfirmDelete(groupName)}
                          >
                            Delete…
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {!collapsed[groupName] && (
                    <ul className="p-3 pt-0 space-y-2">
                      {items.map((s) => (
                        <li
                          key={s.id}
                          className="p-2 rounded-lg border bg-card shadow-sm flex items-center gap-3"
                        >
                          <img
                            src={faviconFor(inExtension, s.url, s.favIconUrl)}
                            className="w-5 h-5 rounded-sm"
                            onError={(e) => onIconError(e, inExtension)}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {s.title}
                            </div>
                            <div className="text-[11px] opacity-60 truncate">
                              {s.url}
                            </div>
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
                              onClick={() =>
                                setShowPicker({ mode: "move", tab: s })
                              }
                            >
                              Move
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
                  )}
                </section>
              ))}
            </div>
          </>
        )}
      </main>

      {/* Group Picker */}
      {showPicker && (
        <GroupPicker
          existing={groups}
          initial={
            showPicker.mode === "move"
              ? (showPicker.tab as SavedTab)?.group ?? ""
              : ""
          }
          onCancel={() => setShowPicker(null)}
          onSubmit={async (groupName) => {
            if (showPicker.mode === "bulk") {
              const chosenTabs = tabs.filter((t) => selectedIds.has(t.id));
              const now = Date.now();
              const payload = chosenTabs.map<SavedTab>((t) => ({
                id: `${t.id}-${now}-${Math.random().toString(36).slice(2, 7)}`,
                title: t.title || "(No title)",
                url: t.url,
                favIconUrl: t.favIconUrl,
                savedAt: now,
                group: groupName || undefined,
              }));
              const res = await chrome.runtime.sendMessage({
                type: "SAVE_TABS_BULK",
                payload,
              });
              if (res?.ok) {
                await loadSaved();
                setView("saved");
                clearSelection();
              }
              setShowPicker(null);
              return;
            }

            if (showPicker.mode === "save" && showPicker.tab) {
              const t = showPicker.tab as TabInfo;
              const payload: SavedTab = {
                id: `${t.id}-${Date.now()}`,
                title: t.title || "(No title)",
                url: t.url,
                favIconUrl: t.favIconUrl,
                savedAt: Date.now(),
                group: groupName || undefined,
              };
              await chrome.runtime.sendMessage({ type: "SAVE_TAB", payload });
              await loadSaved();
              setView("saved");
            } else if (showPicker.mode === "move" && showPicker.tab) {
              const s = showPicker.tab as SavedTab;
              await chrome.runtime.sendMessage({
                type: "UPDATE_SAVED_TAB",
                id: s.id,
                patch: { group: groupName || undefined },
              });
              await loadSaved();
            }
            setShowPicker(null);
          }}
        />
      )}

      {/* Delete group confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-background text-foreground rounded-xl shadow-xl border p-5 w-[360px] max-w-[90vw]">
            <div className="font-semibold mb-2 text-lg">Delete group</div>
            <p className="text-sm opacity-80 mb-4">
              What should we do with the tabs in “{confirmDelete}”?
            </p>

            <div className="flex flex-col gap-2">
              {confirmDelete !== "Ungrouped" && (
                <button
                  className="px-3 py-2 border rounded text-left hover:bg-muted"
                  onClick={() => doDeleteGroup(confirmDelete, "ungroup")}
                >
                  Move items to <strong>Ungrouped</strong>
                </button>
              )}

              <button
                className="px-3 py-2 border rounded text-left hover:bg-muted"
                onClick={() => doDeleteGroup(confirmDelete, "remove")}
              >
                Permanently <strong>remove items</strong>
              </button>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                className="px-3 py-1.5 border rounded"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Summary modal */}
      <SummaryModal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        title="AI Summary"
        summary={summaryText}
      />
    </div>
  );
}

/* =======================================================
   GroupPicker
======================================================= */
function GroupPicker({
  existing,
  initial,
  onCancel,
  onSubmit,
}: {
  existing: string[];
  initial?: string;
  onCancel: () => void;
  onSubmit: (value: string | null) => void;
}) {
  const [mode, setMode] = useState<"none" | "choose" | "new">(
    !initial ? "none" : existing.includes(initial) ? "choose" : "new"
  );
  const [value, setValue] = useState(initial ?? "");
  const [chosen, setChosen] = useState(existing[0] ?? "");

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-background text-foreground rounded-xl shadow-xl border p-5 w-[360px] max-w-[90vw]">
        <div className="font-semibold mb-3 text-lg">Choose where to save</div>

        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              className="accent-current"
              checked={mode === "none"}
              onChange={() => setMode("none")}
            />
            <span>Save without group</span>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              className="accent-current"
              checked={mode === "choose"}
              onChange={() => setMode("choose")}
            />
            <span>Use existing group</span>
          </label>

          <div className="relative">
            <select
              disabled={mode !== "choose"}
              className="w-full border rounded px-3 py-2 disabled:opacity-60 bg-background text-foreground shadow-sm focus:ring focus:ring-primary/40 appearance-none"
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
            >
              {existing.length === 0 ? (
                <option value="">(No groups yet)</option>
              ) : null}
              {existing.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
              ▼
            </span>
          </div>

          <label className="flex items-center gap-2 text-sm mt-2">
            <input
              type="radio"
              className="accent-current"
              checked={mode === "new"}
              onChange={() => setMode("new")}
            />
            <span>Create new group</span>
          </label>
          <input
            disabled={mode !== "new"}
            className="w-full border rounded px-3 py-2 disabled:opacity-60 bg-background text-foreground shadow-sm focus:ring focus:ring-primary/40"
            value={value}
            placeholder="e.g., Research"
            onChange={(e) => setValue(e.target.value)}
          />
        </div>

        <div className="mt-6 flex gap-2 justify-end">
          <button
            className="px-3 py-1.5 border rounded hover:bg-muted transition text-sm"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 border rounded bg-primary text-primary-foreground text-sm hover:opacity-90 transition"
            onClick={() =>
              onSubmit(
                mode === "new"
                  ? value.trim() || null
                  : mode === "choose"
                  ? chosen || null
                  : null
              )
            }
            disabled={mode === "new" && value.trim().length === 0}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
