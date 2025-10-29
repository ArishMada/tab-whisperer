import type { SavedTab } from "./lib/storage";
import { renameGroup } from "./lib/storage";

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
