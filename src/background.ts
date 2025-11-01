// background.ts (MV3 service worker, module)

import type { SavedTab } from "./lib/storage";
import { renameGroup } from "./lib/storage";
import { summarizeTabs } from "./lib/gemini";
import { groupTabsByIdStrict } from "./lib/gemini";
import { summarizePage } from "./lib/gemini";

/* ============================== Utils ============================== */

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

/* =================== Browser Action: toggle sidebar =================== */

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  if (isRestricted(tab.url)) {
    // Restricted pages → open popup HTML instead (do not persist open flag)
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
    // Content script not injected yet; inject and retry
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SIDEBAR" });
    } catch {
      // If injection still fails (e.g., blocked), fallback to popup
      await chrome.windows.create({
        url: chrome.runtime.getURL("sidebar.html"),
        type: "popup",
        width: 420,
        height: 700,
      });
      return;
    }
  }

  // Flip per-window open flag
  if (tab.windowId !== undefined) {
    const open = await isOpen(tab.windowId);
    await setOpen(tab.windowId, !open);
  }
});

/* ========================== Message Router ========================== */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  /* ---- Close sidebar in current window ---- */
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
          /* not injected or restricted; ignore */
        }
        if (active.windowId !== undefined) {
          await setOpen(active.windowId, false);
        }
      }
      sendResponse({ ok: true });
    })();
    return true; // async
  }

  /* ---- Snapshot all tabs (filtered) ---- */
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

  /* ---- Load saved tabs ---- */
  if (msg?.type === "GET_SAVED_TABS") {
    (async () => {
      const { savedTabs } = await chrome.storage.local.get("savedTabs");
      sendResponse({ tabs: (savedTabs ?? []) as SavedTab[] });
    })();
    return true;
  }

  /* ---- Save a single tab (prepend newest) ---- */
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

  /* ---- Ask AI to group existing saved tabs (by SavedTab.id) ---- */
  if (msg?.type === "AUTO_GROUP_TABS") {
    (async () => {
      try {
        // Expect: { tabs: [{id,title}] } only
        const { tabs } = msg as { tabs: Pick<SavedTab, "id" | "title">[] };
        const aiJson = await groupTabsByIdStrict(
          tabs.map((t) => ({ id: t.id, title: t.title || "(No title)" }))
        );
        sendResponse({ ok: true, groups: aiJson }); // JSON text; UI applies via APPLY_GROUPS
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  /* ---- Apply group mapping to saved tabs ---- */
  if (msg?.type === "APPLY_GROUPS") {
    (async () => {
      try {
        // mapping: { "<Group>": ["<savedTabId>", ...], ... }
        const mapping = (msg.payload ?? {}) as Record<string, string[]>;
        const { savedTabs } = await chrome.storage.local.get("savedTabs");
        const all: SavedTab[] = (savedTabs ?? []) as SavedTab[];

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

  /* ---- AI groups for currently open tabs (preview only) ---- */
  if (msg?.type === "AUTO_GROUP_OPEN_TABS") {
    (async () => {
      try {
        const all = await chrome.tabs.query({ currentWindow: true });
        const skinny = all
          .filter((t) => t.id != null && !isRestricted(t.url))
          .map((t) => ({
            id: String(t.id),
            title: t.title || "(No title)",
            url: t.url || "",
            favIconUrl: t.favIconUrl || "",
          }));
        const groupsJson = await groupTabsByIdStrict(skinny);
        // Return skinny so UI can decorate with URLs/icons it already has
        sendResponse({ ok: true, groups: groupsJson, tabs: skinny });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  /* ---- Persist selected preview groups from open tabs ---- */
  if (msg?.type === "SAVE_OPEN_GROUPS") {
    (async () => {
      try {
        const mapping = (msg.payload ?? {}) as Record<string, string[]>;

        const openTabs = await chrome.tabs.query({ currentWindow: true });
        const byId = new Map<string, chrome.tabs.Tab>();
        for (const t of openTabs) if (t.id != null) byId.set(String(t.id), t);

        const store = await chrome.storage.local.get("savedTabs");
        const existing = store.savedTabs;
        const current: SavedTab[] = Array.isArray(existing)
          ? (existing as SavedTab[])
          : [];

        // Build reverse id -> group map
        const idToGroup = new Map<string, string>();
        for (const [g, ids] of Object.entries(mapping)) {
          for (const id of ids) idToGroup.set(id, g);
        }

        // Upsert into savedTabs
        const have = new Map<string, SavedTab>(
          current.map((t) => [String(t.id), t])
        );

        for (const [id, group] of idToGroup.entries()) {
          const t = byId.get(id);
          if (!t) continue;

          const prev = have.get(id);
          const entry: SavedTab = {
            ...(prev ?? ({} as SavedTab)),
            id, // use tab id as SavedTab.id for this path
            url: t.url ?? "",
            title: t.title ?? "",
            favIconUrl: t.favIconUrl ?? "",
            group,
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

  /* ---- Remove one saved tab ---- */
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

  /* ---- Patch a saved tab (e.g., move group) ---- */
  if (msg?.type === "UPDATE_SAVED_TAB") {
    (async () => {
      const { savedTabs } = await chrome.storage.local.get("savedTabs");
      const all: SavedTab[] = savedTabs ?? [];
      const i = all.findIndex((t) => t.id === msg.id);
      if (i >= 0) {
        all[i] = { ...all[i], ...(msg.patch ?? {}) };
        await chrome.storage.local.set({ savedTabs: all });
        sendResponse({ ok: true, tab: all[i] });
      } else {
        sendResponse({ ok: false, error: "NOT_FOUND" });
      }
    })();
    return true;
  }

  /* ---- Rename a group (except Ungrouped) ---- */
  if (msg?.type === "RENAME_GROUP") {
    (async () => {
      const { from, to } = msg as { from: string; to: string };
      if (from === "Ungrouped") {
        sendResponse({ ok: false, error: "CANNOT_RENAME_UNGROUPED" });
        return;
      }
      await renameGroup(from, to);
      const { savedTabs } = await chrome.storage.local.get("savedTabs");
      sendResponse({ ok: true, tabs: (savedTabs ?? []) as SavedTab[] });
    })();
    return true;
  }

  /* ---- Delete or ungroup a group ---- */
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
        sendResponse({ ok: true, tabs: next }); // single response (fixed)
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }

  /* ---- Save all tabs in current window ---- */
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

  /* ---- Save a batch provided by UI ---- */
  if (msg?.type === "SAVE_TABS_BULK") {
    (async () => {
      const { savedTabs } = await chrome.storage.local.get("savedTabs");
      const all: SavedTab[] = savedTabs ?? [];
      const incoming: SavedTab[] = (msg.payload ?? []) as SavedTab[];
      const next = [...incoming, ...all]; // newest first
      await chrome.storage.local.set({ savedTabs: next });
      sendResponse({ ok: true, count: incoming.length });
    })();
    return true;
  }

  /* ---- Summarize tabs with AI ---- */
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

  /* ---- Summarize ONE tab (by id) ---- */
  if (msg?.type === "SUMMARIZE_TAB") {
    (async () => {
      try {
        const { tabId, style } = msg as {
          tabId: number;
          style?: "bullets" | "blurb";
        };

        type ExtractResult = { title: string; text: string };

        const injected = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const title = document.title || "(No title)";
            const text = (document.body?.innerText || "")
              .replace(/\s+\n/g, "\n")
              .replace(/[ \t]+/g, " ");
            return { title, text };
          },
        });

        const res =
          (injected?.[0]?.result as ExtractResult | undefined) ?? undefined;

        // Guard against undefined 'result' (fixes TS18048)
        if (!res) {
          // Fallback: try to get the tab title to at least return something meaningful
          const t = await chrome.tabs.get(tabId).catch(() => null);
          const fallbackTitle = t?.title || "(No title)";
          sendResponse({
            ok: false,
            error: "NO_PAGE_TEXT_EXTRACTED",
            title: fallbackTitle,
          });
          return;
        }

        const summary = await summarizePage(
          res.title,
          res.text,
          style ?? "bullets"
        );
        sendResponse({ ok: true, summary });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }

  // No handler matched
  return undefined;
});

/* ============ Keep sidebar alive across tab switches/loads ============ */

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  if (await isOpen(windowId)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
    } catch {
      /* ignore */
    }
    try {
      await chrome.tabs.sendMessage(tabId, { type: "ENSURE_SIDEBAR" });
    } catch {
      /* ignore */
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
          /* ignore */
        }
        try {
          await chrome.tabs.sendMessage(tabId, { type: "ENSURE_SIDEBAR" });
        } catch {
          /* ignore */
        }
      }
    }
  }
});
