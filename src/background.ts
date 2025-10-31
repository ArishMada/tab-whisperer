import type { SavedTab } from "./lib/storage";
import { renameGroup } from "./lib/storage";
import { summarizeTabs } from "./lib/gemini";
import { groupTabsByIdStrict } from "./lib/gemini";

const OPEN_KEY_PREFIX = "tw_open_"; // session-scoped
const openKey = (winId: number) => `${OPEN_KEY_PREFIX}${winId}`;

async function setOpen(winId: number, val: boolean) {
  await chrome.storage.session.set({ [openKey(winId)]: val });
}

async function isOpen(winId: number): Promise<boolean> {
  const res = await chrome.storage.session.get(openKey(winId));
  return Boolean(res[openKey(winId)]);
}

function isRestricted(url?: string) {
  if (!url) return false;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("about://")
  );
}

type MaybeTab = { title: string; url?: string };
type BasicTab = { title: string; url: string };

// ===== Action: click to toggle sidebar (and flip the per-window flag)
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  if (isRestricted(tab.url)) {
    // popup path – don't persist
    await chrome.windows.create({
      url: chrome.runtime.getURL("sidebar.html"),
      type: "popup",
      width: 420,
      height: 700,
    });
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SIDEBAR" });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SIDEBAR" });
    } catch {
      await chrome.windows.create({
        url: chrome.runtime.getURL("sidebar.html"),
        type: "popup",
        width: 420,
        height: 700,
      });
      return;
    }
  }

  // flip window flag
  if (tab.windowId !== undefined) {
    const open = await isOpen(tab.windowId);
    await setOpen(tab.windowId, !open);
  }
});

