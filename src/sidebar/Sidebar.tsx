import { useEffect, useMemo, useState, useCallback } from "react";

type TabInfo = { id: number; title: string; url: string; favIconUrl?: string };
type SavedTab = {
  id: string;
  title: string;
  url: string;
  favIconUrl?: string;
  savedAt: number;
  group?: string; // ← used for manual grouping
};

export default function Sidebar() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [saved, setSaved] = useState<SavedTab[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"all" | "saved">("all");

  // NEW: group picker state (open when saving/moving)
  const [showPicker, setShowPicker] = useState<null | {
    mode: "save" | "move";
    tab: TabInfo | SavedTab;
  }>(null);

  // NEW: collapsible sections & derived data
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const s of saved) if (s.group) set.add(s.group);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [saved]);

  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "title" | "site">("recent");

  // 1) filter + sort flat list
  const visibleSaved = useMemo(() => {
    let list = [...saved];

    // filter
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((s) => {
        const host = (() => {
          try {
            return new URL(s.url).hostname;
          } catch {
            return "";
          }
        })();
        return (
          (s.title || "").toLowerCase().includes(q) ||
          host.toLowerCase().includes(q)
        );
      });
    }

    // sort
    switch (sortBy) {
      case "title":
        list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
        break;
      case "site":
        list.sort((a, b) => {
          const ah = (() => {
            try {
              return new URL(a.url).hostname;
            } catch {
              return "";
            }
          })();
          const bh = (() => {
            try {
              return new URL(b.url).hostname;
            } catch {
              return "";
            }
          })();
          return ah.localeCompare(bh);
        });
        break;
      default: // "recent"
        list.sort((a, b) => b.savedAt - a.savedAt);
    }

    return list;
  }, [saved, query, sortBy]);

  // 2) group the already-filtered list
  const groupedSaved = useMemo(() => {
    const m = new Map<string, SavedTab[]>();
    for (const s of visibleSaved) {
      const key = s.group ?? "Ungrouped";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(s);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visibleSaved]);

  const inExtension = useMemo(
    () => typeof chrome !== "undefined" && !!chrome.runtime?.id,
    []
  );

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

  // saving now opens the group picker instead of saving immediately
  function startSave(t: TabInfo) {
    setShowPicker({ mode: "save", tab: t });
  }

  async function removeSaved(id: string) {
    await chrome.runtime.sendMessage({ type: "REMOVE_SAVED_TAB", id });
    await loadSaved();
  }

  const [menuFor, setMenuFor] = useState<string | null>(null); // which group has its menu open
  const [renaming, setRenaming] = useState<string | null>(null); // which group is in rename mode
  const [renameValue, setRenameValue] = useState(""); // text for rename
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null); // which group is confirming delete

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

  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds(new Set(tabs.map((t) => t.id)));
  }
  function clearSelection() {
    setSelectedIds(new Set());
    setSelecting(false);
  }

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b">
        <div className="px-3 py-2 flex items-center gap-2">
          <span className="text-lg font-semibold">Tab Whisperer</span>

          {/* All / Saved toggle */}
          <div className="ml-2 flex items-center gap-1 text-xs border rounded p-1">
            <button
              className={`px-2 py-0.5 rounded ${
                view === "all" ? "bg-secondary" : ""
              }`}
              onClick={() => {
                setView("all");
                setSelecting(false);
                clearSelection();
              }}
            >
              All
            </button>
            <button
              className={`px-2 py-0.5 rounded ${
                view === "saved" ? "bg-secondary" : ""
              }`}
              onClick={() => {
                setView("saved");
                setSelecting(false);
                clearSelection();
              }}
            >
              Saved
            </button>
          </div>

          {/* Search + Sort (only in Saved)*/}
          {view === "saved" && (
            <div className="ml-2 flex items-center gap-2">
              <input
                className="h-8 px-2 rounded-md border text-xs w-40"
                placeholder="Search title or site…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                className="h-8 px-2 rounded-md border text-xs"
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value as "recent" | "title" | "site")
                }
                title="Sort saved tabs"
              >
                <option value="recent">Recently saved</option>
                <option value="title">Title A–Z</option>
                <option value="site">Site A–Z</option>
              </select>
            </div>
          )}

          {/* Right-side controls */}
          <div className="ml-auto flex items-center gap-2">
            {/* In All view: Select / bulk actions */}
            {view === "all" && !selecting && (
              <>
                <button
                  className="h-8 px-3 rounded-md border text-xs"
                  onClick={loadTabs}
                >
                  Refresh
                </button>
                <button
                  className="h-8 px-3 rounded-md border text-xs"
                  onClick={() => setSelecting(true)}
                  title="Select multiple tabs to save"
                >
                  Select
                </button>
              </>
            )}

            {/* Recap all tabs (AI summary) */}
            <button
              className="h-8 px-3 rounded-md border text-xs"
              onClick={async () => {
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

                if (res?.ok) {
                  alert(`🧠 Recap:\n\n${res.summary}`);
                } else {
                  alert(`Error: ${res?.error ?? "Unknown error"}`);
                }
              }}
            >
              Recap
            </button>

            {view === "all" && selecting && (
              <>
                <span className="text-xs opacity-70">
                  {selectedIds.size} selected
                </span>
                <button
                  className="h-8 px-3 rounded-md border text-xs"
                  onClick={selectAllVisible}
                >
                  Select all
                </button>
                <button
                  className="h-8 px-3 rounded-md border text-xs bg-primary text-primary-foreground disabled:opacity-50"
                  disabled={selectedIds.size === 0}
                  onClick={() => {
                    // open picker to choose group for bulk save
                    setShowPicker({
                      mode: "save",
                      tab: { id: -1, title: "", url: "" } as TabInfo, // typed placeholder
                    });
                  }}
                >
                  Save ({selectedIds.size})
                </button>
                <button
                  className="h-8 px-3 rounded-md border text-xs"
                  onClick={clearSelection}
                >
                  Cancel
                </button>
              </>
            )}

            {/* Close */}
            <button
              className="h-8 w-8 flex items-center justify-center rounded-md border"
              title="Close"
              onClick={() =>
                chrome.runtime.sendMessage({ type: "CLOSE_SIDEBAR" })
              }
            >
              ✕
            </button>
          </div>
        </div>
      </header>

      <main className="p-3 space-y-3">
        {view === "all" && (
          <>
            {loading && <div className="text-sm opacity-70">Loading…</div>}
            {!loading && tabs.length === 0 && (
              <div className="text-sm opacity-70">No tabs.</div>
            )}
            <ul className="space-y-2">
              {tabs.map((t) => (
                <li
                  key={t.id}
                  className="p-2 rounded-lg border flex items-center gap-3"
                >
                  {selecting && (
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selectedIds.has(t.id)}
                      onChange={() => toggleOne(t.id)}
                    />
                  )}

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
                    <div className="text-[11px] opacity-60 truncate">
                      {t.url}
                    </div>
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
                      onClick={() => startSave(t)} // ← open group picker
                    >
                      Save
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {view === "saved" && (
          <>
            {groupedSaved.length === 0 && (
              <div className="text-sm opacity-70">Nothing saved yet.</div>
            )}

            <div className="space-y-4">
              {groupedSaved.map(([groupName, items]) => (
                <section key={groupName} className="border rounded-lg">
                  {/* header with menu/rename */}
                  <div className="sticky top-12 bg-background/80 backdrop-blur z-10 px-1 py-1 flex items-center gap-2 border-b">
                    {/* name or rename input */}
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

                    {/* AI summarize this group */}
                    <button
                      className="text-xs px-2 py-1 rounded border ml-2"
                      onClick={async () => {
                        // `items` is the group's array you already map below
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

                        if (res?.ok) {
                          alert(`Summary:\n\n${res.summary}`);
                        } else {
                          alert(`Error: ${res?.error ?? "Unknown error"}`);
                        }
                      }}
                    >
                      Summarize
                    </button>

                    {/* kebab menu */}
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
                          {/* Only show Rename if not Ungrouped */}
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
                          className="p-2 rounded-lg border flex items-center gap-3"
                        >
                          <img
                            src={
                              s.favIconUrl ||
                              chrome.runtime.getURL("icons/Logo.png")
                            }
                            className="w-5 h-5 rounded-sm"
                            onError={(e) =>
                              ((
                                e.currentTarget as HTMLImageElement
                              ).style.display = "none")
                            }
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

      {/* NEW: Group Picker modal */}
      {showPicker && (
        <GroupPicker
          existing={groups}
          initial={
            showPicker.mode === "move"
              ? (showPicker.tab as SavedTab).group ?? ""
              : ""
          }
          onCancel={() => setShowPicker(null)}
          onSubmit={async (groupName) => {
            // Are we in bulk-select mode?
            if (view === "all" && selecting && selectedIds.size > 0) {
              // Build payloads from selected open tabs
              const chosenTabs = tabs.filter((t) => selectedIds.has(t.id));
              const payload = chosenTabs.map<SavedTab>((t) => ({
                id: `${t.id}-${Date.now()}-${Math.random()
                  .toString(36)
                  .slice(2, 7)}`,
                title: t.title || "(No title)",
                url: t.url,
                favIconUrl: t.favIconUrl,
                savedAt: Date.now(),
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

            // ----- existing single-save / move logic (unchanged) -----
            if (showPicker.mode === "save") {
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
            } else {
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
              {/* Only show this option when deleting a real group (NOT Ungrouped) */}
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
    </div>
  );
}

/* ---------- Tiny GroupPicker component ---------- */
function GroupPicker({
  existing,
  initial,
  onCancel,
  onSubmit,
}: {
  existing: string[];
  initial?: string;
  onCancel: () => void;
  onSubmit: (value: string | null) => void; // null = no group
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
          {/* Option 1: Save without group */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              className="accent-current"
              checked={mode === "none"}
              onChange={() => setMode("none")}
            />
            <span>Save without group</span>
          </label>

          {/* Option 2: Use existing group */}
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
              {existing.length === 0 && (
                <option value="">(No groups yet)</option>
              )}
              {existing.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            {/* Custom dropdown arrow */}
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
              ▼
            </span>
          </div>

          {/* Option 3: Create new group */}
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
