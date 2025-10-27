function isRestricted(url?: string) {
  if (!url) return false;
  return url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about://');
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  // Fallback for restricted pages like chrome://newtab
  if (isRestricted(tab.url)) {
    await chrome.windows.create({
      url: chrome.runtime.getURL('sidebar.html'),
      type: 'popup',
      width: 420,
      height: 700
    });
    return;
  }

  // Normal path: toggle sidebar on the current page
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR' });
  } catch {
    // Content script might not be injected
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR' });
    } catch {
      // If injection still fails for any reason, fallback to popup window
      await chrome.windows.create({
        url: chrome.runtime.getURL('sidebar.html'),
        type: 'popup',
        width: 420,
        height: 700
      });
    }
  }
});

chrome.runtime.onMessage.addListener(async (msg, _sender, sendResponse) => {
  if (msg?.type === 'CLOSE_SIDEBAR') {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.id) {
      try {
        await chrome.tabs.sendMessage(active.id, { type: 'TOGGLE_SIDEBAR' });
      } catch {
        // no-op if not injected
      }
    }
    sendResponse?.({ ok: true });
    return true;
  }
});