// ===== Message router (one listener handling all message types)

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CLOSE_SIDEBAR") {
    (async () => {
      const [active] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (active?.id) {
        try {
          await chrome.tabs.sendMessage(active.id, { type: "TOGGLE_SIDEBAR" });
        } catch {
          void 0; // ignore: not injected or restricted
        }
        if (active.windowId !== undefined)
          await setOpen(active.windowId, false);
      }
      sendResponse({ ok: true });
    })();
    return true; // async
  }

  if (msg?.type === "GET_TABS_SNAPSHOT") {
    (async () => {
      const tabs = await chrome.tabs.query({});
      const items = tabs
        .filter((t) => !isRestricted(t.url))
        .map((t) => ({
          id: t.id!,
          title: t.title || "",
          url: t.url || "",
          favIconUrl: t.favIconUrl,
        }));
      sendResponse({ tabs: items });
    })();
    return true;
  }

  if (msg?.type === "GET_SAVED_TABS") {
    (async () => {
      const { savedTabs } = await chrome.storage.local.get("savedTabs");
      sendResponse({ tabs: (savedTabs ?? []) as SavedTab[] });
    })();
    return true;
  }

  if (msg?.type === "SAVE_TAB") {
    (async () => {
      const { savedTabs } = await chrome.storage.local.get("savedTabs");
      const all: SavedTab[] = savedTabs ?? [];
      all.unshift(msg.payload as SavedTab);
      await chrome.storage.local.set({ savedTabs: all });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg?.type === "AUTO_GROUP_TABS") {
    (async () => {
      try {
        // Expect: saved tabs only, supply id+title (no URLs)
        const { tabs } = msg as { tabs: Pick<SavedTab, "id" | "title">[] };

        const aiJson = await groupTabsByIdStrict(
          tabs.map((t) => ({ id: t.id, title: t.title || "(No title)" }))
        );

        // The UI will pass this back via APPLY_GROUPS for a single write
        sendResponse({ ok: true, groups: aiJson });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "APPLY_GROUPS") {
    (async () => {
      try {
        // payload: { "<GroupName>":[ "<tabId>", ... ], ... }
        const mapping = (msg.payload ?? {}) as Record<string, string[]>;
        const { savedTabs } = await chrome.storage.local.get("savedTabs");
        const all: SavedTab[] = (savedTabs ?? []) as SavedTab[];

        // Build reverse index id -> group
        const idToGroup = new Map<string, string>();
        for (const [group, ids] of Object.entries(mapping)) {
          for (const id of ids) idToGroup.set(id, group);
        }

        const next = all.map((t) => {
          const g = idToGroup.get(t.id);
          return g ? { ...t, group: g } : t;
        });

        await chrome.storage.local.set({ savedTabs: next });
        sendResponse({ ok: true, count: idToGroup.size });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  // 1) Group currently open tabs (by id)
  if (msg?.type === "AUTO_GROUP_OPEN_TABS") {
    (async () => {
      try {
        const all = await chrome.tabs.query({ currentWindow: true });
        // take only what's needed for prompting
        const skinny = all
          .filter((t) => !!t.id)
          .map((t) => ({ id: String(t.id), title: t.title || "(No title)" }));

        const groupsJson = await groupTabsByIdStrict(skinny); // <- returns minified JSON
        sendResponse({ ok: true, groups: groupsJson, tabs: skinny }); // return skinny so UI can render titles under groups
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  // 2) Save selected groups (mapping: {GroupName:[tabId,…]})
  if (msg?.type === "SAVE_OPEN_GROUPS") {
    (async () => {
      try {
        const mapping = (msg.payload ?? {}) as Record<string, string[]>;

        const openTabs = await chrome.tabs.query({ currentWindow: true });
        const byId = new Map<string, chrome.tabs.Tab>();
        for (const t of openTabs) if (t.id != null) byId.set(String(t.id), t);

        // load current saved (narrow the unknown shape into SavedTab[])
        const store = await chrome.storage.local.get("savedTabs");
        const existing = store.savedTabs;
        const current: SavedTab[] = Array.isArray(existing)
          ? (existing as SavedTab[])
          : [];

        // reverse map id->group for quick lookup
        const idToGroup = new Map<string, string>();
        for (const [g, ids] of Object.entries(mapping)) {
          for (const id of ids) idToGroup.set(id, g);
        }

        // upsert selected tabs into savedTabs with assigned group
        const have = new Map<string, SavedTab>(
          current.map((t) => [String(t.id), t])
        );

        for (const [id, group] of idToGroup.entries()) {
          const t = byId.get(id);
          if (!t) continue;

          const prev = have.get(id);
          const entry: SavedTab = {
            // preserve previous fields if present
            ...(prev ?? ({} as SavedTab)),
            id,
            url: t.url ?? "",
            title: t.title ?? "",
            favIconUrl: t.favIconUrl ?? "",
            group,
            // keep a savedAt if your SavedTab requires/uses it
            // (fallback to previous or set now)
            savedAt: (prev as { savedAt?: number })?.savedAt ?? Date.now(),
          };

          have.set(id, entry);
        }

        const next: SavedTab[] = Array.from(have.values());
        await chrome.storage.local.set({ savedTabs: next });
        sendResponse({ ok: true, savedCount: idToGroup.size });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "REMOVE_SAVED_TAB") {
    (async () => {
      const { savedTabs } = await chrome.storage.local.get("savedTabs");
      const all: SavedTab[] = savedTabs ?? [];
      await chrome.storage.local.set({
        savedTabs: all.filter((t) => t.id !== msg.id),
      });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg?.type === "UPDATE_SAVED_TAB") {
    (async () => {
      const { savedTabs } = await chrome.storage.local.get("savedTabs");
      const all: SavedTab[] = savedTabs ?? [];
      const i = all.findIndex((t) => t.id === msg.id);
      if (i >= 0) {
        all[i] = { ...all[i], ...(msg.patch ?? {}) }; // e.g. { group: "Research" }
        await chrome.storage.local.set({ savedTabs: all });
        sendResponse({ ok: true, tab: all[i] });
      } else {
        sendResponse({ ok: false, error: "NOT_FOUND" });
      }
    })();
    return true;
  }

  if (msg?.type === "RENAME_GROUP") {
    (async () => {
      const { from, to } = msg as { from: string; to: string };
      if (from === "Ungrouped") {
        // hard guard
        sendResponse({ ok: false, error: "CANNOT_RENAME_UNGROUPED" });
        return;
      }
      await renameGroup(from, to);
      const { savedTabs } = await chrome.storage.local.get("savedTabs");
      sendResponse({ ok: true, tabs: (savedTabs ?? []) as SavedTab[] });
    })();
    return true;
  }

  if (msg?.type === "DELETE_GROUP") {
    (async () => {
      try {
        const { name, mode } = msg as {
          name: string;
          mode: "ungroup" | "remove";
        };
        const { savedTabs } = await chrome.storage.local.get("savedTabs");
        const all: SavedTab[] = (savedTabs ?? []) as SavedTab[];

        const belongs = (t: SavedTab) =>
          name === "Ungrouped" ? !t.group : t.group === name;
        const next =
          mode === "remove"
            ? all.filter((t) => !belongs(t))
            : all.map((t) => (belongs(t) ? { ...t, group: undefined } : t));

        await chrome.storage.local.set({ savedTabs: next });
        sendResponse({ ok: true });

        // IMPORTANT: reply so the Promise on the UI side resolves
        sendResponse({ ok: true, tabs: next });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // keep channel open for async sendResponse
  }

  // SAVE ALL TABS IN CURRENT WINDOW
  if (msg?.type === "SAVE_ALL_IN_WINDOW") {
    (async () => {
      const { windowId } = msg as { windowId?: number };
      const [active] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const winId = windowId ?? active?.windowId;

      if (winId == null) {
        sendResponse({ ok: false, error: "NO_WINDOW" });
        return;
      }

      const tabs = await chrome.tabs.query({ windowId: winId });
      const now = Date.now();

      const toSave = tabs
        .filter((t) => !isRestricted(t.url))
        .map(
          (t) =>
            ({
              id: `${t.id}-${now}-${Math.random().toString(36).slice(2, 7)}`,
              title: t.title || "(No title)",
              url: t.url || "",
              favIconUrl: t.favIconUrl,
              savedAt: now,
            } satisfies SavedTab)
        );

      const { savedTabs } = await chrome.storage.local.get("savedTabs");
      const all: SavedTab[] = savedTabs ?? [];

      await chrome.storage.local.set({ savedTabs: [...toSave, ...all] });
      sendResponse({ ok: true, count: toSave.length });
    })();
    return true;
  }

  if (msg?.type === "SAVE_TABS_BULK") {
    (async () => {
      const { savedTabs } = await chrome.storage.local.get("savedTabs");
      const all: SavedTab[] = savedTabs ?? [];
      const incoming: SavedTab[] = (msg.payload ?? []) as SavedTab[];
      // newest first like single SAVE_TAB
      const next = [...incoming, ...all];
      await chrome.storage.local.set({ savedTabs: next });
      sendResponse({ ok: true, count: incoming.length });
    })();
    return true;
  }

  if (msg?.type === "SUMMARIZE_TABS") {
    (async () => {
      const { tabs, prompt } = msg as { tabs: MaybeTab[]; prompt?: string };

      const normalized: BasicTab[] = tabs.map((t) => ({
        title: t.title,
        url: t.url ?? "",
      }));

      try {
        const summary = await summarizeTabs(normalized, prompt);
        sendResponse({ ok: true, summary });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  return undefined;
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  if (await isOpen(windowId)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
    } catch {
      void 0;
    }
    try {
      await chrome.tabs.sendMessage(tabId, { type: "ENSURE_SIDEBAR" });
    } catch {
      void 0;
    }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.windowId !== undefined) {
    if (await isOpen(tab.windowId)) {
      if (!isRestricted(tab.url)) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["content.js"],
          });
        } catch {
          void 0;
        }
        try {
          await chrome.tabs.sendMessage(tabId, { type: "ENSURE_SIDEBAR" });
        } catch {
          void 0;
        }
      }
    }
  }
});
