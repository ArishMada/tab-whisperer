import { useEffect, useMemo, useState, useCallback } from "react";
import { SummaryModal } from "../components/SummaryModal";

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

  const [recapLoading, setRecapLoading] = useState(false);
  const [autoGroupLoading, setAutoGroupLoading] = useState(false);
  // track which group is being summarized; null = none
  const [groupSummarizing, setGroupSummarizing] = useState<string | null>(null);

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

  const [query] = useState("");
  const [sortBy] = useState<"recent" | "title" | "site">("recent");

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

  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryText, setSummaryText] = useState("");

  async function autoGroupSaved() {
    setAutoGroupLoading(true);
    try {
      const res = await chrome.runtime.sendMessage({
        type: "AUTO_GROUP_TABS",
        tabs: saved.map((s) => ({ title: s.title, url: s.url })),
      });

      if (!res?.ok || !res.groups) {
        setSummaryText("Auto-group failed: " + (res?.error ?? "Unknown error"));
        setSummaryOpen(true);
        return;
      }

      try {
        // { "Group A": ["Title 1","Title 2"], "Group B": [...] }
        const mapping = JSON.parse(res.groups) as Record<string, string[]>;
        const titleToGroup = new Map<string, string>();
        Object.entries(mapping).forEach(([group, titles]) => {
          titles.forEach((t) => titleToGroup.set(t.toLowerCase(), group));
        });

        await Promise.all(
          saved.map((s) => {
            const newGroup = titleToGroup.get((s.title || "").toLowerCase());
            if (newGroup && s.group !== newGroup) {
              return chrome.runtime.sendMessage({
                type: "UPDATE_SAVED_TAB",
                id: s.id,
                patch: { group: newGroup },
              });
            }
            return Promise.resolve();
          })
        );

        await loadSaved();
      } catch (e) {
        setSummaryText(
          "Auto-group: AI response wasn’t valid JSON.\n\n" + String(e)
        );
        setSummaryOpen(true);
      }
    } finally {
      setAutoGroupLoading(false);
    }
  }

  return (
    <div
      className="min-h-full text-foreground
    bg-white/40 dark:bg-neutral-900/50
    backdrop-blur-lg
    border-l border-white/20 dark:border-white/10"
    >
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur border-b px-3 py-2 flex flex-col gap-2">
        {/* Row 1: wordmark + buttons */}
        <div className="flex items-center justify-between">
          {/* Wordmark with logo chip + accent underline */}
          <div className="relative">
            <div className="flex items-center gap-2">
              <img
                src={chrome.runtime.getURL("icons/Logo.png")}
                alt=""
                className="h-5 w-5 rounded-sm shadow-sm"
              />
              <span className="text-base font-semibold tracking-tight">
                Tab Whisperer
              </span>
            </div>
            <div className="absolute left-7 right-0 -bottom-1 h-[2px] rounded-full bg-gradient-to-r from-primary/70 via-primary to-primary/40" />
          </div>

          {/* Matched circular icon buttons */}
          <div className="flex items-center gap-1">
            <button
              aria-label="Refresh"
              title="Refresh tabs"
              onClick={loadTabs}
              className="h-7 w-7 rounded-full border bg-background shadow-sm hover:bg-accent hover:shadow transition flex items-center justify-center"
            >
              {/* Refresh icon */}
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

        {/* Row 2: 50/50 All/Saved */}
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`h-8 rounded-md border text-xs w-full ${
              view === "all" ? "bg-secondary" : "hover:bg-accent"
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
            className={`h-8 rounded-md border text-xs w-full ${
              view === "saved" ? "bg-secondary" : "hover:bg-accent"
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

        {/* Row 3: action buttons */}
        <div className="grid grid-cols-3 gap-2">
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
                if (res?.ok) {
                  setSummaryText(res.summary);
                  setSummaryOpen(true);
                } else {
                  setSummaryText(`Error: ${res?.error ?? "Unknown error"}`);
                  setSummaryOpen(true);
                }
              } finally {
                setRecapLoading(false);
              }
            }}
          >
            {recapLoading ? <Spinner className="h-3.5 w-3.5" /> : null}
            <span>Recap</span>
          </button>

          <button
            className="h-8 px-3 rounded-md border text-xs flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-accent"
            disabled={autoGroupLoading}
            onClick={autoGroupSaved}
            title="Let AI group your saved tabs by topic"
          >
            {autoGroupLoading ? <Spinner className="h-3.5 w-3.5" /> : null}
            <span>Auto-Group</span>
          </button>

          {view === "all" && !selecting ? (
            <button
              className="h-8 px-3 rounded-md border text-xs hover:bg-accent"
              onClick={() => setSelecting(true)}
              title="Select multiple tabs to save"
            >
              Select
            </button>
          ) : (
            <button
              className="h-8 px-3 rounded-md border text-xs hover:bg-accent"
              onClick={() => setSelecting(false)}
            >
              Done
            </button>
          )}

          {/* Selection actions */}
          {view === "all" && selecting && (
            <>
              <span className="text-xs opacity-70">
                {selectedIds.size} selected
              </span>
              <button
                className="h-7 px-3 rounded-md border"
                onClick={selectAllVisible}
              >
                Select all
              </button>
              <button
                className="h-7 px-3 rounded-md border bg-primary text-primary-foreground disabled:opacity-50"
                disabled={selectedIds.size === 0}
                onClick={() => {
                  setShowPicker({
                    mode: "save",
                    tab: { id: -1, title: "", url: "" } as TabInfo,
                  });
                }}
              >
                Save ({selectedIds.size})
              </button>
              <button
                className="h-7 px-3 rounded-md border"
                onClick={clearSelection}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </header>

      {/* Watermark logo background */}
      <div
        aria-hidden
        className="pointer-events-none fixed z-0 inset-0 flex items-center justify-center opacity-10"
        style={{
          backgroundImage: `url(${chrome.runtime.getURL("icons/Logo.png")})`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          backgroundSize: "220px", // tweak size here
        }}
      />

      <main className="relative z-10 p-3 space-y-3">
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
                  className="p-2 rounded-lg border bg-card shadow-sm flex items-center gap-3"
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

                          if (res?.ok) {
                            setSummaryText(res.summary);
                            setSummaryOpen(true);
                          } else {
                            setSummaryText(
                              `Error: ${res?.error ?? "Unknown error"}`
                            );
                            setSummaryOpen(true);
                          }
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
                          className="p-2 rounded-lg border bg-card shadow-sm flex items-center gap-3"
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
