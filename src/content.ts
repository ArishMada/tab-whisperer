const SIDEBAR_ID = 'tab-whisperer-sidebar'

function toggleSidebar() {
  const existing = document.getElementById(SIDEBAR_ID)
  if (existing) { existing.remove(); return }

  const iframe = document.createElement('iframe')
  iframe.id = SIDEBAR_ID
  iframe.src = chrome.runtime.getURL('sidebar.html')
  Object.assign(iframe.style, {
    position: 'fixed',
    top: '0',
    right: '0',
    width: '360px',
    height: '100vh',
    border: '0',
    zIndex: '2147483646',
    boxShadow: '0 0 16px rgba(0,0,0,0.18)',
    background: 'transparent'
  } as CSSStyleDeclaration)
  document.documentElement.appendChild(iframe)
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'TOGGLE_SIDEBAR') toggleSidebar()
})