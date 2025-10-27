import { useEffect, useState } from 'react'

type TabInfo = { id: number; title: string; url?: string }

// Detect if we’re running inside the injected iframe (sidebar) vs popup window
const inIframe = (() => {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
})()

function closeSidebar() {
  if (!inIframe) return // Only closable from the iframe version
  chrome.runtime.sendMessage({ type: 'CLOSE_SIDEBAR' })
}

function CloseButton() {
  return (
    <button
      onClick={closeSidebar}
      title="Close sidebar"
      aria-label="Close sidebar"
      style={{
        marginLeft: 'auto',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        width: 28,
        height: 28,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 8,
        transition: 'background 120ms ease',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.06)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* nicer SVG “X” icon */}
      <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  )
}

export function Sidebar() {
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Esc closes only when in iframe sidebar
    if (!inIframe) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSidebar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    chrome.tabs.query({}, (all) => {
      const data = all.map(t => ({ id: t.id!, title: t.title || t.url || 'Untitled', url: t.url }))
      setTabs(data)
      setLoading(false)
    })
  }, [])

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', padding:12, background:'#f6f7fb' }}>
      <header style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
        <span style={{ fontSize:18, fontWeight:700 }}>Tab Whisperer 🫧</span>

        {inIframe ? <CloseButton /> : (
          <span style={{ marginLeft:'auto', fontSize:12, opacity:0.6 }}>
            Popup window
          </span>
        )}
      </header>

      <div style={{ overflow:'auto', borderRadius:8, background:'#fff', padding:8, boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
        {tabs.map(t => (
          <div key={t.id} style={{ padding:'8px 6px', borderBottom:'1px solid #eee' }}>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:2 }}>{t.title}</div>
            <div style={{ fontSize:12, opacity:0.7, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {t.url}
            </div>
          </div>
        ))}
        {tabs.length === 0 && !loading && (
          <div style={{ padding:12, fontSize:13, opacity:0.7 }}>No tabs found.</div>
        )}
      </div>
    </div>
  )
}
